from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import legacy_server as legacy
from fastapi import HTTPException, status

from app.core.db import db
from app.core.models import UserRole
from app.core.deps import _json_safe_payload
from app.domains.sumup.client import SumupClient, SumupClientError, SumupConfigError
from app.domains.sumup.config import SumupSettings, load_sumup_settings
from app.domains.sumup.models import (
    CASH_SALE_STATUSES,
    CashRegisterSaleCreateRequest,
    CashRegisterSaleDoc,
    CashRegisterSaleItemInput,
    CashRegisterScanRequest,
)
from app.domains.sumup import repository

logger = legacy.logger


def _now() -> datetime:
    return datetime.utcnow()


def _norm(value: Any) -> str:
    return str(value or "").strip()


def _norm_lower(value: Any) -> str:
    return _norm(value).lower()


def _is_admin(user: dict) -> bool:
    return _norm_lower((user or {}).get("role")) == UserRole.ADMIN.value


def is_sumup_cashier(user: dict, settings: Optional[SumupSettings] = None) -> bool:
    cfg = settings or load_sumup_settings()
    return _norm_lower((user or {}).get("username")) == _norm_lower(cfg.allowed_username)


def require_sumup_cashier(user: dict, settings: Optional[SumupSettings] = None) -> None:
    cfg = settings or load_sumup_settings()
    if not is_sumup_cashier(user, cfg):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso consentito solo all'utente cassa")


def can_view_sumup_status(user: dict, settings: Optional[SumupSettings] = None) -> bool:
    cfg = settings or load_sumup_settings()
    return bool(_is_admin(user) or is_sumup_cashier(user, cfg))


async def _append_audit(sale_id: str, event: str, user: dict, payload: Optional[dict] = None) -> None:
    try:
        await repository.append_audit(
            db,
            sale_id=sale_id,
            event=event,
            username=_norm((user or {}).get("username")) or "system",
            payload=_json_safe_payload(payload or {}),
        )
    except Exception as exc:
        logger.warning("[SUMUP_AUDIT_WRITE_FAILED] sale_id=%s event=%s err=%s", sale_id, event, exc)


def _extract_variant(product: dict, variant_id: str) -> Optional[dict]:
    for variant in (product.get("variants") or []):
        if _norm(variant.get("id")) == _norm(variant_id):
            return variant
    return None


async def _find_product_with_variant(variant_id: str) -> tuple[dict, dict]:
    vid = _norm(variant_id)
    if not vid:
        raise HTTPException(status_code=400, detail="variant_id obbligatorio")
    product = await db.products.find_one(
        {"variants.id": vid, "is_active": True},
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "vendor": 1,
            "is_active": 1,
            "variants": 1,
        },
    )
    if not product:
        raise HTTPException(status_code=404, detail=f"Variante non trovata: {vid}")
    variant = _extract_variant(product, vid)
    if not variant:
        raise HTTPException(status_code=404, detail=f"Variante non trovata: {vid}")
    if bool(variant.get("hidden")):
        raise HTTPException(status_code=400, detail="Variante nascosta/non vendibile")
    return product, variant


async def _load_location(location_id: str) -> dict:
    lid = _norm(location_id)
    if not lid:
        raise HTTPException(status_code=400, detail="location_id obbligatorio")
    location = await db.locations.find_one({"id": lid, "is_active": True}, {"_id": 0, "id": 1, "name": 1})
    if not location:
        raise HTTPException(status_code=404, detail="Location non trovata")
    return location


async def _compute_availability_row(variant_id: str, location_id: str, requested_qty: int) -> tuple[int, Optional[dict]]:
    query = {
        "variant_id": _norm(variant_id),
        "location_id": _norm(location_id),
        "quantity": {"$gt": 0},
    }
    rows = await db.inventory_levels.find(query, {"_id": 0}).sort([("quantity", -1), ("updated_at", -1)]).to_list(200)
    total_qty = sum(int(r.get("quantity") or 0) for r in rows)
    candidate = next((r for r in rows if int(r.get("quantity") or 0) >= int(requested_qty)), None)
    return int(total_qty), candidate


def _resolve_unit_price(source_price: Any, manual_price: Optional[float]) -> tuple[float, float, bool]:
    original = float(source_price or 0)
    manual = None
    if manual_price is not None:
        try:
            manual = float(manual_price)
        except Exception:
            manual = None
    if manual is not None and manual > 0:
        return original, manual, abs(manual - original) > 0.0001
    if original <= 0:
        raise HTTPException(status_code=400, detail="Prezzo prodotto non valido: imposta un prezzo manuale > 0")
    return original, original, False


def _normalize_sumup_status(raw: Any) -> tuple[str, str]:
    value = _norm_lower(raw)
    if value in {"paid", "successful", "success", "completed"}:
        return "paid", value
    if value in {"pending", "processing", "scheduled", "created", "initiated"}:
        return "payment_pending", value
    if value in {"failed", "declined", "error"}:
        return "failed", value
    if value in {"cancelled", "canceled"}:
        return "cancelled", value
    if value in {"expired"}:
        return "expired", value
    return "payment_pending", value or "unknown"


def _extract_checkout_status(payload: dict) -> tuple[str, str, Optional[str]]:
    status_candidates = [
        payload.get("status"),
        payload.get("state"),
        ((payload.get("transaction") or {}).get("status") if isinstance(payload.get("transaction"), dict) else None),
    ]
    transactions = payload.get("transactions") if isinstance(payload.get("transactions"), list) else []
    if transactions:
        latest = transactions[-1] if isinstance(transactions[-1], dict) else {}
        status_candidates.extend([latest.get("status"), latest.get("state")])
    status_raw = next((x for x in status_candidates if _norm(x)), "")
    tx_id = _norm(payload.get("transaction_id") or payload.get("transaction_code") or payload.get("id") or "") or None
    if transactions:
        latest = transactions[-1] if isinstance(transactions[-1], dict) else {}
        tx_id = _norm(latest.get("id") or tx_id) or tx_id
    status_norm, status_source = _normalize_sumup_status(status_raw)
    return status_norm, status_source, tx_id


async def get_sumup_status(current_user: dict) -> dict:
    cfg = load_sumup_settings()
    if not can_view_sumup_status(current_user, cfg):
        raise HTTPException(status_code=403, detail="Accesso negato")
    return {
        "enabled": bool(cfg.enabled),
        "configured": bool(cfg.configured),
        "reader_configured": bool(cfg.reader_present),
        "base_url": cfg.base_url,
        "merchant_code_present": bool(cfg.merchant_code),
        "terminal_present": bool(cfg.terminal_present),
        "reader_present": bool(cfg.reader_present),
        "currency": cfg.currency,
        "allowed_username": cfg.allowed_username,
    }

def _reader_device_info(raw: dict) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    device = raw.get("device")
    if isinstance(device, dict):
        return device
    info = {}
    for key in ("model", "serial_number", "serial", "hardware_type", "firmware_version", "ip_address", "label"):
        value = raw.get(key)
        if value is not None and str(value).strip() != "":
            info[key] = value
    return info or None


async def get_sumup_readers(current_user: dict) -> dict:
    cfg = load_sumup_settings()
    if not can_view_sumup_status(current_user, cfg):
        raise HTTPException(status_code=403, detail="Accesso negato")
    if not cfg.enabled:
        raise HTTPException(status_code=503, detail="SUMUP_ENABLED=false")
    if not cfg.base_configured:
        raise HTTPException(status_code=503, detail="SumUp non configurato (API key/merchant code mancanti)")

    client = SumupClient(cfg)
    try:
        readers_raw = await client.list_readers()
    except SumupConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except SumupClientError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    readers = []
    for reader in readers_raw:
        rid = _norm(reader.get("id") or reader.get("reader_id"))
        if not rid:
            continue
        readers.append(
            {
                "id": rid,
                "name": _norm(reader.get("name") or reader.get("label") or reader.get("reader_name")) or None,
                "status": _norm(reader.get("status") or reader.get("state") or reader.get("connection_status")) or None,
                "device": _reader_device_info(reader),
            }
        )
    return {
        "merchant_code": cfg.merchant_code,
        "count": len(readers),
        "readers": readers,
    }


async def scan_item(data: CashRegisterScanRequest, current_user: dict) -> dict:
    cfg = load_sumup_settings()
    require_sumup_cashier(current_user, cfg)
    code = data.code
    if not code:
        raise HTTPException(status_code=400, detail="barcode/sku obbligatorio")

    try:
        result = await legacy.get_product_by_barcode(code, current_user=current_user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[SUMUP_SCAN_ERROR] code=%s", code)
        raise HTTPException(status_code=500, detail=f"Errore scansione: {exc}")

    product = result.get("product") or {}
    variant = result.get("variant") or {}
    location_id = _norm(data.location_id)
    available_qty = None
    candidate_level = None
    if location_id:
        available_qty, candidate_level = await _compute_availability_row(_norm(variant.get("id")), location_id, 1)

    item = {
        "product_id": _norm(product.get("id")),
        "variant_id": _norm(variant.get("id")),
        "sku": _norm(variant.get("sku")) or None,
        "barcode": _norm(variant.get("barcode") or variant.get("upc_backup")) or None,
        "title": _norm(product.get("title")),
        "variant_title": _norm(variant.get("title")),
        "unit_price": float(variant.get("price") or 0),
        "quantity": 1,
        "available_qty": available_qty,
        "inventory_level_id": _norm((candidate_level or {}).get("id")) or None,
        "shelf_id": _norm((candidate_level or {}).get("shelf_id")) or None,
    }
    await _append_audit("-", "scan_item", current_user, {"code": code, "item": item})
    logger.info("[SUMUP_SCAN_ITEM] user=%s code=%s variant_id=%s", _norm(current_user.get("username")), code, item["variant_id"])
    return {"item": item}


async def _build_sale_items(location_id: str, items: List[CashRegisterSaleItemInput]) -> tuple[List[dict], float]:
    normalized_items: List[dict] = []
    subtotal = 0.0

    for raw_item in items:
        product, variant = await _find_product_with_variant(raw_item.variant_id)
        available_qty, candidate = await _compute_availability_row(raw_item.variant_id, location_id, raw_item.quantity)
        if available_qty < int(raw_item.quantity):
            raise HTTPException(
                status_code=400,
                detail=f"Disponibilita insufficiente per {product.get('title')} ({variant.get('title') or '-'}) - richiesti {raw_item.quantity}, disponibili {available_qty}",
            )
        if not candidate:
            raise HTTPException(
                status_code=409,
                detail=f"Disponibilita frammentata su piu scaffali per {product.get('title')} ({variant.get('title') or '-'}) - seleziona qty inferiore o riallinea stock",
            )
        original_price, unit_price, manual_applied = _resolve_unit_price(variant.get("price"), raw_item.unit_price)
        qty = int(raw_item.quantity)
        line_total = float(unit_price * qty)
        subtotal += line_total
        normalized_items.append(
            {
                "product_id": _norm(product.get("id")),
                "variant_id": _norm(variant.get("id")),
                "sku": _norm(raw_item.sku or variant.get("sku")) or None,
                "barcode": _norm(raw_item.barcode or variant.get("barcode") or variant.get("upc_backup")) or None,
                "title": _norm(product.get("title")),
                "variant_title": _norm(variant.get("title")),
                "unit_price": float(unit_price),
                "original_price": float(original_price),
                "manual_price_applied": bool(manual_applied),
                "quantity": qty,
                "line_total": line_total,
                "inventory_level_id": _norm(candidate.get("id")) or None,
                "shelf_id": _norm(candidate.get("shelf_id")) or None,
            }
        )

    return normalized_items, float(round(subtotal, 2))


async def create_sale(data: CashRegisterSaleCreateRequest, current_user: dict) -> dict:
    cfg = load_sumup_settings()
    require_sumup_cashier(current_user, cfg)
    await repository.ensure_indexes(db)
    location = await _load_location(data.location_id)
    if not data.items:
        raise HTTPException(status_code=400, detail="Carrello vuoto")

    items, subtotal = await _build_sale_items(location["id"], data.items)
    sale_id = str(uuid.uuid4())
    now = _now()
    sale_doc = CashRegisterSaleDoc(
        id=sale_id,
        user_id=_norm(current_user.get("id")),
        username=_norm(current_user.get("username")),
        location_id=location["id"],
        location_name=_norm(location.get("name")) or None,
        items=items,
        subtotal=subtotal,
        discounts_total=0.0,
        total_amount=subtotal,
        currency=cfg.currency,
        status="ready",
        created_at=now,
        updated_at=now,
    ).model_dump()
    if _norm(data.note):
        sale_doc["note"] = _norm(data.note)

    await repository.insert_sale(db, sale_doc)
    await _append_audit(sale_id, "create_sale", current_user, {"items": items, "total": subtotal})
    logger.info("[SUMUP_CREATE_SALE] sale_id=%s user=%s items=%s total=%.2f", sale_id, sale_doc["username"], len(items), subtotal)
    return sale_doc


async def _load_sale_or_404(sale_id: str) -> dict:
    sale = await repository.get_sale(db, _norm(sale_id))
    if not sale:
        raise HTTPException(status_code=404, detail="Vendita non trovata")
    return sale


async def _sync_sale_status_from_sumup(sale: dict, *, current_user: Optional[dict] = None) -> dict:
    settings = load_sumup_settings()
    client_transaction_id = _norm(sale.get("sumup_checkout_id") or sale.get("id"))
    if not client_transaction_id:
        return sale

    client = SumupClient(settings)
    try:
        checkout = await client.get_transaction_by_client_transaction_id(client_transaction_id)
    except SumupConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except SumupClientError as exc:
        if int(exc.status_code or 0) == 404:
            # Reader checkout may still be pending and not materialized yet in transaction search.
            return sale
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    status_norm, status_source, tx_id = _extract_checkout_status(checkout)
    updates: Dict[str, Any] = {
        "sumup_status": status_source,
        "sumup_checkout_payload": _json_safe_payload(checkout),
    }
    if tx_id:
        updates["sumup_transaction_id"] = tx_id

    if status_norm == "paid":
        updates["status"] = "paid"
        if not sale.get("paid_at"):
            updates["paid_at"] = _now()
    elif status_norm in {"failed", "cancelled", "expired"}:
        updates["status"] = status_norm
    else:
        updates["status"] = "payment_pending"

    await repository.update_sale(db, sale["id"], updates)
    sale = await _load_sale_or_404(sale["id"])

    actor = current_user or {"username": "system"}
    await _append_audit(
        sale["id"],
        "payment_status_update",
        actor,
        {"client_transaction_id": client_transaction_id, "status": sale.get("status"), "sumup_status": status_source},
    )
    logger.info("[SUMUP_STATUS_SYNC] sale_id=%s status=%s sumup_status=%s", sale["id"], sale.get("status"), status_source)
    return sale


async def _commit_inventory_if_paid(sale: dict, current_user: dict) -> dict:
    if _norm(sale.get("status")) not in {"paid", "inventory_committed", "inventory_commit_failed"}:
        return sale
    if sale.get("inventory_committed_at") or _norm(sale.get("status")) == "inventory_committed":
        return sale

    tx_ids: List[str] = []
    try:
        for item in (sale.get("items") or []):
            req = legacy.SaleRequest(
                variant_id=_norm(item.get("variant_id")),
                location_id=_norm(sale.get("location_id")),
                inventory_level_id=_norm(item.get("inventory_level_id")) or None,
                shelf_id=_norm(item.get("shelf_id")) or None,
                quantity=int(item.get("quantity") or 0),
                sale_price=float(item.get("unit_price") or 0),
                sale_channel=legacy.SaleChannel.STORE,
                payment_method=legacy.PaymentMethod.CARD,
                payment_status=legacy.PaymentStatus.PAID,
                da_contabilizzare=True,
                identity_id=None,
            )
            res = await legacy.sale_inventory(req, current_user=current_user)
            tx_id = _norm((res or {}).get("transaction_id"))
            if tx_id:
                tx_ids.append(tx_id)
    except HTTPException as exc:
        await repository.update_sale(
            db,
            sale["id"],
            {
                "status": "inventory_commit_failed",
                "error_message": str(exc.detail),
            },
            extra_ops={"$addToSet": {"inventory_commit_tx_ids": {"$each": tx_ids}} if tx_ids else None},
        )
        await _append_audit(
            sale["id"],
            "inventory_commit_failed",
            current_user,
            {"error": str(exc.detail), "tx_ids": tx_ids},
        )
        logger.error("[SUMUP_INVENTORY_COMMIT_FAILED] sale_id=%s err=%s", sale["id"], exc.detail)
        return await _load_sale_or_404(sale["id"])

    await repository.update_sale(
        db,
        sale["id"],
        {
            "status": "inventory_committed",
            "inventory_committed_at": _now(),
            "error_message": None,
        },
        extra_ops={"$addToSet": {"inventory_commit_tx_ids": {"$each": tx_ids}} if tx_ids else None},
    )
    await _append_audit(sale["id"], "inventory_commit_success", current_user, {"tx_ids": tx_ids})
    logger.info("[SUMUP_INVENTORY_COMMIT_OK] sale_id=%s tx=%s", sale["id"], len(tx_ids))
    return await _load_sale_or_404(sale["id"])


async def send_sale_to_sumup(sale_id: str, current_user: dict) -> dict:
    settings = load_sumup_settings()
    require_sumup_cashier(current_user, settings)
    await repository.ensure_indexes(db)
    if not settings.enabled:
        raise HTTPException(status_code=503, detail="SUMUP_ENABLED=false")
    if not settings.base_configured:
        raise HTTPException(status_code=503, detail="SumUp non configurato (API key/merchant code mancanti)")
    if not settings.reader_present:
        raise HTTPException(status_code=503, detail="SUMUP_READER_ID mancante")

    sale = await _load_sale_or_404(sale_id)
    status_now = _norm(sale.get("status"))
    if status_now in {"inventory_committed", "paid"}:
        return sale
    if status_now in {"cancelled", "expired"}:
        raise HTTPException(status_code=400, detail=f"Vendita non inviabile in stato {status_now}")

    if not sale.get("items"):
        raise HTTPException(status_code=400, detail="Vendita senza righe")

    rebuilt_items, subtotal = await _build_sale_items(_norm(sale.get("location_id")), [CashRegisterSaleItemInput(**item) for item in (sale.get("items") or [])])
    await repository.update_sale(
        db,
        sale["id"],
        {
            "items": rebuilt_items,
            "subtotal": subtotal,
            "total_amount": subtotal,
            "currency": settings.currency,
            "status": "ready",
            "error_message": None,
        },
    )
    sale = await _load_sale_or_404(sale["id"])

    checkout_id = _norm(sale.get("sumup_checkout_id"))
    if checkout_id and _norm(sale.get("status")) in {"payment_pending", "sumup_payment_created"}:
        sale = await _sync_sale_status_from_sumup(sale, current_user=current_user)
        if _norm(sale.get("status")) in {"paid", "inventory_committed"}:
            return await _commit_inventory_if_paid(sale, current_user)
        return sale

    client = SumupClient(settings)
    try:
        checkout = await client.create_reader_checkout(
            sale_id=sale["id"],
            amount=float(sale.get("total_amount") or 0),
            currency=settings.currency,
            description=f"SharkDrop cassa {sale.get('location_name') or sale.get('location_id')}",
        )
    except SumupConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except SumupClientError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    checkout_id = _norm(
        checkout.get("client_transaction_id")
        or checkout.get("checkout_reference")
        or checkout.get("id")
        or checkout.get("checkout_id")
        or checkout.get("checkoutId")
        or sale["id"]
    )
    if not checkout_id:
        raise HTTPException(status_code=502, detail="SumUp non ha restituito client transaction id")

    status_norm, status_source, tx_id = _extract_checkout_status(checkout)
    mapped_status = "payment_pending" if status_norm == "payment_pending" else status_norm
    if mapped_status not in CASH_SALE_STATUSES:
        mapped_status = "payment_pending"

    await repository.update_sale(
        db,
        sale["id"],
        {
            "status": mapped_status,
            "sumup_checkout_id": checkout_id,
            "sumup_status": status_source,
            "sumup_checkout_payload": _json_safe_payload(checkout),
            "sumup_transaction_id": tx_id,
            "payment_pending_at": _now(),
        },
    )
    await _append_audit(
        sale["id"],
        "send_to_sumup",
        current_user,
        {"client_transaction_id": checkout_id, "sumup_status": status_source, "status": mapped_status},
    )
    logger.info("[SUMUP_SEND] sale_id=%s checkout=%s status=%s", sale["id"], checkout_id, mapped_status)

    sale = await _load_sale_or_404(sale["id"])
    if _norm(sale.get("status")) == "paid":
        sale = await _commit_inventory_if_paid(sale, current_user)
    return sale


async def get_sale_status(sale_id: str, current_user: dict) -> dict:
    settings = load_sumup_settings()
    if not can_view_sumup_status(current_user, settings):
        raise HTTPException(status_code=403, detail="Accesso negato")

    sale = await _load_sale_or_404(sale_id)
    if _norm(sale.get("sumup_checkout_id")) and _norm(sale.get("status")) in {
        "payment_pending",
        "sumup_payment_created",
        "paid",
    }:
        sale = await _sync_sale_status_from_sumup(sale, current_user=current_user)

    if is_sumup_cashier(current_user, settings):
        sale = await _commit_inventory_if_paid(sale, current_user)

    return sale


async def cancel_sale(sale_id: str, current_user: dict, reason: Optional[str] = None) -> dict:
    settings = load_sumup_settings()
    require_sumup_cashier(current_user, settings)

    sale = await _load_sale_or_404(sale_id)
    st = _norm(sale.get("status"))
    if st in {"inventory_committed", "paid"}:
        raise HTTPException(status_code=400, detail="Vendita gia pagata/committed: annullamento non consentito")

    await repository.update_sale(
        db,
        sale["id"],
        {
            "status": "cancelled",
            "error_message": _norm(reason) or None,
        },
    )
    await _append_audit(sale["id"], "cancel_sale", current_user, {"reason": _norm(reason) or None})
    logger.info("[SUMUP_CANCEL_SALE] sale_id=%s reason=%s", sale["id"], _norm(reason))
    return await _load_sale_or_404(sale["id"])


async def handle_webhook(payload: dict, headers: dict) -> dict:
    settings = load_sumup_settings()
    if settings.webhook_secret:
        header_secret = _norm(headers.get("x-sumup-webhook-secret") or headers.get("X-SumUp-Webhook-Secret"))
        if header_secret != settings.webhook_secret:
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    checkout_id = _norm(
        payload.get("checkout_id")
        or payload.get("client_transaction_id")
        or payload.get("id")
        or ((payload.get("data") or {}).get("checkout_id") if isinstance(payload.get("data"), dict) else "")
        or ((payload.get("data") or {}).get("client_transaction_id") if isinstance(payload.get("data"), dict) else "")
    )
    if not checkout_id:
        return {"ok": True, "skipped": True, "reason": "missing_checkout_id"}

    sale = await repository.get_sale_by_checkout_id(db, checkout_id)
    if not sale:
        logger.warning("[SUMUP_WEBHOOK_NO_SALE] checkout_id=%s", checkout_id)
        return {"ok": True, "skipped": True, "reason": "sale_not_found", "checkout_id": checkout_id}

    status_norm, status_source, tx_id = _extract_checkout_status(payload)
    mapped_status = "payment_pending" if status_norm == "payment_pending" else status_norm
    updates: Dict[str, Any] = {
        "status": mapped_status,
        "sumup_status": status_source,
        "sumup_webhook_payload": _json_safe_payload(payload),
    }
    if tx_id:
        updates["sumup_transaction_id"] = tx_id
    if mapped_status == "paid" and not sale.get("paid_at"):
        updates["paid_at"] = _now()

    await repository.update_sale(db, sale["id"], updates)
    sale = await _load_sale_or_404(sale["id"])
    await _append_audit(sale["id"], "webhook_status_update", {"username": "sumup_webhook"}, updates)

    # Inventory commit only if enabled and payment paid. Uses pseudo-user for audit trace.
    if _norm(sale.get("status")) == "paid":
        pseudo_user = {
            "id": sale.get("user_id") or "sumup_webhook",
            "username": settings.allowed_username,
            "role": UserRole.ADMIN.value,
        }
        sale = await _commit_inventory_if_paid(sale, pseudo_user)

    logger.info("[SUMUP_WEBHOOK] sale_id=%s checkout=%s status=%s", sale["id"], checkout_id, sale.get("status"))
    return {"ok": True, "sale_id": sale["id"], "status": sale.get("status")}
