from dataclasses import dataclass
from typing import Any
import httpx

@dataclass
class MarketingClient:
    base_url: str
    token: str
    tenant_id: str
    timeout_seconds: float = 15.0

    def _headers(self, *, correlation_id: str, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "X-Tenant-ID": self.tenant_id,
            "X-Codestra-Tenant-Id": self.tenant_id,
            "X-Correlation-ID": correlation_id,
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def create_campaign(self, payload: dict[str, Any], *, idempotency_key: str, correlation_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds) as client:
            response = await client.post("/v1/marketing/campaigns", json=payload, headers=self._headers(correlation_id=correlation_id, idempotency_key=idempotency_key))
            response.raise_for_status()
            return response.json()

    async def get_campaign(self, campaign_id: str, *, correlation_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds) as client:
            response = await client.get(f"/v1/marketing/campaigns/{campaign_id}", headers=self._headers(correlation_id=correlation_id))
            response.raise_for_status()
            return response.json()

    async def capabilities(self, *, correlation_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds) as client:
            response = await client.get("/v1/marketing/capabilities", headers=self._headers(correlation_id=correlation_id))
            response.raise_for_status()
            return response.json()
