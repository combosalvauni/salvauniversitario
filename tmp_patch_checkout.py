#!/usr/bin/env python3
"""Patch checkout.py to add SyncPay gateway support + fix webhook token in URL."""
import sys

path = '/var/www/concursaflix/concursa/app/routers/checkout.py'
content = open(path).read()

if 'syncpay-webhook' in content:
    print('SyncPay already in checkout.py, skipping')
    sys.exit(0)

# 1. Add syncpay_client import
old_imports = 'from app.core.babylon_client import create_transaction, get_transaction'
new_imports = '''from app.core.babylon_client import create_transaction, get_transaction
from app.core import syncpay_client'''
content = content.replace(old_imports, new_imports)

# 2. Fix H3: Remove webhook token from URL query string in create_checkout
# Find the webhook_url line and make it not include the token
old_webhook_url = '    webhook_url = f"{scheme}://{host}/api/v1/payments/babylon-webhook?token={settings.babylon_webhook_token}"'
new_webhook_url = '''    gateway = settings.payment_gateway
    if gateway == "syncpay":
        webhook_url = f"{scheme}://{host}/api/v1/payments/syncpay-webhook"
    else:
        webhook_url = f"{scheme}://{host}/api/v1/payments/babylon-webhook"'''
content = content.replace(old_webhook_url, new_webhook_url)

# 3. Add SyncPay payment flow in create_checkout — right before the Babylon API call
old_babylon_call = '''    # ── Call Babylon API ──
    try:
        txn = await create_transaction(babylon_payload)'''

new_gateway_call = '''    # ── Call payment gateway ──
    if gateway == "syncpay":
        # SyncPay PIX flow
        try:
            amount_brl = total / 100
            sync_result = await syncpay_client.create_pix(
                amount_brl=amount_brl,
                description=f"Pedido {str(order_id)[:8]} - {offer.get('title', 'Curso')}",
                customer={
                    "name": user.get("full_name") or user.get("email", ""),
                    "email": user.get("email", ""),
                    "phone": user_phone,
                    "document": body.customer_document,
                },
                webhook_url=webhook_url,
            )
        except httpx.HTTPStatusError as exc:
            logger.error("SyncPay API error: status=%s body=%s", exc.response.status_code, exc.response.text[:500])
            sb().table("orders").update({"status": "failed"}).eq("order_id", order_id).execute()
            if coupon_id:
                try: sb().rpc("decrement_coupon_usage", {"p_coupon_id": coupon_id}).execute()
                except Exception: pass
            raise HTTPException(status_code=502, detail="Erro ao processar pagamento. Tente novamente.")
        except Exception:
            logger.exception("SyncPay API unexpected error")
            sb().table("orders").update({"status": "failed"}).eq("order_id", order_id).execute()
            if coupon_id:
                try: sb().rpc("decrement_coupon_usage", {"p_coupon_id": coupon_id}).execute()
                except Exception: pass
            raise HTTPException(status_code=502, detail="Erro ao processar pagamento. Tente novamente.")

        # SyncPay returns: { id, qr_code, qr_code_text, status, ... }
        sync_data = sync_result.get("data", sync_result)
        sync_txn_id = str(sync_data.get("id", ""))
        sb().table("orders").update({"gateway": "syncpay", "gateway_checkout_id": sync_txn_id}).eq("order_id", order_id).execute()

        log_audit(
            actor_id=user_id, action="checkout_created",
            entity_type="order", entity_id=order_id,
            metadata={"offer_id": str(body.offer_id), "total_cents": total, "payment_method": "PIX", "gateway": "syncpay", "gateway_txn_id": sync_txn_id},
        )

        return CheckoutResponse(
            order_id=order_id,
            status="waiting_payment",
            total_cents=total,
            payment_method="PIX",
            pix_qrcode=sync_data.get("qr_code_text") or sync_data.get("qr_code") or sync_data.get("pix_code"),
            pix_expiration=sync_data.get("expiration_date") or sync_data.get("expires_at"),
            gateway_transaction_id=sync_txn_id,
        )

    # ── Call Babylon API ──
    try:
        txn = await create_transaction(babylon_payload)'''
content = content.replace(old_babylon_call, new_gateway_call)

# 4. Add SyncPay webhook handler after the _mark_event_processed function
old_mark = '''def _mark_event_processed(event_id: str):
    sb().table("webhook_events").update({
        "processed": True,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("event_id", event_id).execute()'''

new_mark = '''def _mark_event_processed(event_id: str):
    sb().table("webhook_events").update({
        "processed": True,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("event_id", event_id).execute()


# ═══════════════════════════════════════════
#  Webhook SyncPay
# ═══════════════════════════════════════════
_SYNCPAY_PAID = {"completed"}
_SYNCPAY_FAILED = {"failed", "refunded", "med"}


@webhook_router.post("/syncpay-webhook")
async def syncpay_webhook(request: Request):
    """
    Recebe webhook do SyncPay.

    Segurança: verify-then-act pattern.
    1. Valida token via header
    2. Extrai transaction ID
    3. Consulta SyncPay API para verificar status real
    4. Só processa com base no status verificado
    """
    settings = get_settings()

    # ── Token validation (header only — never query string) ──
    received_token = (
        request.headers.get("x-webhook-token", "")
        or request.headers.get("x-syncpay-token", "")
    )
    if not received_token or received_token != settings.syncpay_webhook_token:
        logger.warning("SyncPay webhook token mismatch from IP %s", request.client.host if request.client else "unknown")
        return JSONResponse(status_code=401, content={"detail": "Token inválido."})

    raw_body = await request.body()
    if len(raw_body) > 1_000_000:
        return JSONResponse(status_code=413, content={"detail": "Payload muito grande."})

    try:
        body = json.loads(raw_body)
    except (json.JSONDecodeError, ValueError):
        return JSONResponse(status_code=400, content={"detail": "JSON inválido."})

    # SyncPay payload: { data: { id, status, client: { email, phone }, amount } }
    data = body.get("data", {})
    txn_id = str(data.get("id", ""))
    raw_status = str(data.get("status", "")).strip().lower()

    if not txn_id:
        logger.warning("SyncPay webhook sem transaction ID")
        return JSONResponse(status_code=400, content={"detail": "Missing data.id"})

    event_header = request.headers.get("event", "")
    event_id = txn_id or str(uuid.uuid4())

    # ── Idempotência ──
    try:
        sb().table("webhook_events").upsert(
            {"event_id": f"syncpay_{event_id}", "gateway": "syncpay", "event_type": event_header or raw_status, "payload": body},
            on_conflict="event_id", ignore_duplicates=True,
        ).execute()
    except Exception:
        existing = sb().table("webhook_events").select("event_id").eq("event_id", f"syncpay_{event_id}").maybe_single().execute()
        if existing and existing.data:
            return {"ok": True, "message": "Evento já processado."}
        raise

    check = sb().table("webhook_events").select("processed").eq("event_id", f"syncpay_{event_id}").maybe_single().execute()
    if check and check.data and check.data.get("processed"):
        return {"ok": True, "message": "Evento já processado."}

    is_approved = raw_status in _SYNCPAY_PAID

    # ── Verify-then-act: only process approved if confirmed by API ──
    if is_approved:
        try:
            verified = await syncpay_client.get_transaction(txn_id)
            verified_data = verified.get("data", verified)
            verified_status = str(verified_data.get("status", "")).strip().lower()
            if verified_status != "completed":
                logger.warning("SyncPay reverse-verification REJECTED: tx %s status=%s (expected completed)", txn_id, verified_status)
                _mark_event_processed(f"syncpay_{event_id}")
                return {"ok": True, "message": "Status não confirmado."}
            logger.info("SyncPay reverse-verified tx %s: status=%s", txn_id, verified_status)
        except httpx.HTTPStatusError as exc:
            logger.error("SyncPay verify failed: status=%s txn=%s", exc.response.status_code, txn_id)
            return {"ok": True, "message": "Verificação temporariamente indisponível."}
        except Exception:
            logger.exception("SyncPay verify unexpected error: txn=%s", txn_id)
            return {"ok": True, "message": "Erro de verificação."}

    is_failed = raw_status in _SYNCPAY_FAILED

    # Find order by gateway_checkout_id
    order_result = sb().table("orders").select("order_id").eq("gateway_checkout_id", txn_id).maybe_single().execute()
    order_id = order_result.data["order_id"] if order_result and order_result.data else None

    if not order_id:
        logger.warning("SyncPay webhook para transação sem order: txn=%s", txn_id)
        _mark_event_processed(f"syncpay_{event_id}")
        return {"ok": True}

    if is_approved:
        await _process_payment_confirmed(order_id, txn_id, body)
    elif is_failed:
        await _process_payment_failed(order_id, raw_status, txn_id)

    _mark_event_processed(f"syncpay_{event_id}")
    return {"ok": True}'''

content = content.replace(old_mark, new_mark)

open(path, 'w').write(content)
print('OK — checkout.py patched with SyncPay gateway + webhook')
