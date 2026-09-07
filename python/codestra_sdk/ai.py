from dataclasses import dataclass
from typing import Any
import httpx

@dataclass
class AIClient:
    base_url: str
    token: str
    tenant_id: str

    async def generate(self, payload: dict[str, Any], *, idempotency_key: str, correlation_id: str) -> dict[str, Any]:
        # payload must match GenerationRequest: required task/input, optional
        # tenant_id/campaign_id/data_class/region/maximum_cost_micros/retain_output.
        # The real service returns 202 with {request_id, status, ...}; poll
        # GET /v1/ai/requests/{request_id} for the final output.
        headers = {
            "Authorization": f"Bearer {self.token}",
            "X-Tenant-ID": self.tenant_id,
            "X-Codestra-Tenant-Id": self.tenant_id,
            "Idempotency-Key": idempotency_key,
            "X-Correlation-ID": correlation_id,
        }
        async with httpx.AsyncClient(base_url=self.base_url, timeout=30.0) as client:
            response = await client.post("/v1/ai/generate", json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
