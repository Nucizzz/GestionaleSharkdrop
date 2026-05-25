from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

SALES_COLLECTION = "cash_register_sales"
AUDIT_COLLECTION = "cash_register_sale_audit"

_indexes_ready = False


async def ensure_indexes(db) -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    await db[SALES_COLLECTION].create_index("id", unique=True)
    await db[SALES_COLLECTION].create_index("status")
    await db[SALES_COLLECTION].create_index("sumup_checkout_id")
    await db[SALES_COLLECTION].create_index("created_at")
    await db[AUDIT_COLLECTION].create_index("sale_id")
    await db[AUDIT_COLLECTION].create_index("created_at")
    _indexes_ready = True


async def insert_sale(db, doc: Dict[str, Any]) -> None:
    await db[SALES_COLLECTION].insert_one(doc)


async def get_sale(db, sale_id: str) -> Optional[Dict[str, Any]]:
    return await db[SALES_COLLECTION].find_one({"id": sale_id}, {"_id": 0})


async def get_sale_by_checkout_id(db, checkout_id: str) -> Optional[Dict[str, Any]]:
    return await db[SALES_COLLECTION].find_one({"sumup_checkout_id": checkout_id}, {"_id": 0})


async def update_sale(db, sale_id: str, updates: Dict[str, Any], *, extra_ops: Optional[Dict[str, Any]] = None) -> bool:
    patch: Dict[str, Any] = {"$set": {**updates, "updated_at": datetime.utcnow()}}
    if extra_ops:
        for op, payload in extra_ops.items():
            if payload:
                patch[op] = payload
    res = await db[SALES_COLLECTION].update_one({"id": sale_id}, patch)
    return bool(res.matched_count)


async def append_audit(db, sale_id: str, event: str, username: str, payload: Optional[Dict[str, Any]] = None) -> None:
    await db[AUDIT_COLLECTION].insert_one(
        {
            "sale_id": str(sale_id or "").strip(),
            "event": str(event or "").strip(),
            "username": str(username or "system").strip() or "system",
            "payload": payload or {},
            "created_at": datetime.utcnow(),
        }
    )
