from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.core.deps import log_action
from app.core.models import ActionType
from app.core.public_helpers import (
    _normalize_description_text,
    _product_public_detail_gallery_urls,
    _product_public_gallery_urls,
    _search_tokens,
    _variant_sort_key,
)
from app.domains.public_catalog import repository
from app.domains.public_catalog.schemas import PublicCatalogLink, PublicCatalogLinkCreate


def _user_is_stock_viewer(user: Optional[dict]) -> bool:
    role = str((user or {}).get("role") or "").strip().lower()
    return role == "stock_viewer"


async def _get_variant_qty_map_for_products(db, product_ids: List[str], location_id: Optional[str] = None) -> Dict[str, int]:
    ids = [str(pid or "").strip() for pid in (product_ids or []) if str(pid or "").strip()]
    if not ids:
        return {}
    # Public catalog is never location-scoped. Keep arg for backward compatibility only.
    _ = location_id
    docs = await repository.find_products_by_ids(
        db,
        ids,
        projection={"_id": 0, "variants.id": 1},
    )
    variant_ids: List[str] = []
    for doc in docs:
        for variant in (doc.get("variants") or []):
            vid = str(variant.get("id") or "").strip()
            if vid:
                variant_ids.append(vid)
    if not variant_ids:
        return {}
    return await repository.aggregate_variant_qty(db, variant_ids, None)


def _public_catalog_variant_payload(variant: dict, quantity: int) -> Dict[str, Any]:
    return {
        "id": str(variant.get("id") or "").strip(),
        "title": str(variant.get("title") or "").strip(),
        "sku": str(variant.get("sku") or "").strip() or None,
        "barcode": str(variant.get("barcode") or "").strip() or None,
        "upc_backup": str(variant.get("upc_backup") or "").strip() or None,
        "quantity": int(quantity or 0),
    }


def _public_catalog_product_payload(product: dict, qty_by_variant: Dict[str, int]) -> Dict[str, Any]:
    variants = []
    qty_total = 0
    available_sizes: List[str] = []
    for variant in sorted(
        [v for v in (product.get("variants") or []) if not bool(v.get("hidden"))],
        key=lambda v: _variant_sort_key(str(v.get("title") or "")),
    ):
        vid = str(variant.get("id") or "").strip()
        qty = int(qty_by_variant.get(vid, 0))
        qty_total += qty
        title = str(variant.get("title") or "").strip()
        if qty > 0 and title:
            available_sizes.append(title)
        variants.append(_public_catalog_variant_payload(variant, qty))
    gallery_urls = _product_public_gallery_urls(product)
    detail_gallery_urls = _product_public_detail_gallery_urls(product)
    return {
        "id": str(product.get("id") or "").strip(),
        "title": str(product.get("title") or "").strip(),
        "description": _normalize_description_text(product.get("description")),
        "vendor": str(product.get("vendor") or "").strip() or None,
        "product_type": str(product.get("product_type") or "").strip() or None,
        "tags": [str(t or "").strip() for t in (product.get("tags") or []) if str(t or "").strip()],
        "is_active": bool(product.get("is_active", True)),
        "qty_total": qty_total,
        "available_sizes": available_sizes,
        "image_urls": detail_gallery_urls,
        "thumb_url": gallery_urls[0] if gallery_urls else None,
        "variants": variants,
        "updated_at": product.get("updated_at"),
    }


def _public_catalog_item_matches_query(item: Dict[str, Any], query: Optional[str]) -> bool:
    tokens = _search_tokens(query)
    if not tokens:
        return True
    variant_bits: List[str] = []
    for variant in (item.get("variants") or []):
        if not isinstance(variant, dict):
            continue
        variant_bits.extend(
            [
                str(variant.get("title") or ""),
                str(variant.get("sku") or ""),
                str(variant.get("barcode") or ""),
                str(variant.get("upc_backup") or ""),
            ]
        )
    hay = " ".join(
        [
            str(item.get("title") or ""),
            str(item.get("vendor") or ""),
            str(item.get("product_type") or ""),
            " ".join(variant_bits),
        ]
    ).lower()
    return all(token in hay for token in tokens)


def _public_catalog_hide_exact_quantities(item: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(item or {})
    total_qty = int(out.get("qty_total") or 0)
    out["qty_total"] = 1 if total_qty > 0 else 0
    variants_out: List[Dict[str, Any]] = []
    for variant in (out.get("variants") or []):
        if not isinstance(variant, dict):
            continue
        one = dict(variant)
        qty = int(one.get("quantity") or 0)
        one["quantity"] = 1 if qty > 0 else 0
        variants_out.append(one)
    out["variants"] = variants_out
    return out


async def _get_public_catalog_products_payload(db, product_ids: List[str], location_id: Optional[str] = None) -> List[Dict[str, Any]]:
    # Public catalog must always use global aggregated inventory.
    _ = location_id
    ordered_ids = []
    seen_ids: set[str] = set()
    for raw in (product_ids or []):
        pid = str(raw or "").strip()
        if not pid or pid in seen_ids:
            continue
        seen_ids.add(pid)
        ordered_ids.append(pid)
    if not ordered_ids:
        return []
    docs = await repository.find_products_by_ids(
        db,
        ordered_ids,
        projection={
            "_id": 0,
            "id": 1,
            "title": 1,
            "description": 1,
            "vendor": 1,
            "product_type": 1,
            "tags": 1,
            "is_active": 1,
            "updated_at": 1,
            "image_url": 1,
            "image_urls": 1,
            "image_base64": 1,
            "variants.id": 1,
            "variants.title": 1,
            "variants.sku": 1,
            "variants.barcode": 1,
            "variants.upc_backup": 1,
            "variants.hidden": 1,
        },
    )
    doc_by_id = {str(doc.get("id") or "").strip(): doc for doc in docs if str(doc.get("id") or "").strip()}
    qty_by_variant = await _get_variant_qty_map_for_products(db, ordered_ids, None)
    items: List[Dict[str, Any]] = []
    for pid in ordered_ids:
        product = doc_by_id.get(pid)
        if not product:
            continue
        items.append(_public_catalog_product_payload(product, qty_by_variant))
    return items


async def create_public_catalog_link(db, data: PublicCatalogLinkCreate, current_user: dict):
    if _user_is_stock_viewer(current_user):
        raise HTTPException(status_code=403, detail="Ruolo sola lettura: operazione non consentita")

    product_ids: List[str] = []
    seen: set[str] = set()
    for raw in (data.product_ids or []):
        pid = str(raw or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        product_ids.append(pid)
    if not product_ids:
        raise HTTPException(status_code=400, detail="Seleziona almeno un prodotto")
    if len(product_ids) > 2000:
        raise HTTPException(status_code=400, detail="Troppi prodotti selezionati")

    existing_products = await repository.find_products_by_ids(db, product_ids, projection={"_id": 0, "id": 1, "title": 1})
    existing_ids = {str(p.get("id") or "").strip() for p in existing_products if str(p.get("id") or "").strip()}
    product_ids = [pid for pid in product_ids if pid in existing_ids]
    if not product_ids:
        raise HTTPException(status_code=400, detail="I prodotti selezionati non esistono piu")

    title = str(data.title or "").strip() or "SharkDrop"
    note = str(data.note or "").strip() or None
    filters = data.filters if isinstance(data.filters, dict) else None
    show_quantities = bool(data.show_quantities if data.show_quantities is not None else True)

    link = PublicCatalogLink(
        product_ids=product_ids,
        title=title,
        note=note,
        filters=filters,
        show_quantities=show_quantities,
        created_by=str(current_user.get("id") or ""),
        created_by_username=str(current_user.get("username") or ""),
    )
    await repository.insert_public_catalog_link(db, link)

    await log_action(
        ActionType.SHOPIFY_UPDATE,
        current_user,
        f"Created public catalog link: {title} ({len(product_ids)} prodotti)",
        entity_type="public_catalog_link",
        entity_id=link.id,
        new_data={
            "title": title,
            "product_ids": product_ids[:200],
            "product_count": len(product_ids),
            "filters": filters,
            "show_quantities": show_quantities,
        },
    )

    return {
        "id": link.id,
        "token": link.token,
        "title": link.title,
        "note": link.note,
        "created_at": link.created_at,
        "product_count": len(product_ids),
        "show_quantities": show_quantities,
    }


async def list_public_catalog_links(db, current_user: dict):
    if _user_is_stock_viewer(current_user):
        raise HTTPException(status_code=403, detail="Ruolo sola lettura: operazione non consentita")
    rows = await repository.list_public_catalog_links(db)
    items = []
    for row in rows:
        product_ids = [str(pid or "").strip() for pid in (row.get("product_ids") or []) if str(pid or "").strip()]
        items.append(
            {
                "id": row.get("id"),
                "token": row.get("token"),
                "title": row.get("title"),
                "note": row.get("note"),
                "created_at": row.get("created_at"),
                "created_by_username": row.get("created_by_username"),
                "status": row.get("status") or "active",
                "product_count": len(product_ids),
                "filters": row.get("filters") or {},
                "show_quantities": bool(row.get("show_quantities", True)),
            }
        )
    return items


async def get_public_catalog(db, token: str, search: Optional[str] = None):
    link = await repository.find_public_catalog_link_by_token_active(db, token)
    if not link:
        raise HTTPException(status_code=404, detail="Catalogo non trovato")
    products = await _get_public_catalog_products_payload(db, link.get("product_ids") or [], None)
    show_quantities = bool(link.get("show_quantities", True))
    if not show_quantities:
        products = [_public_catalog_hide_exact_quantities(item) for item in products]
    visible_items = [item for item in products if _public_catalog_item_matches_query(item, search)]
    return {
        "id": link.get("id"),
        "title": link.get("title"),
        "note": link.get("note"),
        "created_at": link.get("created_at"),
        "product_count": len(products),
        "visible_count": len(visible_items),
        "show_quantities": show_quantities,
        "items": visible_items,
    }


async def get_public_catalog_product(db, token: str, product_id: str):
    link = await repository.find_public_catalog_link_by_token_active(
        db,
        token,
        projection={"_id": 0, "product_ids": 1, "title": 1, "filters": 1, "show_quantities": 1},
    )
    if not link:
        raise HTTPException(status_code=404, detail="Catalogo non trovato")
    allowed_ids = {str(pid or "").strip() for pid in (link.get("product_ids") or []) if str(pid or "").strip()}
    pid = str(product_id or "").strip()
    if not pid or pid not in allowed_ids:
        raise HTTPException(status_code=404, detail="Prodotto non presente in questo catalogo")
    items = await _get_public_catalog_products_payload(db, [pid], None)
    if not items:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    show_quantities = bool(link.get("show_quantities", True))
    product_payload = items[0]
    if not show_quantities:
        product_payload = _public_catalog_hide_exact_quantities(product_payload)
    return {
        "catalog_title": link.get("title"),
        "show_quantities": show_quantities,
        "product": product_payload,
    }
