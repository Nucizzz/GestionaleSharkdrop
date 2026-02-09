#!/usr/bin/env python3
# IMPORTASTOCKLINK.py
#
# StockX (via Kicks) -> Shopify import (ACTIVE) with:
# - FIXED_PRICE_EUR for all variants
# - DEFAULT_QTY inventory set for all variants (default 0)
# - images: only requested 360 frames, processed to RECT canvas with BG (#f5f5f3ff) and near-white removed
# - SKU: base only (NO "|EUxx")
# - Optional size label suffix: if SIZE_SUFFIX_MODE=express => "43 - Express 24/48H"
# - Range: if EU_MIN/EU_MAX not set -> imports ALL sizes found (after EU or US->EU conversion)
#
# REQUIRED .env:
#   SHOP_DOMAIN=sharkdrop.it
#   ADMIN_API_TOKEN=shpat_...
#   KICKS_API_KEY=...
#   LOCATION_ID=113815716104
#   STOCKX_URL=https://stockx.com/air-jordan-4-retro-pale-ivory-sierra-red-womens
#
# OPTIONAL .env:
#   API_VERSION=2024-10
#   KICKS_MARKET=IT
#   FIXED_PRICE_EUR=220
#   DEFAULT_QTY=0
#   PRODUCT_TYPE=Scarpe
#   STATUS=active
#   TAGS=StockX Import
#   TEMPLATE_SUFFIX=prova
#
#   # Size label behavior:
#   SIZE_SUFFIX_MODE=off|express
#   EXPRESS_LABEL=Express 24/48H
#
#   # Range (omit both => all sizes):
#   EU_MIN=37.5
#   EU_MAX=43
#
#   # Images:
#   IMG_NUMBERS=01,10,15,20,28
#   IMG_W=1065
#   IMG_H=1440
#   BG_HEX=#f5f5f3ff
#   WHITE_CUT=245
#
#   DRY_RUN=0/1
#
import os
import re
import time
import base64
import requests
from io import BytesIO
from dotenv import load_dotenv, find_dotenv

from PIL import Image

# -------------------------
# .env loading (robust)
# -------------------------
dotenv_path = find_dotenv(usecwd=True)
if dotenv_path:
    load_dotenv(dotenv_path)
else:
    load_dotenv()

def env_pick(*names, default=None):
    for n in names:
        v = os.getenv(n)
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return default

def env_float(name: str, default=None):
    v = os.getenv(name)
    if v is None or str(v).strip() == "":
        return default
    try:
        return float(str(v).strip())
    except:
        raise SystemExit(f"Invalid float in env {name}={v!r}")

def env_int(name: str, default=None):
    v = os.getenv(name)
    if v is None or str(v).strip() == "":
        return default
    try:
        return int(float(str(v).strip()))
    except:
        raise SystemExit(f"Invalid int in env {name}={v!r}")

# -------------------------
# CONFIG
# -------------------------
SHOP_DOMAIN = env_pick("SHOP_DOMAIN")
TOKEN = env_pick("ADMIN_API_TOKEN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_TOKEN")
KICKS_KEY = env_pick("KICKS_API_KEY")
LOCATION_ID = env_pick("LOCATION_ID")
STOCKX_URL = env_pick("STOCKX_URL", "STOCKX_PRODUCT_URL")

API_VERSION = env_pick("API_VERSION", default="2024-10")
MARKET = env_pick("KICKS_MARKET", default="IT").upper()

# Range (optional). If BOTH missing => all sizes
EU_MIN = env_float("EU_MIN", default=None)
EU_MAX = env_float("EU_MAX", default=None)
EU_LIST_RAW = env_pick("EU_LIST", "EU_ONLY", default="")

PRICE_MODE = (env_pick("PRICE_MODE", default="fixed") or "fixed").strip().lower()
PRICE_TYPE_PREFERRED = (env_pick("PRICE_TYPE_PREFERRED", default="standard") or "standard").strip().lower()
ALLOW_UNPRICED = env_pick("ALLOW_UNPRICED", default="0") == "1"

FIXED_PRICE_EUR = env_float("FIXED_PRICE_EUR", default=None)
if PRICE_MODE == "fixed" and FIXED_PRICE_EUR is None:
    FIXED_PRICE_EUR = 220

DEFAULT_QTY = env_int("DEFAULT_QTY", default=0)

PRODUCT_TYPE = env_pick("PRODUCT_TYPE", default="Scarpe")
STATUS = env_pick("STATUS", default="active")  # active|draft
TAGS = env_pick("TAGS", default="StockX Import")
TEMPLATE_SUFFIX = env_pick("TEMPLATE_SUFFIX", default="prova")

# Size suffix mode
SIZE_SUFFIX_MODE = (env_pick("SIZE_SUFFIX_MODE", "SIZE_MODE", default="off") or "off").strip().lower()
EXPRESS_LABEL = env_pick("EXPRESS_LABEL", default="Express 24/48H")

# Images
IMG_NUMBERS = [x.strip() for x in env_pick("IMG_NUMBERS", default="20,15,01,10,28").split(",") if x.strip()]
IMG_W = env_int("IMG_W", default=1065)
IMG_H = env_int("IMG_H", default=1440)
BG_HEX = env_pick("BG_HEX", default="#F7F7F7")
WHITE_CUT = env_int("WHITE_CUT", default=245)

DRY_RUN = env_pick("DRY_RUN", default="0") == "1"

REST_TIMEOUT = 120
REST_TRIES = 5
REST_BACKOFF = 1.3

KX_TIMEOUT = 45
KX_TRIES = 3
KX_BACKOFF = 0.9

if not all([SHOP_DOMAIN, TOKEN, KICKS_KEY, LOCATION_ID, STOCKX_URL]):
    raise SystemExit("Missing env vars: SHOP_DOMAIN, ADMIN_API_TOKEN, KICKS_API_KEY, LOCATION_ID, STOCKX_URL")

if not str(LOCATION_ID).isdigit():
    raise SystemExit("Invalid LOCATION_ID (must be numeric)")

SHOP_REST = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}"
SHOP_GQL = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
headers_shop_rest = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}
headers_shop_gql = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}
headers_kx = {"Authorization": f"Bearer {KICKS_KEY}"}

LOCATION_GID = f"gid://shopify/Location/{LOCATION_ID}"

# -------------------------
# HELPERS
# -------------------------
def request_retry(method, url, *, headers=None, params=None, json=None, data=None, timeout=30, tries=3, backoff=0.8):
    last = None
    for i in range(tries):
        try:
            r = requests.request(method, url, headers=headers, params=params, json=json, data=data, timeout=timeout)
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

def gql(query: str, variables: dict | None = None):
    r = request_retry(
        "POST",
        SHOP_GQL,
        headers=headers_shop_gql,
        json={"query": query, "variables": variables or {}},
        timeout=60,
        tries=6,
        backoff=1.4,
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

def product_gid(numeric_id: int) -> str:
    return f"gid://shopify/Product/{numeric_id}"

def variant_gid(numeric_id: int) -> str:
    return f"gid://shopify/ProductVariant/{numeric_id}"

def inventory_item_gid(numeric_id: int) -> str:
    return f"gid://shopify/InventoryItem/{numeric_id}"

def _digits_only(s: str) -> str:
    return re.sub(r"\D+", "", (s or "").strip())

# -------------------------
# STOCKX URL -> slug
# -------------------------
def stockx_slug_from_url(url: str) -> str:
    u = (url or "").strip()
    m = re.search(r"stockx\.com/([^?\s#]+)", u, flags=re.I)
    if not m:
        raise ValueError(f"Cannot extract slug from STOCKX_URL: {url}")
    slug = m.group(1).strip().strip("/")
    if not slug:
        raise ValueError(f"Empty slug from STOCKX_URL: {url}")
    return slug

# -------------------------
# Kicks fetch
# -------------------------
def kicks_get_product_full(slug: str) -> dict:
    url = f"https://api.kicks.dev/v3/stockx/products/{slug}"
    r = request_retry(
        "GET",
        url,
        headers=headers_kx,
        params={
            "display[variants]": "true",
            "display[prices]": "true",
            "display[identifiers]": "true",
            "display[gallery]": "true",
            "display[gallery_360]": "true",
            "display[traits]": "true",
            "market": MARKET,
        },
        timeout=KX_TIMEOUT,
        tries=KX_TRIES,
        backoff=KX_BACKOFF,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Kicks GET failed status={r.status_code} body={r.text[:300]}")
    return (r.json() or {}).get("data") or {}

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

# -------------------------
# SIZE PARSING + CONVERSION
# -------------------------
def parse_size_number(raw: str) -> float | None:
    s = (raw or "").strip().upper()
    if not s:
        return None
    s = s.replace(",", ".")
    s = s.replace("½", ".5")
    s = s.replace("⅓", ".333").replace("⅔", ".666")
    s = s.replace("1/2", ".5").replace("1/3", ".333").replace("2/3", ".666")
    s = re.sub(r"\s+", " ", s)
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except:
        return None

USW_TO_EU = {
    5.0: 35.5, 5.5: 36.0, 6.0: 36.5, 6.5: 37.5, 7.0: 38.0, 7.5: 38.5,
    8.0: 39.0, 8.5: 40.0, 9.0: 40.5, 9.5: 41.0, 10.0: 42.0, 10.5: 42.5,
    11.0: 43.0, 11.5: 44.0, 12.0: 44.5
}
USM_TO_EU = {
    4.0: 36.0, 4.5: 36.5, 5.0: 37.5, 5.5: 38.0, 6.0: 38.5, 6.5: 39.0,
    7.0: 40.0, 7.5: 40.5, 8.0: 41.0, 8.5: 42.0, 9.0: 42.5, 9.5: 43.0,
    10.0: 44.0, 10.5: 44.5, 11.0: 45.0, 11.5: 45.5, 12.0: 46.0
}

def approx_lookup(mapping: dict, us: float) -> float | None:
    if us in mapping:
        return mapping[us]
    rounded = round(us * 2) / 2
    return mapping.get(rounded)

def get_eu_size_from_variant(v: dict, *, title_hint: str, slug_hint: str) -> float | None:
    sizes = (v.get("sizes", []) or [])

    # EU direct
    for s in sizes:
        t = (s.get("type") or "").strip().lower()
        if t == "eu":
            raw = safe_str(s.get("size"))
            val = parse_size_number(raw or "")
            if val is not None:
                return val

    # fallback: US -> EU
    womens = ("WOMEN" in (title_hint or "").upper()) or ("-womens" in slug_hint.lower()) or slug_hint.lower().endswith("womens")
    candidates = []
    for s in sizes:
        t = (s.get("type") or "").strip().lower().replace(" ", "")
        raw = safe_str(s.get("size")) or ""
        if "us" in t:
            n = parse_size_number(raw)
            if n is not None:
                candidates.append((t, n))

    if not candidates:
        return None

    usw = None
    usm = None
    for (t, n) in candidates:
        if "w" in t or "women" in t:
            usw = n
            break

    if usw is None:
        if womens:
            usw = candidates[0][1]
        else:
            usm = candidates[0][1]

    if usw is not None:
        return approx_lookup(USW_TO_EU, usw)
    if usm is not None:
        return approx_lookup(USM_TO_EU, usm)

    return None

def eu_display(eu: float) -> str:
    if eu is None:
        return ""
    if abs(eu - round(eu)) < 1e-9:
        return str(int(round(eu)))
    if abs(eu - (int(eu) + 0.5)) < 1e-9:
        return f"{int(eu)}.5"
    return f"{eu:.3f}".rstrip("0").rstrip(".")

def apply_size_suffix(size_disp: str) -> str:
    if SIZE_SUFFIX_MODE == "express":
        return f"{size_disp} - {EXPRESS_LABEL}"
    return size_disp

def size_numeric_key(option1: str) -> float:
    # option1 may be "43 - Express 24/48H"
    s = (option1 or "").strip()
    m = re.search(r"(\d+(?:\.\d+)?)", s.replace(",", "."))
    if not m:
        return 9999.0
    try:
        return float(m.group(1))
    except:
        return 9999.0

def _parse_eu_list(raw: str) -> list[float]:
    out = []
    for part in (raw or "").split(","):
        p = part.strip().replace(",", ".")
        if not p:
            continue
        try:
            out.append(float(p))
        except:
            continue
    return out

EU_LIST = _parse_eu_list(EU_LIST_RAW)

def _format_price(val: float) -> str:
    return f"{val:.2f}"

def _extract_price_from_variant(v: dict) -> float | None:
    prices = v.get("prices") or v.get("price") or {}
    preferred_keys = [PRICE_TYPE_PREFERRED, "market", "standard", "lowest", "last", "avg"]

    if isinstance(prices, dict):
        for key in preferred_keys:
            if key in prices and prices[key] is not None:
                raw = prices[key]
                if isinstance(raw, dict):
                    for k in ("value", "amount", "price", "eur", "eur_value", "eurPrice"):
                        if k in raw and raw[k] is not None:
                            try:
                                return float(raw[k])
                            except:
                                pass
                else:
                    try:
                        return float(raw)
                    except:
                        pass
        return None

    if isinstance(prices, list):
        for key in preferred_keys:
            for item in prices:
                if not isinstance(item, dict):
                    continue
                t = (item.get("type") or item.get("price_type") or "").strip().lower()
                if t == key:
                    for k in ("value", "amount", "price", "eur", "eur_value", "eurPrice"):
                        if item.get(k) is not None:
                            try:
                                return float(item.get(k))
                            except:
                                pass
        return None
    return None

# -------------------------
# Identifier rule (your fixed)
# -------------------------
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
    if candidates_13:
        barcode = candidates_13[0]
    if not barcode and candidates_14:
        barcode = candidates_14[0]
    if not barcode and upc12:
        barcode = "0" + upc12

    backup = upc12
    if not backup and barcode and len(barcode) == 13 and barcode.startswith("0"):
        backup = barcode[1:]
    return barcode, backup

# -------------------------
# Image processing
# -------------------------
def hex_to_rgba(hexstr: str):
    h = (hexstr or "").strip().lstrip("#")
    if len(h) == 6:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = 255
    elif len(h) == 8:
        r, g, b, a = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16)
    else:
        raise ValueError(f"Invalid BG_HEX: {hexstr}")
    return (r, g, b, a)

def remove_near_white_to_alpha(img_rgba: Image.Image, cut: int) -> Image.Image:
    pix = img_rgba.getdata()
    out = []
    for (r, g, b, a) in pix:
        if r >= cut and g >= cut and b >= cut:
            out.append((r, g, b, 0))
        else:
            out.append((r, g, b, a))
    img_rgba.putdata(out)
    return img_rgba

def fit_to_canvas(img_rgba: Image.Image, canvas_w: int, canvas_h: int, bg_rgba: tuple[int,int,int,int]) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_w, canvas_h), bg_rgba)
    iw, ih = img_rgba.size
    if iw <= 0 or ih <= 0:
        return canvas
    scale = min(canvas_w / iw, canvas_h / ih)
    new_w = max(1, int(iw * scale))
    new_h = max(1, int(ih * scale))
    resized = img_rgba.resize((new_w, new_h), Image.LANCZOS)
    x = (canvas_w - new_w) // 2
    y = (canvas_h - new_h) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas

def img_to_base64_jpg(img_rgba: Image.Image, quality: int = 92) -> str:
    rgb = Image.new("RGB", img_rgba.size, (255, 255, 255))
    rgb.paste(img_rgba, mask=img_rgba.split()[-1])
    bio = BytesIO()
    rgb.save(bio, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(bio.getvalue()).decode("ascii")

def pick_360_urls_from_kicks(p: dict, wanted_nums: list[str]) -> list[str]:
    wanted = {f"img{n.lower()}": n for n in wanted_nums}
    out = []
    seen = set()
    for u in (p.get("gallery_360") or []):
        if not isinstance(u, str) or not u:
            continue
        m = re.search(r"(img\d{2})\.jpg", u, flags=re.I)
        if not m:
            continue
        key = m.group(1).lower()
        if key in wanted and u not in seen:
            seen.add(u)
            out.append(u)
    ordered = []
    for n in wanted_nums:
        key = f"img{n.lower()}"
        for u in out:
            if re.search(rf"{key}\.jpg", u, flags=re.I):
                ordered.append(u)
                break
    return ordered

def download_image(url: str) -> Image.Image:
    r = request_retry("GET", url, timeout=60, tries=4, backoff=1.0)
    if r.status_code != 200:
        raise RuntimeError(f"Image download failed status={r.status_code} url={url}")
    img = Image.open(BytesIO(r.content))
    return img

def build_shopify_images_as_attachments(kicks_product: dict) -> list[dict]:
    urls = pick_360_urls_from_kicks(kicks_product, IMG_NUMBERS)
    if not urls:
        raise RuntimeError("No matching gallery_360 URLs found in Kicks for requested IMG_NUMBERS.")

    bg = hex_to_rgba(BG_HEX)
    out = []
    for u in urls:
        img = download_image(u).convert("RGBA")
        img = remove_near_white_to_alpha(img, WHITE_CUT)
        canvas = fit_to_canvas(img, IMG_W, IMG_H, bg)
        b64 = img_to_base64_jpg(canvas)
        out.append({"attachment": b64})
        time.sleep(0.15)
    return out

# -------------------------
# Shopify inventory set qty
# -------------------------
def inventory_set_quantities_at_location(inventory_item_gids: list[str], quantity: int, location_gid: str) -> bool:
    if not inventory_item_gids:
        return True
    m = """
    mutation($input: InventorySetQuantitiesInput!){
      inventorySetQuantities(input: $input){
        inventoryAdjustmentGroup { id }
        userErrors { field message code }
      }
    }
    """
    ok = True
    chunk = 50
    for i in range(0, len(inventory_item_gids), chunk):
        part = inventory_item_gids[i:i+chunk]
        quantities = [{"inventoryItemId": iid, "locationId": location_gid, "quantity": int(quantity)} for iid in part]
        variables = {"input": {"name": "available", "reason": "correction", "ignoreCompareQuantity": True, "quantities": quantities}}
        if DRY_RUN:
            print("DRY_RUN inventorySetQuantities chunk=", len(quantities), "qty=", quantity)
            continue
        data = gql(m, variables)
        errs = data["inventorySetQuantities"]["userErrors"]
        if errs:
            ok = False
            print("INVENTORY ERR", errs)
        time.sleep(0.12)
    return ok

# -------------------------
# Metafields
# -------------------------
STOCKX_SLUG_NAMESPACE = env_pick("STOCKX_SLUG_NAMESPACE", default="custom")
STOCKX_SLUG_KEY = env_pick("STOCKX_SLUG_KEY", default="stockx_slug")

MF_NS = env_pick("MF_NAMESPACE", default="custom")
MF_RELEASE_DATE_KEY = env_pick("MF_RELEASE_DATE_KEY", default="release_date")
MF_IDENTIFIER_EXISTS_KEY = env_pick("MF_IDENTIFIER_EXISTS_KEY", default="identifier_exists")

VARIANT_SIZE_METAFIELD = env_pick("VARIANT_SIZE_METAFIELD", default="1") == "1"
VARIANT_SIZE_NAMESPACE = env_pick("VARIANT_SIZE_NAMESPACE", default="custom")
VARIANT_SIZE_KEY = env_pick("VARIANT_SIZE_KEY", default="shoe_size")

UPC_BACKUP_METAFIELD = env_pick("UPC_BACKUP_METAFIELD", default="1") == "1"
UPC_BACKUP_NAMESPACE = env_pick("UPC_BACKUP_NAMESPACE", default="custom")
UPC_BACKUP_KEY = env_pick("UPC_BACKUP_KEY", default="upc_backup")

MM_GOOGLE_NS = env_pick("MM_GOOGLE_NS", default="mm-google-shopping")
MM_KEY_CONDITION = env_pick("MM_GOOGLE_KEY_CONDITION", default="condition")
MM_KEY_GENDER = env_pick("MM_GOOGLE_KEY_GENDER", default="gender")
MM_KEY_AGE_GROUP = env_pick("MM_GOOGLE_KEY_AGE_GROUP", default="age_group")
MM_KEY_MPN = env_pick("MM_GOOGLE_KEY_MPN", default="mpn")

MM_VAL_CONDITION = env_pick("GOOGLE_CONDITION_VALUE", default="new")
MM_VAL_GENDER = env_pick("GOOGLE_GENDER_VALUE", default="unisex")

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
        chunk = items[i:i+batch_size]
        if DRY_RUN:
            print("DRY_RUN metafieldsSet chunk=", len(chunk))
            continue
        data = gql(m, {"metafields": chunk})
        errs = data["metafieldsSet"]["userErrors"]
        if errs:
            ok = False
            print("METAFIELDS ERR", errs)
        time.sleep(0.08)
    return ok

def build_product_metafields(product_gid_str: str, slug: str, release_date: str | None, identifier_exists: bool) -> list:
    items = [{
        "ownerId": product_gid_str,
        "namespace": STOCKX_SLUG_NAMESPACE,
        "key": STOCKX_SLUG_KEY,
        "type": "single_line_text_field",
        "value": slug
    }]
    if release_date:
        items.append({
            "ownerId": product_gid_str,
            "namespace": MF_NS,
            "key": MF_RELEASE_DATE_KEY,
            "type": "date",
            "value": release_date
        })
    items.append({
        "ownerId": product_gid_str,
        "namespace": MF_NS,
        "key": MF_IDENTIFIER_EXISTS_KEY,
        "type": "boolean",
        "value": "true" if identifier_exists else "false"
    })
    return items

def build_variant_metafields(vgid: str, eu_size_display: str, age_group: str, mpn: str | None, upc_backup: str | None) -> list:
    # NOTE: size metafield gets the RAW size without suffix
    items = [
        {"ownerId": vgid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_CONDITION, "type": "single_line_text_field", "value": MM_VAL_CONDITION},
        {"ownerId": vgid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_GENDER, "type": "single_line_text_field", "value": MM_VAL_GENDER},
        {"ownerId": vgid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_AGE_GROUP, "type": "single_line_text_field", "value": age_group},
    ]
    if mpn:
        items.append({"ownerId": vgid, "namespace": MM_GOOGLE_NS, "key": MM_KEY_MPN, "type": "single_line_text_field", "value": mpn})

    if VARIANT_SIZE_METAFIELD and eu_size_display:
        items.append({"ownerId": vgid, "namespace": VARIANT_SIZE_NAMESPACE, "key": VARIANT_SIZE_KEY, "type": "single_line_text_field", "value": eu_size_display})

    if UPC_BACKUP_METAFIELD and upc_backup:
        items.append({"ownerId": vgid, "namespace": UPC_BACKUP_NAMESPACE, "key": UPC_BACKUP_KEY, "type": "single_line_text_field", "value": upc_backup})

    return items

# -------------------------
# Build variants
# -------------------------
def build_variants_from_kicks(p: dict, *, sku_base_fixed: str, title_hint: str, slug_hint: str):
    variants = []
    per_size = {}
    any_gtin = False
    seen = set()

    dbg_types = {}

    for v in (p.get("variants") or []):
        for s in (v.get("sizes", []) or []):
            t = (s.get("type") or "").strip().lower()
            if t:
                dbg_types[t] = dbg_types.get(t, 0) + 1

        eu_val = get_eu_size_from_variant(v, title_hint=title_hint, slug_hint=slug_hint)
        if eu_val is None:
            continue

        # Range filter only if both provided (or individually)
        if EU_MIN is not None and eu_val < EU_MIN - 1e-9:
            continue
        if EU_MAX is not None and eu_val > EU_MAX + 1e-9:
            continue
        if EU_LIST:
            match = False
            for val in EU_LIST:
                if abs(eu_val - val) < 1e-6:
                    match = True
                    break
            if not match:
                continue

        eu_disp = eu_display(eu_val)
        if not eu_disp or eu_disp in seen:
            continue

        barcode, upc_backup = choose_barcode_and_upc_backup(v.get("identifiers") or [])
        if barcode:
            any_gtin = True

        option1 = apply_size_suffix(eu_disp)

        price_value = None
        if PRICE_MODE == "fixed":
            price_value = FIXED_PRICE_EUR
        else:
            price_value = _extract_price_from_variant(v)
            if price_value is None and ALLOW_UNPRICED:
                price_value = 0
        if price_value is None:
            continue

        vp = {
            "option1": option1,
            "price": _format_price(float(price_value)),
            "sku": sku_base_fixed,  # NO suffix in sku
            "inventory_management": "shopify",
            "inventory_policy": "continue",
            "requires_shipping": True,
            "grams": 2000,
        }
        if barcode:
            vp["barcode"] = str(barcode)

        variants.append(vp)

        # metafields: store RAW size (no suffix)
        per_size[eu_disp] = {"upc_backup": upc_backup or ""}
        seen.add(eu_disp)

    variants.sort(key=lambda x: size_numeric_key(x["option1"]))
    return variants, per_size, any_gtin, dbg_types

# -------------------------
# MAIN
# -------------------------
def main():
    slug = stockx_slug_from_url(STOCKX_URL)
    print("STOCKX_URL=", STOCKX_URL)
    print("slug=", slug)
    print("MARKET=", MARKET, "| EU_MIN=", EU_MIN, "| EU_MAX=", EU_MAX, "| EU_LIST=", EU_LIST or "(all)", "| PRICE_MODE=", PRICE_MODE, "| FIXED_PRICE_EUR=", FIXED_PRICE_EUR, "| DEFAULT_QTY=", DEFAULT_QTY)
    print("SIZE_SUFFIX_MODE=", SIZE_SUFFIX_MODE, "| EXPRESS_LABEL=", EXPRESS_LABEL if SIZE_SUFFIX_MODE == "express" else "(n/a)")
    print("DRY_RUN=", 1 if DRY_RUN else 0)

    p = kicks_get_product_full(slug)
    if not p:
        raise RuntimeError("Empty Kicks product response")

    title = safe_str(p.get("title")) or slug
    brand = safe_str(p.get("brand")) or safe_str(p.get("vendor")) or "Unknown"
    raw_sku = safe_str(p.get("sku")) or slug.upper()

    release_date = normalize_release_date(
        safe_str(p.get("release_date")) or safe_str(p.get("releaseDate")) or safe_str(p.get("release"))
    )

    age_group = detect_age_group_value(title, slug)

    images = build_shopify_images_as_attachments(p)
    print("images_prepared=", len(images))

    variants, per_size, any_gtin, dbg_types = build_variants_from_kicks(
        p,
        sku_base_fixed=raw_sku,
        title_hint=title,
        slug_hint=slug,
    )

    if not variants:
        print("NO VARIANTS MATCHED. Size types seen in Kicks variants:", dbg_types or "(none)")
        samples = []
        for v in (p.get("variants") or [])[:10]:
            sblock = []
            for s in (v.get("sizes", []) or []):
                sblock.append({"type": s.get("type"), "size": s.get("size")})
            if sblock:
                samples.append(sblock)
            if len(samples) >= 3:
                break
        print("Samples sizes blocks:", samples)
        raise RuntimeError("No variants matched after size conversion and range filtering.")

    print("variants_prepared=", len(variants), "| any_gtin=", any_gtin)

    payload = {
        "product": {
            "title": title,
            "vendor": brand,
            "product_type": PRODUCT_TYPE,     # "Scarpe"
            "tags": TAGS,
            "template_suffix": TEMPLATE_SUFFIX,
            "status": STATUS,                 # active
            "published_scope": "global",
            "body_html": f"<p>{title}</p>",
            "options": [{"name": "Size"}],
            "variants": variants,
            "images": images,
        }
    }

    if DRY_RUN:
        print("DRY_RUN would create product:", title, "| vendor:", brand, "| type:", PRODUCT_TYPE, "| variants:", len(variants))
        return

    cr = request_retry(
        "POST",
        f"{SHOP_REST}/products.json",
        headers=headers_shop_rest,
        json=payload,
        timeout=REST_TIMEOUT,
        tries=REST_TRIES,
        backoff=REST_BACKOFF,
    )
    if cr.status_code not in (200, 201):
        raise RuntimeError(f"Shopify create failed status={cr.status_code} body={cr.text[:800]}")

    created = (cr.json() or {}).get("product") or {}
    pid = created.get("id")
    if not pid:
        raise RuntimeError("Shopify create returned no product id")

    pgid = product_gid(int(pid))
    print("Created product_id=", pid, "| title=", created.get("title"))

    pmf = build_product_metafields(pgid, slug, release_date, any_gtin)
    ok_pmf = metafields_set_batched(pmf, batch_size=25)
    print("Product metafields set:", ok_pmf, "| count:", len(pmf))

    created_variants = created.get("variants") or []

    inv_item_gids = []
    for vv in created_variants:
        inv_item_id = vv.get("inventory_item_id")
        if inv_item_id:
            inv_item_gids.append(inventory_item_gid(int(inv_item_id)))

    ok_inv = inventory_set_quantities_at_location(inv_item_gids, DEFAULT_QTY, LOCATION_GID)
    print("Inventory set qty=", DEFAULT_QTY, "| ok=", 1 if ok_inv else 0, "| variants=", len(inv_item_gids))

    # Build variant metafields:
    # - size metafield must be RAW EU (no suffix)
    # - match by parsing numeric size from vv.option1 then mapping to per_size
    vmf_items = []
    wrote_upc = 0
    wrote_size = 0

    for vv in created_variants:
        vid = vv.get("id")
        if not vid:
            continue

        opt1 = (vv.get("option1") or "").strip()
        eu_num = size_numeric_key(opt1)
        if eu_num >= 9999:
            continue

        eu_raw = eu_display(eu_num)   # RAW EU (no suffix)
        vgid = variant_gid(int(vid))

        mpn = raw_sku
        upc_backup = (per_size.get(eu_raw, {}) or {}).get("upc_backup") or None

        vmf_items.extend(build_variant_metafields(vgid, eu_raw, age_group, mpn=mpn, upc_backup=upc_backup))

        if VARIANT_SIZE_METAFIELD and eu_raw:
            wrote_size += 1
        if UPC_BACKUP_METAFIELD and upc_backup:
            wrote_upc += 1

    ok_vmf = metafields_set_batched(vmf_items, batch_size=25)
    print("Variant metafields set:", ok_vmf, "| items:", len(vmf_items), "| size_written:", wrote_size, "| upc_backup_written:", wrote_upc)

    print("DONE.")

if __name__ == "__main__":
    main()
