"""
Client HTTP para SyncPay Payments API.

Auth: OAuth2 client_credentials → Bearer token
Base: https://api.syncpayments.com.br/api/partner/v1
"""
import logging
import time
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("syncpay")

TIMEOUT = 30.0

# In-memory token cache
_token_cache: dict[str, Any] = {"access_token": "", "expires_at": 0.0}


def _base_url() -> str:
    return get_settings().syncpay_base_url.rstrip("/")


async def _get_token() -> str:
    """Obtain or refresh OAuth2 bearer token."""
    if _token_cache["access_token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]

    settings = get_settings()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{_base_url()}/api/partner/v1/auth-token",
            json={
                "client_id": settings.syncpay_client_id,
                "client_secret": settings.syncpay_client_secret,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    _token_cache["access_token"] = data["access_token"]
    if data.get("expires_at"):
        from datetime import datetime
        _token_cache["expires_at"] = datetime.fromisoformat(data["expires_at"]).timestamp()
    else:
        _token_cache["expires_at"] = time.time() + data.get("expires_in", 3600)

    return _token_cache["access_token"]


async def create_pix(*, amount_brl: float, description: str = "", customer: dict | None = None, webhook_url: str = "") -> dict[str, Any]:
    """
    POST /api/partner/v1/cash-in — Create PIX payment.

    Args:
        amount_brl: Amount in BRL (e.g. 39.90)
        description: Payment description
        customer: dict with name, email, phone, cpf
        webhook_url: URL for payment status callbacks

    Returns:
        SyncPay response with transaction id, qrcode, etc.
    """
    token = await _get_token()
    body: dict[str, Any] = {
        "amount": round(amount_brl * 100) / 100,
    }
    if description:
        body["description"] = description
    if webhook_url:
        body["webhook_url"] = webhook_url
    if customer:
        body["client"] = {
            "name": customer.get("name", "Cliente"),
            "cpf": (customer.get("document", "") or customer.get("cpf", "")).replace(" ", "").replace(".", "").replace("-", "")[:11],
            "email": customer.get("email", ""),
            "phone": (customer.get("phone", "") or "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "")[:11],
        }

    logger.info("Creating PIX: amount=%.2f", amount_brl)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(
            f"{_base_url()}/api/partner/v1/cash-in",
            json=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def get_transaction(transaction_id: str) -> dict[str, Any]:
    """
    GET /api/partner/v1/transaction/{id} — Check transaction status.

    Used for verify-then-act pattern on webhooks.
    """
    token = await _get_token()
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(
            f"{_base_url()}/api/partner/v1/transaction/{transaction_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()
