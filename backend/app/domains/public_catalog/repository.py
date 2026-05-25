from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.domains.public_catalog.schemas import PublicCatalogLink


async def find_products_by_ids(db, product_ids: List[str], projection: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    return await db.products.find({"id": {"$in": product_ids}}, projection or {"_id": 0}).to_list(max(len(product_ids), 1))


async def insert_public_catalog_link(db, link: PublicCatalogLink) -> None:
    await db.public_catalog_links.insert_one(link.dict())


async def list_public_catalog_links(db) -> List[Dict[str, Any]]:
    return await db.public_catalog_links.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)


async def find_public_catalog_link_by_token_active(db, token: str, projection: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    return await db.public_catalog_links.find_one({"token": token, "status": "active"}, projection or {"_id": 0})


async def aggregate_variant_qty(db, variant_ids: List[str], location_id: Optional[str] = None) -> Dict[str, int]:
    # Public catalog must always expose global availability (all locations aggregated).
    # `location_id` is intentionally ignored for backward compatibility of callers.
    _ = location_id
    qty_match: Dict[str, Any] = {"variant_id": {"$in": list(set(variant_ids))}}
    rows = await db.inventory_levels.aggregate(
        [
            {"$match": qty_match},
            {"$group": {"_id": "$variant_id", "q": {"$sum": {"$ifNull": ["$quantity", 0]}}}},
        ]
    ).to_list(max(len(variant_ids), 1))
    return {str(r.get("_id")): int(r.get("q") or 0) for r in rows}
