#!/usr/bin/env python3
# BARCODES_TUTTI_PRODOTTI_REPLACE_VARIANTS_STOCKX_BY_PRODUCT_TYPE.py
#
# FOR ALL PRODUCTS matching PRODUCT_TYPE_FILTER (default "Scarpe"):
# + RULES:
#   1) If product has tag "NOMODIFICA" (case-insensitive) => SKIP COMPLETAMENTE.
#   2) If product has a numeric tag between 35 and 50 (e.g. "44"):
#        - For sizes < TAG_NUMBER: NON MODIFICA TAGLIE/PREZZI/VARIANTI. (NON DELETE/CREATE/RENAME)
#          -> fa SOLO update BARCODE (se presente da StockX) sulle varianti esistenti sotto soglia.
#        - For sizes >= TAG_NUMBER: applica la logica completa (prezzi + forzatura varianti StockX).
#
# DEFAULT SIZE RANGE (NEW):
#   - By default it only considers EU sizes between 35 and 49.5 (inclusive).
#   - You can override with env EU_MIN / EU_MAX.
#
# REQUIRED ENV:
#   SHOP_DOMAIN, ADMIN_API_TOKEN, KICKS_API_KEY, LOCATION_ID
#
# OPTIONAL ENV:
#   API_VERSION=2024-10
#   KICKS_MARKET=IT
#   PRICE_TYPE_PREFERRED=standard
#   PRODUCT_TYPE_FILTER=Scarpe
#   DRY_RUN=0/1
#   MAX_PRODUCTS=0
#   START_AFTER_ID=
#   START_FROM_INDEX=1
#   SLEEP_SECS=0.25
#   LOG_DIR=./logs
#   STOP_ON_KICKS_AUTH_FAIL=1
#   EU_MIN=35
#   EU_MAX=49.5
#   FORCE_QTY=0
#
# OUTPUT:
#   - run log file (txt) + summary json in LOG_DIR

import os
import re
import time
import json
import requests
import logging
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ==============================
# ENV / CONFIG
# ==============================
SHOP_DOMAIN = os.getenv("SHOP_DOMAIN")
TOKEN = os.getenv("ADMIN_API_TOKEN")
API_VERSION = os.getenv("API_VERSION", "2024-10")

KICKS_KEY = os.getenv("KICKS_API_KEY")
MARKET = (os.getenv("KICKS_MARKET", "IT") or "IT").strip().upper()

LOCATION_ID = int(os.getenv("LOCATION_ID", "0") or "0")
if LOCATION_ID <= 0:
    raise SystemExit("Missing/invalid env var: LOCATION_ID (must be > 0)")

PRODUCT_TYPE_FILTER = (os.getenv("PRODUCT_TYPE_FILTER", "Scarpe") or "Scarpe").strip()
PRICE_TYPE_PREFERRED = (os.getenv("PRICE_TYPE_PREFERRED", "standard") or "standard").strip().lower()

MAX_PRODUCTS = int(os.getenv("MAX_PRODUCTS", "0") or "0")
START_AFTER_ID = (os.getenv("START_AFTER_ID", "") or "").strip()
START_FROM_INDEX = int(os.getenv("START_FROM_INDEX", "1") or "1")
if START_FROM_INDEX < 1:
    START_FROM_INDEX = 1

SLEEP_SECS = float(os.getenv("SLEEP_SECS", "0.25") or "0.25")

BUYER_FEE_PCT = float(os.getenv("BUYER_FEE_PCT", "0.08"))
SHIPPING_FLAT_EUR = float(os.getenv("SHIPPING_FLAT_EUR", "15"))
VAT_PCT = float(os.getenv("VAT_PCT", "0.00"))

WEIGHT_SNEAKERS_GRAMS = int(os.getenv("WEIGHT_SNEAKERS_GRAMS", "2000"))

# DEFAULT RANGE: 35..49.5
EU_MIN = float(os.getenv("EU_MIN", "35") or "35")
EU_MAX = float(os.getenv("EU_MAX", "49.5") or "49.5")

STOCKX_SLUG_NAMESPACE = os.getenv("STOCKX_SLUG_NAMESPACE", "custom").strip()
STOCKX_SLUG_KEY = os.getenv("STOCKX_SLUG_KEY", "stockx_slug").strip()

MF_NS = os.getenv("MF_NAMESPACE", "custom").strip()
MF_RELEASE_DATE_KEY = os.getenv("MF_RELEASE_DATE_KEY", "release_date").strip()
MF_IDENTIFIER_EXISTS_KEY = os.getenv("MF_IDENTIFIER_EXISTS_KEY", "identifier_exists").strip()

VARIANT_SIZE_METAFIELD = os.getenv("VARIANT_SIZE_METAFIELD", "1") == "1"
VARIANT_SIZE_NAMESPACE = os.getenv("VARIANT_SIZE_NAMESPACE", "custom").strip()
VARIANT_SIZE_KEY = os.getenv("VARIANT_SIZE_KEY", "shoe_size").strip()

UPC_BACKUP_METAFIELD = os.getenv("UPC_BACKUP_METAFIELD", "1") == "1"
UPC_BACKUP_NAMESPACE = os.getenv("UPC_BACKUP_NAMESPACE", "custom").strip()
UPC_BACKUP_KEY = os.getenv("UPC_BACKUP_KEY", "upc_backup").strip()

MM_GOOGLE_NS = os.getenv("MM_GOOGLE_NS", "mm-google-shopping").strip()
MM_KEY_CONDITION = os.getenv("MM_GOOGLE_KEY_CONDITION", "condition").strip()
MM_KEY_GENDER = os.getenv("MM_GOOGLE_KEY_GENDER", "gender").strip()
MM_KEY_AGE_GROUP = os.getenv("MM_GOOGLE_KEY_AGE_GROUP", "age_group").strip()
MM_KEY_MPN = os.getenv("MM_GOOGLE_KEY_MPN", "mpn").strip()

MM_VAL_CONDITION = os.getenv("GOOGLE_CONDITION_VALUE", "new").strip()
MM_VAL_GENDER = os.getenv("GOOGLE_GENDER_VALUE", "unisex").strip()

# FORCE ALL INVENTORY TO THIS VALUE (default 0)
FORCE_QTY = int(os.getenv("FORCE_QTY", "0") or "0")

DRY_RUN = os.getenv("DRY_RUN", "0") == "1"

REST_TIMEOUT = int(os.getenv("REST_TIMEOUT", "60"))
REST_TRIES = int(os.getenv("REST_TRIES", "6"))
REST_BACKOFF = float(os.getenv("REST_BACKOFF", "1.2"))

KX_TIMEOUT = int(os.getenv("KX_TIMEOUT", "30"))
KX_TRIES = int(os.getenv("KX_TRIES", "4"))
KX_BACKOFF = float(os.getenv("KX_BACKOFF", "0.8"))

STOP_ON_KICKS_AUTH_FAIL = os.getenv("STOP_ON_KICKS_AUTH_FAIL", "1") == "1"

LOG_DIR = (os.getenv("LOG_DIR", "./logs") or "./logs").strip()
os.makedirs(LOG_DIR, exist_ok=True)
RUN_TS = datetime.now().strftime("%Y%m%d_%H%M%S")
LOG_FILE = os.path.join(LOG_DIR, f"batch_stockx_sync_{RUN_TS}.log")
SUMMARY_FILE = os.path.join(LOG_DIR, f"batch_stockx_sync_{RUN_TS}_summary.json")

if not all([SHOP_DOMAIN, TOKEN, KICKS_KEY]):
    raise SystemExit("Missing env vars: SHOP_DOMAIN, ADMIN_API_TOKEN, KICKS_API_KEY")

SHOP_GQL = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
SHOP_REST = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}"
headers_shop = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}
headers_kx = {"Authorization": f"Bearer {KICKS_KEY}"}

# ==============================
# LOGGING
# ==============================
logger = logging.getLogger("batch_stockx_sync")
logger.setLevel(logging.INFO)
fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
fh.setLevel(logging.INFO)
fh.setFormatter(fmt)
logger.addHandler(fh)

sh = logging.StreamHandler()
sh.setLevel(logging.INFO)
sh.setFormatter(fmt)
logger.addHandler(sh)

def log(*args):
    logger.info(" ".join(str(a) for a in args))

def hr():
    log("-" * 130)

# ==============================
# SUMMARY COLLECTORS
# ==============================
summary = {
    "run_ts": RUN_TS,
    "shop_domain": SHOP_DOMAIN,
    "api_version": API_VERSION,
    "market": MARKET,
    "product_type_filter": PRODUCT_TYPE_FILTER,
    "price_type_preferred": PRICE_TYPE_PREFERRED,
    "dry_run": bool(DRY_RUN),
    "force_qty": FORCE_QTY,
    "eu_min": EU_MIN,
    "eu_max": EU_MAX,
    "start_after_id": START_AFTER_ID or None,
    "start_from_index": START_FROM_INDEX,
    "max_products": MAX_PRODUCTS or None,
    "stop_on_kicks_auth_fail": bool(STOP_ON_KICKS_AUTH_FAIL),
    "log_file": os.path.abspath(LOG_FILE),
    "summary_file": os.path.abspath(SUMMARY_FILE),
    "lists": {
        "nomodifica_skipped": [],
        "no_exact_stockx_match": [],
        "kicks_auth_failed": [],
        "other_failures": [],
        "partial_barcode_only_under_min": [],
        "touched_ok": [],
        "skipped_other": [],
    },
    "counters": {
        "seen_total": 0,
        "processed": 0,
        "ok": 0,
        "skipped": 0,
        "failed": 0,
    }
}

def write_summary_file():
    try:
        with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log("❌ Could not write summary file:", repr(e))

# ==============================
# HTTP RETRY
# ==============================
def request_retry(method, url, *, headers=None, params=None, json=None, timeout=30, tries=5, backoff=1.0):
    last = None
    for i in range(tries):
        try:
            r = requests.request(method, url, headers=headers, params=params, json=json, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(backoff * (2 ** i))
                last = r
                continue
            return r
        except Exception as e:
            last = e
            time.sleep(backoff * (2 ** i))
    if isinstance(last, requests.Response):
        last.raise_for_status()
    raise last

# ==============================
# HELPERS
# ==============================
def gql(query: str, variables: dict | None = None):
    r = request_retry(
        "POST",
        SHOP_GQL,
        headers=headers_shop,
        json={"query": query, "variables": variables or {}},
        timeout=REST_TIMEOUT,
        tries=REST_TRIES,
        backoff=REST_BACKOFF,
    )
    r.raise_for_status()
    out = r.json()
    if "errors" in out:
        raise RuntimeError(out["errors"])
    return out["data"]

def safe_str(x):
    if x is None:
        return None
    s = str(x).strip()
    return s if s else None

def gid_to_int(gid: str) -> int:
    m = re.search(r"/(\d+)$", gid or "")
    if not m:
        raise ValueError(f"Cannot parse numeric id from gid: {gid}")
    return int(m.group(1))

def _digits_only(s: str) -> str:
    return re.sub(r"\D+", "", (s or "").strip())

def sku_base_from_variant_sku(sku: str | None) -> str | None:
    s = (sku or "").strip().upper()
    if not s:
        return None
    return s.split("|", 1)[0].strip() or None

# --- Adidas thirds handling + aggressive cleanup ---
def eu_norm_keep_thirds(s: str) -> str:
    s = (s or "").strip().upper()
    s = s.replace("EU", "").strip()
    s = s.replace(",", ".")
    s = s.replace("⅓", ".333").replace("⅔", ".666")
    s = s.replace("1/3", ".333").replace("2/3", ".666")
    # keep only digits and dot
    s = re.sub(r"[^0-9\.]", "", s)
    return s

def eu_display_from_norm(n: str) -> str:
    n = (n or "").strip()
    if not n:
        return n
    if n.endswith(".333"):
        return n[:-4] + " 1/3"
    if n.endswith(".666"):
        return n[:-4] + " 2/3"
    if re.fullmatch(r"\d+\.0", n):
        return n.split(".")[0]
    return n

def eu_canonical_display_from_any(value: str) -> str:
    return eu_display_from_norm(eu_norm_keep_thirds(value))

def size_sort_key(size_display: str):
    n = eu_norm_keep_thirds(size_display)
    try:
        return float(n)
    except:
        return 9999.0

def size_in_range(size_display: str, mn: float, mx: float) -> bool:
    try:
        k = float(eu_norm_keep_thirds(size_display))
        return (k >= mn) and (k <= mx)
    except:
        return False

def parse_min_size_from_tags(tags: list[str]) -> int | None:
    """
    Cerca un tag con numero tra 35 e 50 (es: "44", "EU 44", "min 44").
    Se ce ne sono più, prende il MASSIMO (più restrittivo).
    """
    best = None
    for t in (tags or []):
        tt = (t or "").strip().upper()
        m = re.search(r"\b(3[5-9]|4\d|50)\b", tt)
        if not m:
            continue
        n = int(m.group(1))
        if 35 <= n <= 50:
            best = n if best is None else max(best, n)
    return best

def has_nomodifica_tag(tags: list[str]) -> bool:
    return any((t or "").strip().upper() == "NOMODIFICA" for t in (tags or []))

def compute_breakdown(base: float) -> dict:
    buyer_fee = base * BUYER_FEE_PCT
    pre_vat = base + buyer_fee + SHIPPING_FLAT_EUR
    vat = pre_vat * VAT_PCT
    all_in = pre_vat + vat
    return {
        "base": float(base),
        "buyer_fee": float(buyer_fee),
        "shipping": float(SHIPPING_FLAT_EUR),
        "pre_vat": float(pre_vat),
        "vat": float(vat),
        "all_in": float(all_in),
    }

def dynamic_markup(all_in: float) -> float:
    if all_in < 70: return 1.90
    if all_in < 100: return 1.50
    if all_in < 200: return 1.40
    if all_in < 300: return 1.25
    return 1.20

def round_eur(x: float) -> int:
    return int(round(x))

def normalize_release_date(rd: str | None) -> str | None:
    rd = (rd or "").strip()
    if not rd:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", rd):
        return rd[:10]
    if re.match(r"^\d{8}$", rd):
        return f"{rd[0:4]}-{rd[4:6]}-{rd[6:8]}"
    if re.match(r"^\d{4}-\d{2}$", rd):
        return f"{rd}-01"
    if re.match(r"^\d{4}$", rd):
        return f"{rd}-01-01"
    return None

def detect_age_group_value(title: str, slug: str = "") -> str:
    t = (title or "").upper()
    s = (slug or "").lower()
    kids_markers = ["KIDS", " GS", "(GS", " TD", "(TD", " PS", "(PS", " YOUTH", " (Y)", " INFANT", " TODDLER"]
    if any(m in t for m in kids_markers):
        return "kids"
    if s.endswith("-gs") or s.endswith("-td") or s.endswith("-ps"):
        return "kids"
    return "adult"

# ==============================
# PRICE PICK
# ==============================
def pick_price(prices: list, preferred: str) -> float:
    prices = prices or []
    pref = (preferred or "").strip().lower()

    for x in prices:
        t = (x.get("type") or "").strip().lower()
        if t == pref and x.get("price") is not None:
            try:
                return float(x["price"])
            except:
                pass

    for x in prices:
        if x.get("price") is not None:
            try:
                return float(x["price"])
            except:
                continue
    return 0.0

# ==============================
# IDENTIFIERS (YOUR FIXED RULES)
# ==============================
def choose_barcode_and_upc_backup(identifiers: list) -> tuple[str | None, str | None]:
    candidates_13 = []
    candidates_14 = []
    upc12 = None

    for x in (identifiers or []):
        t = (x.get("identifier_type") or x.get("identifierType") or "").strip().upper()
        v = _digits_only(x.get("identifier") or "")
        if not v:
            continue

        if len(v) == 12:
            if t == "UPC" or upc12 is None:
                upc12 = upc12 or v
        elif len(v) == 13:
            candidates_13.append(v)
        elif len(v) == 14:
            candidates_14.append(v)

    barcode = None
    for v in candidates_13:
        if v.startswith("40"):
            barcode = v
            break
    if not barcode and candidates_13:
        barcode = candidates_13[0]
    if not barcode and candidates_14:
        barcode = candidates_14[0]
    if not barcode and upc12:
        barcode = "0" + upc12

    backup = upc12
    if not backup and barcode and len(barcode) == 13 and barcode.startswith("0"):
        backup = barcode[1:]
    return barcode, backup

# ==============================
# SHOPIFY METAFIELDS + INVENTORY
# ==============================
def metafields_set_batched(items: list, batch_size: int = 25) -> bool:
    if not items:
        return True
    m = """
    mutation($metafields:[MetafieldsSetInput!]!){
      metafieldsSet(metafields:$metafields){
        metafields{ id key namespace }
        userErrors{ field message code }
      }
    }"""
    ok = True
    for i in range(0, len(items), batch_size):
        chunk = items[i:i + batch_size]
        if DRY_RUN:
            log("DRY_RUN metafieldsSet chunk=", len(chunk))
            continue
        data = gql(m, {"metafields": chunk})
        errs = data["metafieldsSet"]["userErrors"]
        if errs:
            ok = False
            log("❌ METAFIELDS ERR", errs)
    return ok

def set_product_mfs(product_id_gid: str, slug: str, release_date: str | None, identifier_exists: bool):
    items = [{
        "ownerId": product_id_gid,
        "namespace": STOCKX_SLUG_NAMESPACE,
        "key": STOCKX_SLUG_KEY,
        "type": "single_line_text_field",
        "value": slug
    }]
    if release_date:
        items.append({
            "ownerId": product_id_gid,
            "namespace": MF_NS,
            "key": MF_RELEASE_DATE_KEY,
            "type": "date",
            "value": release_date
        })
    items.append({
        "ownerId": product_id_gid,
        "namespace": MF_NS,
        "key": MF_IDENTIFIER_EXISTS_KEY,
        "type": "boolean",
        "value": "true" if identifier_exists else "false"
    })
    return metafields_set_batched(items, batch_size=25)

def build_variant_mfs(variant_id_gid: str, size_display: str, *, age_value: str, mpn: str | None, upc_backup: str | None):
    items = []
    items.append({"ownerId": variant_id_gid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_CONDITION, "type": "single_line_text_field", "value": MM_VAL_CONDITION})
    items.append({"ownerId": variant_id_gid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_GENDER, "type": "single_line_text_field", "value": MM_VAL_GENDER})
    if age_value:
        items.append({"ownerId": variant_id_gid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_AGE_GROUP, "type": "single_line_text_field", "value": age_value})
    if mpn:
        items.append({"ownerId": variant_id_gid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_MPN, "type": "single_line_text_field", "value": mpn})

    if VARIANT_SIZE_METAFIELD and size_display:
        items.append({"ownerId": variant_id_gid, "namespace": VARIANT_SIZE_NAMESPACE, "key": VARIANT_SIZE_KEY, "type": "single_line_text_field", "value": size_display})

    if UPC_BACKUP_METAFIELD and upc_backup:
        items.append({"ownerId": variant_id_gid, "namespace": UPC_BACKUP_NAMESPACE, "key": UPC_BACKUP_KEY, "type": "single_line_text_field", "value": upc_backup})

    return items

def inventory_set_quantities(inventory_item_gid: str, available: int) -> bool:
    m = """
    mutation($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup { id }
        userErrors { field message code }
      }
    }
    """
    variables = {
        "input": {
            "name": "available",
            "reason": "correction",
            "ignoreCompareQuantity": True,
            "quantities": [{
                "inventoryItemId": inventory_item_gid,
                "locationId": f"gid://shopify/Location/{LOCATION_ID}",
                "quantity": int(available),
            }]
        }
    }
    if DRY_RUN:
        log("DRY_RUN inventorySetQuantities", inventory_item_gid, "=>", available)
        return True
    data = gql(m, variables)
    errs = data["inventorySetQuantities"]["userErrors"]
    if errs:
        log("❌ INVENTORY ERR", errs)
        return False
    return True

# ==============================
# SHOPIFY REST VARIANT OPS
# ==============================
def rest_get_product(product_gid: str) -> dict:
    product_id = gid_to_int(product_gid)
    url = f"{SHOP_REST}/products/{product_id}.json"
    r = request_retry(
        "GET",
        url,
        headers={"X-Shopify-Access-Token": TOKEN},
        params={"fields": "id,title,product_type,variants"},
        timeout=REST_TIMEOUT,
        tries=REST_TRIES,
        backoff=REST_BACKOFF,
    )
    if r.status_code != 200:
        raise RuntimeError(f"REST GET PRODUCT FAIL {product_id} status={r.status_code} body={r.text[:400]}")
    return (r.json() or {}).get("product") or {}

def rest_update_variant(variant_id: int, payload_variant: dict) -> dict | None:
    url = f"{SHOP_REST}/variants/{int(variant_id)}.json"
    payload = {"variant": {"id": int(variant_id), **payload_variant}}
    if DRY_RUN:
        log("DRY_RUN REST variant update", variant_id, payload_variant)
        return None
    r = request_retry("PUT", url, headers=headers_shop, json=payload, timeout=REST_TIMEOUT, tries=REST_TRIES, backoff=REST_BACKOFF)
    if r.status_code not in (200, 201):
        log("❌ REST VARIANT UPDATE FAIL", variant_id, "status=", r.status_code, "body=", r.text[:600])
        return None
    return (r.json() or {}).get("variant")

def rest_delete_variant(variant_id: int) -> bool:
    url = f"{SHOP_REST}/variants/{int(variant_id)}.json"
    if DRY_RUN:
        log("DRY_RUN REST delete variant", variant_id)
        return True
    r = request_retry("DELETE", url, headers={"X-Shopify-Access-Token": TOKEN}, timeout=REST_TIMEOUT, tries=REST_TRIES, backoff=REST_BACKOFF)
    if r.status_code not in (200, 202):
        log("❌ REST DELETE VARIANT FAIL", variant_id, "status=", r.status_code, "body=", r.text[:400])
        return False
    return True

def rest_create_variant(product_gid: str, *, option1_value: str, price: int, sku: str, barcode: str | None):
    product_id = gid_to_int(product_gid)
    url = f"{SHOP_REST}/products/{product_id}/variants.json"
    payload = {
        "variant": {
            "option1": option1_value,
            "price": str(int(price)),
            "sku": sku,
            "inventory_management": "shopify",
            "inventory_policy": "continue",
            "requires_shipping": True,
            "grams": int(WEIGHT_SNEAKERS_GRAMS),
        }
    }
    if barcode:
        payload["variant"]["barcode"] = str(barcode)

    if DRY_RUN:
        log("DRY_RUN REST create variant", "size=", option1_value, "price=", price, "sku=", sku, "barcode=", barcode)
        return None

    r = request_retry("POST", url, headers=headers_shop, json=payload, timeout=REST_TIMEOUT, tries=REST_TRIES, backoff=REST_BACKOFF)
    if r.status_code not in (200, 201):
        log("❌ REST CREATE VARIANT FAIL", "size=", option1_value, "status=", r.status_code, "body=", r.text[:800])
        return None
    return (r.json() or {}).get("variant")

def rest_set_variant_position(variant_id: int, position: int) -> bool:
    url = f"{SHOP_REST}/variants/{int(variant_id)}.json"
    payload = {"variant": {"id": int(variant_id), "position": int(position)}}
    if DRY_RUN:
        log("DRY_RUN REST set position", variant_id, "=>", position)
        return True
    r = request_retry("PUT", url, headers=headers_shop, json=payload, timeout=REST_TIMEOUT, tries=REST_TRIES, backoff=REST_BACKOFF)
    if r.status_code not in (200, 201):
        log("❌ REST SET POSITION FAIL", variant_id, "status=", r.status_code, "body=", r.text[:400])
        return False
    return True

def reorder_variants_by_size(product_gid: str) -> bool:
    p = rest_get_product(product_gid)
    variants = p.get("variants") or []
    rows = []
    for v in variants:
        opt1 = (v.get("option1") or "").strip()
        if not opt1:
            continue
        size_disp = eu_canonical_display_from_any(opt1)
        rows.append({
            "id": int(v["id"]),
            "current_pos": int(v.get("position") or 0),
            "size_disp": size_disp,
            "key": size_sort_key(size_disp),
        })
    if not rows:
        return False

    rows.sort(key=lambda x: (x["key"], x["size_disp"]))
    ok = True
    for idx, r0 in enumerate(rows, start=1):
        if r0["current_pos"] != idx:
            ok = rest_set_variant_position(r0["id"], idx) and ok
            time.sleep(0.10)
    return ok

# ==============================
# KICKS
# ==============================
class KicksAuthError(RuntimeError):
    pass

def kicks_find_slug_by_sku_exact(style_sku: str) -> str | None:
    filters = f'sku="{style_sku}"'
    r = request_retry(
        "GET",
        "https://api.kicks.dev/v3/stockx/products",
        headers=headers_kx,
        params={"filters": filters, "limit": 8, "market": MARKET},
        timeout=KX_TIMEOUT,
        tries=KX_TRIES,
        backoff=KX_BACKOFF,
    )

    if r.status_code in (401, 403):
        raise KicksAuthError(f"Kicks auth failed (status={r.status_code})")

    if r.status_code != 200:
        log("❌ KX SEARCH FAIL market=", MARKET, "sku=", style_sku, "status=", r.status_code, r.text[:200])
        return None

    data = (r.json() or {}).get("data") or []
    if not data:
        return None

    for p in data:
        sku = safe_str(p.get("sku"))
        if sku and sku.strip().upper() == style_sku.strip().upper():
            return safe_str(p.get("slug")) or safe_str(p.get("url_slug")) or safe_str(p.get("urlSlug"))

    return None

def kicks_get_product_full(slug: str) -> dict | None:
    url = f"https://api.kicks.dev/v3/stockx/products/{slug}"
    r = request_retry(
        "GET",
        url,
        headers=headers_kx,
        params={
            "display[variants]": "true",
            "display[prices]": "true",
            "display[identifiers]": "true",
            "display[traits]": "true",
            "market": MARKET,
        },
        timeout=KX_TIMEOUT,
        tries=KX_TRIES,
        backoff=KX_BACKOFF,
    )

    if r.status_code in (401, 403):
        raise KicksAuthError(f"Kicks auth failed (status={r.status_code})")

    if r.status_code != 200:
        log("❌ KX PRODUCT FAIL market=", MARKET, "slug=", slug, "status=", r.status_code, r.text[:200])
        return None
    return (r.json() or {}).get("data") or {}

# ==============================
# BUILD STOCKX SIZES MAP (FILTERED 35..49.5 by default)
# ==============================
def build_stockx_sizes_map(p: dict):
    title = safe_str(p.get("title")) or ""
    slug = safe_str(p.get("slug")) or ""

    release_date = normalize_release_date(
        safe_str(p.get("release_date")) or safe_str(p.get("releaseDate")) or safe_str(p.get("release"))
    )

    any_gtin = False
    size_map = {}

    for v in (p.get("variants") or []):
        eu_raw = None
        for s in (v.get("sizes", []) or []):
            if (s.get("type") or "").lower() == "eu":
                eu_raw = safe_str(s.get("size"))
                break
        if not eu_raw:
            continue

        eu_norm = eu_norm_keep_thirds(eu_raw)
        eu_display = eu_display_from_norm(eu_norm)
        if not eu_display:
            continue

        # DEFAULT RANGE FILTER
        if not size_in_range(eu_display, EU_MIN, EU_MAX):
            continue

        prices_list = v.get("prices") or []
        base = pick_price(prices_list, PRICE_TYPE_PREFERRED)
        if base <= 0:
            continue

        breakdown = compute_breakdown(base)
        all_in = breakdown["all_in"]
        mult = dynamic_markup(all_in)
        price_final = round_eur(all_in * mult)

        barcode_for_shopify, upc_backup = choose_barcode_and_upc_backup(v.get("identifiers") or [])
        if barcode_for_shopify:
            any_gtin = True

        size_map[eu_display] = {
            "price_new": int(price_final),
            "barcode": barcode_for_shopify,
            "upc_backup": upc_backup,
            "debug": {
                **breakdown,
                "markup": float(mult),
                "final_round": int(price_final),
            }
        }

    age_value = detect_age_group_value(title, slug)
    return size_map, release_date, any_gtin, age_value

# ==============================
# FORCE VARIANTS (with min-size rule) + UPDATE EXISTING DESIRED VARIANTS
# ==============================
def force_variants_to_stockx(product_gid: str, target_sku: str, size_map: dict, age_value: str, *, min_size_int: int | None):
    partial_info = {"under_min_barcode_updated": []}

    p = rest_get_product(product_gid)
    variants = p.get("variants") or []
    if not variants:
        raise RuntimeError("No variants found via REST (unexpected).")

    min_key = float(min_size_int) if min_size_int else None

    # A) Barcode-only updates for sizes < min_key
    if min_key is not None:
        for v in variants:
            vid = int(v["id"])
            opt1 = (v.get("option1") or "").strip()
            if not opt1:
                continue
            size_disp = eu_canonical_display_from_any(opt1)
            k = size_sort_key(size_disp)
            if k < min_key:
                bar = (size_map.get(size_disp) or {}).get("barcode")
                if bar:
                    log("→ Barcode-only (under min tag) variant", vid, "size=", size_disp, "barcode=", bar)
                    rest_update_variant(vid, {"barcode": str(bar)})
                    partial_info["under_min_barcode_updated"].append(size_disp)
                    time.sleep(0.05)

    # B) Desired sizes for FULL enforcement (>= min_key)
    desired_sizes = []
    for sz in (size_map or {}).keys():
        if min_key is None or size_sort_key(sz) >= min_key:
            desired_sizes.append(sz)
    desired_sizes.sort(key=lambda s: (size_sort_key(s), s))
    if not desired_sizes:
        log("⚠ No desired sizes for enforcement (maybe min tag too high). Done.")
        return partial_info

    desired_set = set(desired_sizes)

    # pick base variant among eligible (>= min_key)
    base_variant_id = None
    for v in variants:
        opt1 = (v.get("option1") or "").strip()
        if not opt1:
            continue
        size_disp = eu_canonical_display_from_any(opt1)
        if min_key is None or size_sort_key(size_disp) >= min_key:
            base_variant_id = int(v["id"])
            break

    if base_variant_id is None:
        log("⚠ No existing variant >= min tag. Safety: skipping enforcement, only barcode-only done.")
        return partial_info

    # repurpose base variant -> first desired size (>= min_key)
    first_size = desired_sizes[0]
    first = size_map[first_size]
    payload = {
        "option1": first_size,
        "price": str(int(first["price_new"])),
        "sku": target_sku,
        "inventory_management": "shopify",
        "inventory_policy": "continue",
        "requires_shipping": True,
        "grams": int(WEIGHT_SNEAKERS_GRAMS),
    }
    if first.get("barcode"):
        payload["barcode"] = str(first["barcode"])
    log("→ Repurpose base variant", base_variant_id, "=> size", first_size)
    upd = rest_update_variant(base_variant_id, payload)

    # inventory for base variant
    inv_item_id = None
    if upd and upd.get("inventory_item_id"):
        inv_item_id = int(upd["inventory_item_id"])
    else:
        p2 = rest_get_product(product_gid)
        for vv in (p2.get("variants") or []):
            if int(vv.get("id")) == base_variant_id:
                inv_item_id = int(vv.get("inventory_item_id") or 0) or None
                break
    if inv_item_id:
        inventory_set_quantities(f"gid://shopify/InventoryItem/{inv_item_id}", FORCE_QTY)

    # refresh
    p_now = rest_get_product(product_gid)
    variants_now = p_now.get("variants") or []

    # delete ONLY eligible variants (>= min_key) that are not desired, and duplicates of first_size
    for v in variants_now:
        vid = int(v["id"])
        if vid == base_variant_id:
            continue
        opt1 = (v.get("option1") or "").strip()
        if not opt1:
            continue
        size_disp = eu_canonical_display_from_any(opt1)
        k = size_sort_key(size_disp)
        if min_key is not None and k < min_key:
            continue
        if (size_disp not in desired_set) or (size_disp == first_size):
            log("→ Delete variant (eligible)", vid, "size=", size_disp)
            ok_del = rest_delete_variant(vid)
            if not ok_del:
                raise RuntimeError(f"Delete variant failed vid={vid} size={size_disp}")
            time.sleep(0.08)

    # refresh after deletions
    p_after = rest_get_product(product_gid)
    variants_after = p_after.get("variants") or []

    existing_sizes = set()
    for v in variants_after:
        opt1 = (v.get("option1") or "").strip()
        if not opt1:
            continue
        size_disp = eu_canonical_display_from_any(opt1)
        existing_sizes.add(size_disp)

    # IMPORTANT FIX: update ALL existing desired variants (>= min_key)
    for v in variants_after:
        vid = int(v["id"])
        opt1 = (v.get("option1") or "").strip()
        if not opt1:
            continue

        size_disp = eu_canonical_display_from_any(opt1)
        if size_disp not in desired_set:
            continue

        s = size_map.get(size_disp)
        if not s:
            continue

        new_bar = s.get("barcode")
        new_price = int(s["price_new"])

        payload2 = {
            "option1": size_disp,
            "price": str(new_price),
            "sku": target_sku,
            "inventory_management": "shopify",
            "inventory_policy": "continue",
            "requires_shipping": True,
            "grams": int(WEIGHT_SNEAKERS_GRAMS),
        }
        if new_bar:
            payload2["barcode"] = str(new_bar)

        log("→ Update existing desired variant", vid, "size=", size_disp, "price=", new_price, "barcode=", (new_bar or "-"))
        upd2 = rest_update_variant(vid, payload2)

        inv_item_id2 = None
        if upd2 and upd2.get("inventory_item_id"):
            inv_item_id2 = int(upd2["inventory_item_id"])
        else:
            inv_item_id2 = int(v.get("inventory_item_id") or 0) or None

        if inv_item_id2:
            inventory_set_quantities(f"gid://shopify/InventoryItem/{inv_item_id2}", FORCE_QTY)

        time.sleep(0.06)

    # create missing desired sizes (>= min_key)
    for sz in desired_sizes:
        if sz in existing_sizes:
            continue
        s = size_map[sz]
        log("→ Create missing size", sz, "price", s["price_new"])
        created = rest_create_variant(
            product_gid,
            option1_value=sz,
            price=int(s["price_new"]),
            sku=target_sku,
            barcode=s.get("barcode"),
        )
        if created and created.get("id"):
            inv_item_id3 = int(created.get("inventory_item_id") or 0) or None
            if inv_item_id3:
                inventory_set_quantities(f"gid://shopify/InventoryItem/{inv_item_id3}", FORCE_QTY)
        time.sleep(0.10)

    # set metafields ONLY for desired (>= min_key)
    p_final = rest_get_product(product_gid)
    mf_items = []
    for v in (p_final.get("variants") or []):
        vid = int(v["id"])
        opt1 = (v.get("option1") or "").strip()
        if not opt1:
            continue
        size_disp = eu_canonical_display_from_any(opt1)
        if size_disp not in desired_set:
            continue
        upc_backup = (size_map.get(size_disp) or {}).get("upc_backup")
        vgid = f"gid://shopify/ProductVariant/{vid}"
        mf_items.extend(build_variant_mfs(
            vgid,
            size_disp,
            age_value=age_value,
            mpn=target_sku,
            upc_backup=upc_backup,
        ))
    ok_mf = metafields_set_batched(mf_items, batch_size=25)
    log("Variant metafields updated:", ok_mf, "| items:", len(mf_items))

    reorder_variants_by_size(product_gid)
    return partial_info

# ==============================
# LIST PRODUCTS BY PRODUCT_TYPE (PAGINATED) + TAGS
# ==============================
def iter_products_by_product_type(product_type: str):
    query = """
    query($q:String!, $cursor:String){
      products(first: 50, after: $cursor, query: $q) {
        edges {
          cursor
          node {
            id
            title
            productType
            tags
            variants(first: 50) {
              edges { node { sku } }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
    """
    q = f'product_type:"{product_type}"'
    cursor = None

    started_by_id = (START_AFTER_ID == "")
    while True:
        data = gql(query, {"q": q, "cursor": cursor})
        edges = (data.get("products") or {}).get("edges") or []
        if not edges:
            return

        for e in edges:
            p = e["node"]
            cursor = e["cursor"]

            if not started_by_id:
                if p["id"] == START_AFTER_ID:
                    started_by_id = True
                continue

            yield p

        if not (data.get("products") or {}).get("pageInfo", {}).get("hasNextPage"):
            return

# ==============================
# RUN
# ==============================
def run():
    hr()
    log("PRODUCT_TYPE_FILTER:", PRODUCT_TYPE_FILTER)
    log("MARKET:", MARKET, "| PRICE_TYPE_PREFERRED:", PRICE_TYPE_PREFERRED)
    log("DEFAULT EU RANGE:", EU_MIN, "->", EU_MAX)
    log("DRY_RUN:", 1 if DRY_RUN else 0, "| MAX_PRODUCTS:", MAX_PRODUCTS or "∞")
    log("RESUME:", "START_FROM_INDEX=", START_FROM_INDEX, "| START_AFTER_ID=", START_AFTER_ID or "(none)")
    log("STOP_ON_KICKS_AUTH_FAIL:", 1 if STOP_ON_KICKS_AUTH_FAIL else 0)
    log("FORCE_QTY:", FORCE_QTY)
    log("LOG_FILE:", os.path.abspath(LOG_FILE))
    log("SUMMARY_FILE:", os.path.abspath(SUMMARY_FILE))
    hr()

    seen_total = 0
    processed = 0
    ok_count = 0
    skip_count = 0
    fail_count = 0

    for p in iter_products_by_product_type(PRODUCT_TYPE_FILTER):
        seen_total += 1
        summary["counters"]["seen_total"] = seen_total

        if seen_total < START_FROM_INDEX:
            if seen_total % 25 == 0:
                log(f"(resume) skipping until START_FROM_INDEX={START_FROM_INDEX} | now at {seen_total}")
            continue

        if MAX_PRODUCTS and processed >= MAX_PRODUCTS:
            break

        processed += 1
        summary["counters"]["processed"] = processed

        pid = p["id"]
        title = p.get("title") or ""
        tags = p.get("tags") or []

        hr()
        log(f"[{seen_total}] PRODUCT:", title)
        log("  id:", pid)
        log("  tags:", ",".join(tags[:12]) + ("..." if len(tags) > 12 else ""))

        # RULE 1: NOMODIFICA => skip
        if has_nomodifica_tag(tags):
            log("  SKIP: tag NOMODIFICA present")
            summary["lists"]["nomodifica_skipped"].append({
                "product_id": pid,
                "title": title,
                "tags": tags,
                "log_index": seen_total,
            })
            skip_count += 1
            summary["counters"]["skipped"] = skip_count
            write_summary_file()
            continue

        # RULE 2: min-size tag 35..50
        min_size_int = parse_min_size_from_tags(tags)
        if min_size_int is not None:
            log("  MIN-SIZE TAG FOUND:", min_size_int, "(under this: barcode-only)")

        # derive sku_base from first 50 variants
        variants_edges = ((p.get("variants") or {}).get("edges") or [])
        sku_base = None
        for ve in variants_edges:
            sku = safe_str((ve.get("node") or {}).get("sku"))
            sku_base = sku_base_from_variant_sku(sku)
            if sku_base:
                break
        log("  sku_base:", sku_base or "(none)")

        if not sku_base:
            log("  SKIP: missing sku base on first 50 variants")
            summary["lists"]["skipped_other"].append({
                "product_id": pid,
                "title": title,
                "reason": "missing_sku_base_first_50_variants",
                "tags": tags,
                "log_index": seen_total,
            })
            skip_count += 1
            summary["counters"]["skipped"] = skip_count
            write_summary_file()
            continue

        # Kicks slug (STRICT exact match)
        try:
            slug = kicks_find_slug_by_sku_exact(sku_base)
        except KicksAuthError as e:
            log("  FAIL: Kicks auth error:", str(e))
            summary["lists"]["kicks_auth_failed"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "reason": str(e),
                "log_index": seen_total,
            })
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            write_summary_file()
            if STOP_ON_KICKS_AUTH_FAIL:
                log("  STOP: Kicks auth failed. Fix KICKS_API_KEY; rerun with START_FROM_INDEX=", seen_total)
                break
            continue
        except Exception as e:
            log("  FAIL: Kicks search exception:", repr(e))
            summary["lists"]["other_failures"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "stage": "kicks_find_slug",
                "error": repr(e),
                "log_index": seen_total,
            })
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            write_summary_file()
            continue

        if not slug:
            log("  SKIP: no EXACT StockX match on Kicks for sku_base=", sku_base)
            summary["lists"]["no_exact_stockx_match"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "tags": tags,
                "log_index": seen_total,
            })
            skip_count += 1
            summary["counters"]["skipped"] = skip_count
            write_summary_file()
            continue

        # Fetch full product
        try:
            kx_product = kicks_get_product_full(slug)
        except KicksAuthError as e:
            log("  FAIL: Kicks auth error (product fetch):", str(e))
            summary["lists"]["kicks_auth_failed"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "reason": str(e),
                "log_index": seen_total,
            })
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            write_summary_file()
            if STOP_ON_KICKS_AUTH_FAIL:
                log("  STOP: Kicks auth failed. Fix KICKS_API_KEY; rerun with START_FROM_INDEX=", seen_total)
                break
            continue
        except Exception as e:
            log("  FAIL: Kicks product fetch exception:", repr(e))
            summary["lists"]["other_failures"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "stage": "kicks_get_product_full",
                "error": repr(e),
                "log_index": seen_total,
            })
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            write_summary_file()
            continue

        if not kx_product:
            log("  FAIL: cannot fetch Kicks product for slug=", slug)
            summary["lists"]["other_failures"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "stage": "kicks_get_product_full",
                "error": "empty_response",
                "log_index": seen_total,
            })
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            write_summary_file()
            continue

        size_map, release_date, any_gtin, age_value = build_stockx_sizes_map(kx_product)
        log("  StockX sizes (filtered):", len(size_map), "| release_date:", release_date or "(none)", "| any_gtin:", any_gtin, "| age:", age_value)
        if not size_map:
            log("  SKIP: no sizes/prices returned (or all outside EU range)")
            summary["lists"]["skipped_other"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "reason": "no_sizes_or_prices_or_outside_range",
                "tags": tags,
                "log_index": seen_total,
            })
            skip_count += 1
            summary["counters"]["skipped"] = skip_count
            write_summary_file()
            continue

        # product metafields
        try:
            ok_pm = set_product_mfs(pid, slug, release_date, any_gtin)
            log("  Product metafields updated:", ok_pm)
        except Exception as e:
            log("  FAIL: product metafields exception:", repr(e))
            summary["lists"]["other_failures"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "stage": "set_product_mfs",
                "error": repr(e),
                "log_index": seen_total,
            })
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            write_summary_file()
            continue

        # force variants
        try:
            partial_info = force_variants_to_stockx(pid, sku_base, size_map, age_value, min_size_int=min_size_int)
            ok_count += 1
            summary["counters"]["ok"] = ok_count

            if min_size_int is not None:
                under = partial_info.get("under_min_barcode_updated") or []
                if under:
                    summary["lists"]["partial_barcode_only_under_min"].append({
                        "product_id": pid,
                        "title": title,
                        "sku_base": sku_base,
                        "slug": slug,
                        "min_size_tag": min_size_int,
                        "sizes_barcode_only_updated": sorted(set(under), key=lambda s: (size_sort_key(s), s)),
                        "log_index": seen_total,
                    })

            summary["lists"]["touched_ok"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "min_size_tag": min_size_int,
                "log_index": seen_total,
            })

        except Exception as ex:
            log("  FAIL:", repr(ex))
            fail_count += 1
            summary["counters"]["failed"] = fail_count
            summary["lists"]["other_failures"].append({
                "product_id": pid,
                "title": title,
                "sku_base": sku_base,
                "slug": slug,
                "stage": "force_variants_to_stockx",
                "error": repr(ex),
                "log_index": seen_total,
            })

        write_summary_file()
        time.sleep(SLEEP_SECS)

    hr()
    log("DONE.")
    log("seen_total=", seen_total, "| started=", processed, "| ok=", ok_count, "| skipped=", skip_count, "| failed=", fail_count)
    hr()

    def print_list_block(name: str, items: list, limit: int = 200):
        log(f"[REPORT] {name}: count={len(items)}")
        if not items:
            return
        for i, it in enumerate(items[:limit], start=1):
            pid = it.get("product_id")
            title = (it.get("title") or "").replace("\n", " ").strip()
            sku = it.get("sku_base")
            slug = it.get("slug")
            reason = it.get("reason") or it.get("stage") or it.get("error")
            idx = it.get("log_index")
            extra = ""
            if name == "partial_barcode_only_under_min":
                extra = f" | min={it.get('min_size_tag')} | sizes={','.join(it.get('sizes_barcode_only_updated') or [])}"
            log(f"  {i:03d}) idx=[{idx}] id={pid} | sku={sku or '-'} | slug={slug or '-'} | {title[:120]}{extra}" + (f" | {reason}" if reason else ""))

    print_list_block("nomodifica_skipped", summary["lists"]["nomodifica_skipped"])
    print_list_block("no_exact_stockx_match", summary["lists"]["no_exact_stockx_match"])
    print_list_block("partial_barcode_only_under_min", summary["lists"]["partial_barcode_only_under_min"])
    print_list_block("kicks_auth_failed", summary["lists"]["kicks_auth_failed"])
    print_list_block("other_failures", summary["lists"]["other_failures"])
    log(f"[REPORT] touched_ok: count={len(summary['lists']['touched_ok'])}")
    hr()
    log("FILES:")
    log("  LOG_FILE    =", os.path.abspath(LOG_FILE))
    log("  SUMMARY_FILE=", os.path.abspath(SUMMARY_FILE))
    hr()

if __name__ == "__main__":
    try:
        run()
    finally:
        write_summary_file()
