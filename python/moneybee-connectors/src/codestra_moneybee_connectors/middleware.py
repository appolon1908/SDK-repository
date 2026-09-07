from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Literal
import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from .context import AdapterRequestContext
from .errors import (
    AuthenticationError,
    AuthorizationError,
    CapabilityDisabledError,
    ConnectorError,
    DependencyUnavailableError,
    IdempotencyConflictError,
    ProviderRejectedError,
    RateLimitError,
    UnknownOutcomeError,
    ValidationError,
)

TokenProvider = Callable[[], str | Awaitable[str]]
OperationState = Literal[
    "RECEIVED", "QUEUED", "SUBMITTED", "ACCEPTED", "UNKNOWN",
    "COMPLETED", "FAILED", "RECONCILIATION_REQUIRED", "DEAD_LETTERED", "CANCELLED",
]


class MiddlewareClientConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    base_url: HttpUrl
    # Constructing the client with an explicit endpoint and token provider enables
    # safe Middleware connectivity/readback. Consequential commands remain denied
    # unless their capability is separately present in allowed_capabilities.
    enabled: bool = True
    timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    read_attempts: int = Field(default=3, ge=1, le=5)
    allowed_capabilities: frozenset[str] = frozenset()

    @model_validator(mode="after")
    def require_secure_remote_transport(self) -> MiddlewareClientConfig:
        host = (self.base_url.host or "").lower()
        loopback = host in {"localhost", "127.0.0.1", "::1"}
        if self.base_url.scheme != "https" and not (loopback and self.base_url.scheme == "http"):
            raise ValueError("base_url must use HTTPS except for explicit loopback development")
        return self


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    command_id: str
    tenant_id: str
    command_type: str
    command_version: str
    target: str
    requested_by: str
    correlation_id: str
    idempotency_key: str
    capability: str
    state: OperationState
    provider_operation_id: str | None = None
    last_error: str | None = None
    created_at: str
    updated_at: str
    duplicate: bool = False


class CodestraMiddlewareClient:
    """Client for the verified `/v1/commands` and `/v1/operations/{id}` contract.

    Readback is available after callers explicitly construct the client with a
    secure base URL and token provider. Mutations are still denied unless the
    requested capability is explicitly allowlisted. Mutations are attempted
    exactly once; transport ambiguity is surfaced as ``UnknownOutcomeError``
    and callers must read the operation back.
    """

    def __init__(
        self,
        config: MiddlewareClientConfig,
        token_provider: TokenProvider,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._config = config
        self._token_provider = token_provider
        self._client = httpx.AsyncClient(
            base_url=str(config.base_url).rstrip("/") + "/",
            timeout=config.timeout_seconds,
            transport=transport,
        )

    async def __aenter__(self) -> CodestraMiddlewareClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def submit_command(
        self,
        context: AdapterRequestContext,
        *,
        command_type: str,
        target: str,
        capability: str,
        payload: dict[str, Any],
    ) -> Operation:
        self._assert_enabled(capability)
        body = {
            "command_id": context.operation_id,
            "command_type": command_type,
            "command_version": "1.0",
            "target": target,
            "tenant_id": context.tenant_id,
            "requested_by": context.principal,
            "correlation_id": context.correlation_id,
            "idempotency_key": context.idempotency_key,
            "capability": capability,
            "payload": payload,
        }
        try:
            response = await self._client.post(
                "v1/commands",
                headers=await self._headers(context, mutation=True),
                json=body,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise UnknownOutcomeError(
                "Middleware command outcome is unknown; read back by operation ID before retrying",
                retryable=False,
                details={"operation_id": context.operation_id},
            ) from exc
        if response.status_code in {502, 503, 504}:
            raise UnknownOutcomeError(
                "Middleware command outcome is unknown; read back by operation ID before retrying",
                retryable=False,
                details={"operation_id": context.operation_id},
            )
        return self._parse_response(response)

    async def get_operation(self, context: AdapterRequestContext) -> Operation:
        self._assert_enabled(None)
        response: httpx.Response | None = None
        for attempt in range(self._config.read_attempts):
            try:
                response = await self._client.get(
                    f"v1/operations/{context.operation_id}",
                    headers=await self._headers(context, mutation=False),
                )
                if response.status_code < 500:
                    break
            except (httpx.TimeoutException, httpx.TransportError):
                response = None
            if attempt + 1 < self._config.read_attempts:
                await asyncio.sleep(0.05 * (2**attempt))
        if response is None:
            raise DependencyUnavailableError("Middleware operation read-back unavailable", retryable=True)
        return self._parse_response(response)

    def _assert_enabled(self, capability: str | None) -> None:
        if not self._config.enabled:
            raise CapabilityDisabledError("Codestra Middleware is disabled")
        if capability is not None and capability not in self._config.allowed_capabilities:
            raise CapabilityDisabledError(f"Middleware capability {capability} is disabled")

    async def _headers(self, context: AdapterRequestContext, *, mutation: bool) -> dict[str, str]:
        token = self._token_provider()
        if isinstance(token, Awaitable):
            token = await token
        if not token or "\n" in token or "\r" in token:
            raise AuthenticationError("Middleware service token is unavailable")
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Tenant-ID": context.tenant_id,
            "X-Correlation-ID": context.correlation_id,
            "X-Request-ID": context.request_id,
            "X-Release-ID": context.release_id,
        }
        if mutation:
            headers["Idempotency-Key"] = context.idempotency_key
        return headers

    @staticmethod
    def _parse_response(response: httpx.Response) -> Operation:
        if response.status_code in {200, 202}:
            try:
                return Operation.model_validate(response.json())
            except (ValueError, TypeError) as exc:
                raise DependencyUnavailableError("Middleware returned an invalid operation", retryable=False) from exc
        mapping: dict[int, type[ConnectorError]] = {
            400: ValidationError,
            401: AuthenticationError,
            403: AuthorizationError,
            409: IdempotencyConflictError,
            429: RateLimitError,
            503: DependencyUnavailableError,
        }
        error_type = mapping.get(response.status_code, ProviderRejectedError)
        raise error_type(
            f"Middleware rejected request with HTTP {response.status_code}",
            retryable=response.status_code in {429, 502, 503, 504},
        )
