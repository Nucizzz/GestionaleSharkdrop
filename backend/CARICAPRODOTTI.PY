#!/usr/bin/env python3
# IMPORTSTOCKLINKNIKE_FEED_FALLBACK_STOCKX360.py
#
# Nike-first images:
# - Try Nike product_feed images STRICT by styleColor (US/en first, then IT/it).
# - If Nike images not found / download fails -> fallback to StockX 360 frames from Kicks
#   EXACTLY like your IMPORTASTOCKLINK.py logic (IMG_NUMBERS + near-white cut + canvas).
#
# Variants: from Kicks, EU range optional, fixed price default.
# Shopify: create product + set inventory.
#
# pip install requests python-dotenv pillow numpy

import os
import re
import time
import json
import base64
import hashlib
import requests
from io import BytesIO
from dotenv import load_dotenv, find_dotenv
from PIL import Image

# -------------------------
# .env loading
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

def env_bool(name: str, default="0"):
    v = env_pick(name, default=default)
    return str(v).strip() == "1"

# -------------------------
# CONFIG
# -------------------------
SHOP_DOMAIN = env_pick("SHOP_DOMAIN")
TOKEN = env_pick("ADMIN_API_TOKEN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_TOKEN")
KICKS_KEY = env_pick("KICKS_API_KEY")
LOCATION_ID = env_pick("LOCATION_ID")

STOCKX_URL = env_pick("STOCKX_PRODUCT_URL", "STOCKX_URL")

API_VERSION = env_pick("API_VERSION", default="2024-10")
MARKET = env_pick("KICKS_MARKET", default="IT").upper()

# Optional range; if BOTH missing => import all sizes available
EU_MIN = env_float("EU_MIN", default=None)
EU_MAX = env_float("EU_MAX", default=None)

# Pricing
FIXED_PRICE_EUR = env_int("FIXED_PRICE_EUR", default=220)
DEFAULT_QTY = env_int("DEFAULT_QTY", default=0)

PRODUCT_TYPE = env_pick("PRODUCT_TYPE", default="Scarpe")
STATUS = env_pick("STATUS", default="active")  # active|draft
TAGS = env_pick("TAGS", default="StockX Import")
TEMPLATE_SUFFIX = env_pick("TEMPLATE_SUFFIX", default="prova")

# Size label behavior
SIZE_SUFFIX_MODE = (env_pick("SIZE_SUFFIX_MODE", "SIZE_MODE", default="off") or "off").strip().lower()
EXPRESS_LABEL = env_pick("EXPRESS_LABEL", default="Express 24/48H")

# Nike images
NIKE_IMG_LIMIT = env_int("NIKE_IMG_LIMIT", default=24)  # 0 => no limit
NIKE_MAX_FETCH = env_int("NIKE_MAX_FETCH", default=200)

# StockX 360 fallback images (EXACT style of your script)
IMG_NUMBERS = [x.strip() for x in env_pick("IMG_NUMBERS", default="20,15,01,10,28").split(",") if x.strip()]

# Image canvas params
IMG_W = env_int("IMG_W", default=1065)
IMG_H = env_int("IMG_H", default=1440)
BG_HEX = env_pick("BG_HEX", default="#f5f5f3ff")
PAD_RATIO = env_float("PAD_RATIO", default=0.040)

# Fallback 360 processing params
WHITE_CUT = env_int("WHITE_CUT", default=245)

# Nike pipeline options
BORDER_TRIM = env_bool("BORDER_TRIM", default="1")
BORDER_TOL = env_int("BORDER_TOL", default=14)

DEDUP = env_bool("DEDUP", default="1")
DEDUP_EXACT = env_bool("DEDUP_EXACT", default="1")
DEDUP_DHASH = env_bool("DEDUP_DHASH", default="1")
DEDUP_DHASH_THRESH = env_int("DEDUP_DHASH_THRESH", default=4)
DEDUP_PIX = env_bool("DEDUP_PIX", default="1")
DEDUP_PIX_THR = env_float("DEDUP_PIX_THR", default=3.2)
DEDUP_THUMB = env_int("DEDUP_THUMB", default=224)

DRY_RUN = env_pick("DRY_RUN", default="0") == "1"

REST_TIMEOUT = 120
REST_TRIES = 5
REST_BACKOFF = 1.3

KX_TIMEOUT = 45
KX_TRIES = 3
KX_BACKOFF = 0.9

IMG_TIMEOUT = env_int("IMG_TIMEOUT", default=80)
IMG_TRIES = env_int("IMG_TRIES", default=5)
IMG_BACKOFF = env_float("IMG_BACKOFF", default=1.0)

# Nike feed defaults
NIKE_MARKETPLACE_PREF = env_pick("NIKE_MARKETPLACE_PREF", default="US").upper()
NIKE_LANGUAGE_PREF = env_pick("NIKE_LANGUAGE_PREF", default="en")
NIKE_MARKETPLACE_FALLBACK = env_pick("NIKE_MARKETPLACE_FALLBACK", default="IT").upper()
NIKE_LANGUAGE_FALLBACK = env_pick("NIKE_LANGUAGE_FALLBACK", default="it")
NIKE_CHANNEL_ID = env_pick("NIKE_CHANNEL_ID", default="d9a5bc42-4b9c-4976-858a-f159cf99c647")
NIKE_FEED_COUNT = env_int("NIKE_FEED_COUNT", default=40)

if not all([SHOP_DOMAIN, TOKEN, KICKS_KEY, LOCATION_ID, STOCKX_URL]):
    raise SystemExit("Missing env vars: SHOP_DOMAIN, ADMIN_API_TOKEN, KICKS_API_KEY, LOCATION_ID, STOCKX_PRODUCT_URL (or STOCKX_URL)")
if not str(LOCATION_ID).isdigit():
    raise SystemExit("Invalid LOCATION_ID (must be numeric)")

SHOP_REST = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}"
SHOP_GQL = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
headers_shop_rest = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}
headers_shop_gql = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}
headers_kx = {"Authorization": f"Bearer {KICKS_KEY}"}
LOCATION_GID = f"gid://shopify/Location/{LOCATION_ID}"

# -------------------------
# Metafields (align with IMPORTAPRODOTTISTOCKX.PY)
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

NIKE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9,it-IT,it;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}
IMG_HEADERS_BASE = {
    "User-Agent": NIKE_HEADERS["User-Agent"],
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": NIKE_HEADERS["Accept-Language"],
}

# -------------------------
# HTTP helpers
# -------------------------
def request_retry(method, url, *, headers=None, params=None, json=None, data=None,
                  timeout=30, tries=3, backoff=0.8, allow_redirects=True):
    last = None
    for i in range(tries):
        try:
            r = requests.request(
                method, url,
                headers=headers, params=params, json=json, data=data,
                timeout=timeout, allow_redirects=allow_redirects
            )
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

def _np():
    import numpy as np
    return np

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
# styleColor extraction
# -------------------------
STYLECOLOR_RE = re.compile(r"\b([A-Z0-9]{4,10}-\d{3})\b", re.I)

def extract_style_color(*cands: str) -> str | None:
    for c in cands:
        s = (c or "").strip()
        if not s:
            continue
        m = STYLECOLOR_RE.search(s)
        if m:
            return m.group(1).upper()
    return None

# -------------------------
# Nike FEED strict images by styleColor
# -------------------------
def nike_is_img(url: str) -> bool:
    u = (url or "").lower()
    if "static.nike.com" not in u:
        return False
    if "/a/images/" not in u:
        return False
    return bool(re.search(r"\.(jpg|jpeg|png)(\?|$)", u))

def nike_canonical_asset_key(url: str) -> str:
    u = (url or "").split("?", 1)[0].lower()
    m = re.search(r"/a/images/(.+)$", u)
    if not m:
        return u
    tail = m.group(1)
    tail = re.sub(r"^t_[^/]+/", "", tail)
    tail = re.sub(r",w_\d+", "", tail)
    tail = re.sub(r",h_\d+", "", tail)
    return "/a/images/" + tail

def nike_upgrade_url(u: str) -> str:
    x = (u or "").strip()
    if not x:
        return x
    return re.sub(r"/t_default/", "/t_pdp_1728_v1/", x)

def _collect_urls_anywhere(obj, out: list[str]):
    if isinstance(obj, dict):
        for _, v in obj.items():
            if isinstance(v, str):
                if "static.nike.com" in v and re.search(r"\.(jpg|jpeg|png)(\?|$)", v, flags=re.I):
                    u = v.strip()
                    if u.startswith("//"):
                        u = "https:" + u
                    out.append(u)
            else:
                _collect_urls_anywhere(v, out)
    elif isinstance(obj, list):
        for it in obj:
            _collect_urls_anywhere(it, out)

def nike_feed_fetch(style_color: str, marketplace: str, language: str) -> dict:
    api = "https://api.nike.com/product_feed/threads/v2/"
    sc = style_color.strip().upper()
    params = [
        ("count", str(int(NIKE_FEED_COUNT))),
        ("filter", f"marketplace({marketplace})"),
        ("filter", f"language({language})"),
        ("filter", f"channelId({NIKE_CHANNEL_ID})"),
        ("filter", f"publishedContent.properties.products.styleColor({sc})"),
    ]
    r = request_retry("GET", api, headers=NIKE_HEADERS, params=params, timeout=35, tries=4, backoff=1.0)
    if r.status_code != 200:
        raise RuntimeError(f"Nike feed failed status={r.status_code} body={r.text[:220]}")
    return r.json() or {}

def nike_feed_extract_urls_strict(feed_json: dict, style_color: str) -> list[str]:
    sc = style_color.strip().upper()
    objs = (feed_json.get("objects") or feed_json.get("data", {}).get("objects") or [])
    if not objs:
        return []

    best_urls: list[str] = []
    for o in objs[:200]:
        try:
            prods = o.get("publishedContent", {}).get("properties", {}).get("products") or []
        except Exception:
            prods = []
        ok = False
        for p in prods:
            if isinstance(p, dict) and (str(p.get("styleColor") or "").strip().upper() == sc):
                ok = True
                break
        if not ok:
            continue

        urls_raw: list[str] = []
        _collect_urls_anywhere(o, urls_raw)
        urls = [u for u in urls_raw if nike_is_img(u)]
        if len(urls) > len(best_urls):
            best_urls = urls

    if not best_urls:
        return []

    seen = set()
    uniq = []
    for u in best_urls:
        k = nike_canonical_asset_key(u)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(u)
    return uniq

def nike_fetch_gallery_urls_from_feed(style_color: str) -> tuple[list[str], str]:
    feed1 = nike_feed_fetch(style_color, NIKE_MARKETPLACE_PREF, NIKE_LANGUAGE_PREF)
    urls1 = nike_feed_extract_urls_strict(feed1, style_color)
    if urls1:
        return urls1, f"{NIKE_MARKETPLACE_PREF}/{NIKE_LANGUAGE_PREF}"

    feed2 = nike_feed_fetch(style_color, NIKE_MARKETPLACE_FALLBACK, NIKE_LANGUAGE_FALLBACK)
    urls2 = nike_feed_extract_urls_strict(feed2, style_color)
    if urls2:
        return urls2, f"{NIKE_MARKETPLACE_FALLBACK}/{NIKE_LANGUAGE_FALLBACK}"

    return [], "none"

# -------------------------
# Image download
# -------------------------
def download_image(url: str, referer: str = "https://www.nike.com/") -> Image.Image:
    u = (url or "").strip()
    if not u:
        raise ValueError("empty image url")

    candidates = [u, nike_upgrade_url(u)]
    base = u.split("?", 1)[0]
    base2 = re.sub(r"(/a/images/)t_[^/]+/", r"\1", base, flags=re.I)
    candidates += [base, base2, nike_upgrade_url(base)]

    uniq = []
    seen = set()
    for c in candidates:
        c = (c or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        uniq.append(c)

    headers = dict(IMG_HEADERS_BASE)
    headers["Referer"] = referer

    last_err = None
    for attempt_url in uniq:
        try:
            r = request_retry(
                "GET",
                attempt_url,
                headers=headers,
                timeout=IMG_TIMEOUT,
                tries=IMG_TRIES,
                backoff=IMG_BACKOFF,
                allow_redirects=True
            )
            if r.status_code != 200:
                raise RuntimeError(f"status={r.status_code}")
            ct = (r.headers.get("Content-Type") or "").lower()
            if "image" not in ct:
                raise RuntimeError(f"not-image content-type={ct or 'none'}")
            b = r.content
            if not b or len(b) < 2000:
                raise RuntimeError("empty/too-small image body")
            img = Image.open(BytesIO(b))
            img.load()
            return img
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"download_image failed: {type(last_err).__name__}: {str(last_err)[:160]}")

# -------------------------
# BG helpers
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

def estimate_bg_rgb_from_corners(img_rgb: Image.Image, patch=18):
    np = _np()
    w, h = img_rgb.size
    p = max(4, min(patch, w // 8, h // 8))
    corners = [(0, 0, p, p), (w - p, 0, w, p), (0, h - p, p, h), (w - p, h - p, w, h)]
    arr = np.array(img_rgb, dtype=np.uint8)
    samples = []
    for (x0, y0, x1, y1) in corners:
        samples.append(arr[y0:y1, x0:x1, :].reshape(-1, 3))
    s = np.concatenate(samples, axis=0)
    med = np.median(s, axis=0).astype(int)
    return (int(med[0]), int(med[1]), int(med[2]))

def trim_uniform_border(img_rgb: Image.Image, bg_rgb, tol=14):
    np = _np()
    arr = np.array(img_rgb, dtype=np.int16)
    bg = np.array(bg_rgb, dtype=np.int16).reshape(1, 1, 3)
    diff = np.max(np.abs(arr - bg), axis=2)
    mask = diff > int(tol)
    if not mask.any():
        return img_rgb
    ys, xs = np.where(mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    pad = 2
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(img_rgb.size[0], x1 + pad)
    y1 = min(img_rgb.size[1], y1 + pad)
    if (x1 - x0) < 50 or (y1 - y0) < 50:
        return img_rgb
    return img_rgb.crop((x0, y0, x1, y1))

# -------------------------
# Canvas / encoding
# -------------------------
def img_to_base64_jpg_keep_bg(img_rgba: Image.Image, quality: int = 92) -> str:
    rgb = img_rgba.convert("RGB")
    bio = BytesIO()
    rgb.save(bio, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(bio.getvalue()).decode("ascii")

def fit_to_canvas_padded_keep_bg(img_rgb: Image.Image, canvas_w: int, canvas_h: int, bg_rgba, pad_ratio: float):
    bg = Image.new("RGBA", (canvas_w, canvas_h), bg_rgba)
    im = img_rgb.convert("RGBA")
    iw, ih = im.size
    if iw <= 0 or ih <= 0:
        return bg
    target_w = max(1, int(canvas_w * (1.0 - pad_ratio * 2)))
    target_h = max(1, int(canvas_h * (1.0 - pad_ratio * 2)))
    scale = min(target_w / iw, target_h / ih)
    new_w = max(1, int(iw * scale))
    new_h = max(1, int(ih * scale))
    fg = im.resize((new_w, new_h), Image.LANCZOS)
    x = (canvas_w - new_w) // 2
    y = (canvas_h - new_h) // 2
    bg.alpha_composite(fg, (x, y))
    return bg

# --- StockX 360 fallback processing (EXACT behavior you provided) ---
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

def fit_to_canvas_full(img_rgba: Image.Image, canvas_w: int, canvas_h: int, bg_rgba: tuple[int,int,int,int]) -> Image.Image:
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

def img_to_base64_jpg_white_composite(img_rgba: Image.Image, quality: int = 92) -> str:
    rgb = Image.new("RGB", img_rgba.size, (255, 255, 255))
    rgb.paste(img_rgba, mask=img_rgba.split()[-1])
    bio = BytesIO()
    rgb.save(bio, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(bio.getvalue()).decode("ascii")

# -------------------------
# DEDUPE (for Nike feed images)
# -------------------------
def _thumb_for_hash(img_rgb: Image.Image, side: int = 224) -> Image.Image:
    im = img_rgb.convert("RGB")
    w, h = im.size
    if max(w, h) != side:
        if w >= h:
            nw = side
            nh = max(1, int(round(h * (side / w))))
        else:
            nh = side
            nw = max(1, int(round(w * (side / h))))
        im = im.resize((nw, nh), Image.BILINEAR)
    return im

def exact_md5_thumb(img_rgb: Image.Image, side: int = 224) -> str:
    t = _thumb_for_hash(img_rgb, side=side)
    bio = BytesIO()
    t.save(bio, format="PNG", optimize=True)
    return hashlib.md5(bio.getvalue()).hexdigest()

def dhash64(img_rgb: Image.Image, hash_size: int = 8) -> int:
    g = img_rgb.convert("L").resize((hash_size + 1, hash_size), Image.BILINEAR)
    px = list(g.getdata())
    bits = 0
    for y in range(hash_size):
        row = px[y * (hash_size + 1) : (y + 1) * (hash_size + 1)]
        for x in range(hash_size):
            bits = (bits << 1) | (1 if row[x] > row[x + 1] else 0)
    return bits

def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()

def is_near_dup_dhash(h: int, seen: list[int], thresh: int) -> bool:
    for s in seen:
        if hamming(h, s) <= thresh:
            return True
    return False

def pix_thumb_array(img_rgb: Image.Image, side: int = 224):
    np = _np()
    t = _thumb_for_hash(img_rgb, side=side).convert("L")
    return np.array(t, dtype=np.float32)

def mean_abs_diff(a, b) -> float:
    np = _np()
    if a.shape != b.shape:
        hh = min(a.shape[0], b.shape[0])
        ww = min(a.shape[1], b.shape[1])
        a = a[:hh, :ww]
        b = b[:hh, :ww]
    return float(np.mean(np.abs(a - b)))

# -------------------------
# Build Shopify images from Nike feed (strict) OR fallback to StockX 360
# -------------------------
def build_shopify_images_from_nike_feed(style_color: str) -> list[dict]:
    bg_rgba = hex_to_rgba(BG_HEX)

    urls, src = nike_fetch_gallery_urls_from_feed(style_color)
    if not urls:
        raise RuntimeError(f"Nike FEED: no images for styleColor={style_color}")

    print(f"NIKE_FEED: extracted_urls={len(urls)} src={src} styleColor={style_color}")

    out: list[dict] = []
    seen_exact: set[str] = set()
    seen_dh: list[int] = []
    seen_pix: list = []

    tried = kept = skipped_dup = skipped_dl = 0

    for idx, u in enumerate(urls[:NIKE_MAX_FETCH], start=1):
        tried += 1
        try:
            img0 = download_image(u, referer="https://www.nike.com/")
        except Exception as e:
            skipped_dl += 1
            print(f"NIKE_FEED: skip download idx={idx} err={str(e)[:160]}")
            continue

        img_rgb = img0.convert("RGB")

        if BORDER_TRIM:
            bg_est = estimate_bg_rgb_from_corners(img_rgb, patch=18)
            img_rgb = trim_uniform_border(img_rgb, bg_est, tol=BORDER_TOL)

        canvas = fit_to_canvas_padded_keep_bg(img_rgb, IMG_W, IMG_H, bg_rgba, pad_ratio=float(PAD_RATIO))
        rgb_for_hash = canvas.convert("RGB")

        if DEDUP:
            if DEDUP_EXACT:
                md = exact_md5_thumb(rgb_for_hash, side=int(DEDUP_THUMB))
                if md in seen_exact:
                    skipped_dup += 1
                    continue
                seen_exact.add(md)

            if DEDUP_DHASH:
                dh = dhash64(_thumb_for_hash(rgb_for_hash, side=int(DEDUP_THUMB)), hash_size=8)
                if is_near_dup_dhash(dh, seen_dh, thresh=int(DEDUP_DHASH_THRESH)):
                    skipped_dup += 1
                    continue
                seen_dh.append(dh)

            if DEDUP_PIX:
                arr = pix_thumb_array(rgb_for_hash, side=int(DEDUP_THUMB))
                isdup = False
                for prev in seen_pix[-30:]:
                    if mean_abs_diff(arr, prev) <= float(DEDUP_PIX_THR):
                        isdup = True
                        break
                if isdup:
                    skipped_dup += 1
                    continue
                seen_pix.append(arr)

        out.append({"attachment": img_to_base64_jpg_keep_bg(canvas)})
        kept += 1
        print(f"NIKE_FEED: kept idx={idx} raw={img0.size[0]}x{img0.size[1]} url={u[:110]}")

        if NIKE_IMG_LIMIT and len(out) >= NIKE_IMG_LIMIT:
            break

        time.sleep(0.02)

    print(f"NIKE_FEED: tried={tried} kept={kept} skipped_dup={skipped_dup} skipped_dl={skipped_dl} limit={NIKE_IMG_LIMIT}")
    if not out:
        raise RuntimeError("Nike FEED images: could not download any.")
    return out

# --- StockX 360 fallback (EXACT logic from your script) ---
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

def build_shopify_images_from_stockx_360(kicks_product: dict) -> list[dict]:
    urls = pick_360_urls_from_kicks(kicks_product, IMG_NUMBERS)
    if not urls:
        raise RuntimeError("Fallback StockX360: no matching gallery_360 URLs found for IMG_NUMBERS.")

    bg = hex_to_rgba(BG_HEX)
    out = []
    for u in urls:
        img = download_image(u, referer="https://stockx.com/").convert("RGBA")
        img = remove_near_white_to_alpha(img, WHITE_CUT)
        canvas = fit_to_canvas_full(img, IMG_W, IMG_H, bg)
        b64 = img_to_base64_jpg_white_composite(canvas)
        out.append({"attachment": b64})
        time.sleep(0.15)
    return out

def build_images_nike_else_stockx360(p: dict, style_color: str | None) -> tuple[list[dict], str]:
    # Returns (images, source_label)
    if style_color:
        try:
            imgs = build_shopify_images_from_nike_feed(style_color)
            return imgs, "nike_feed"
        except Exception as e:
            print(f"NIKE_FEED failed -> fallback to STOCKX_360. err={str(e)[:220]}")
    imgs = build_shopify_images_from_stockx_360(p)
    return imgs, "stockx_360"

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
        part = inventory_item_gids[i : i + chunk]
        quantities = [{"inventoryItemId": iid, "locationId": location_gid, "quantity": int(quantity)} for iid in part]
        variables = {
            "input": {
                "name": "available",
                "reason": "correction",
                "ignoreCompareQuantity": True,
                "quantities": quantities,
            }
        }
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
# Metafields helpers
# -------------------------
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
# Identifier rule (prefers EAN starting with 40; backups UPC12)
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

# -------------------------
# SIZE PARSING + CONVERSION
# -------------------------
def parse_size_number(raw: str) -> float | None:
    s = (raw or "").strip().upper()
    if not s:
        return None
    s = s.replace(",", ".")
    s = s.replace("\u00bd", ".5").replace("\u2153", ".333").replace("\u2154", ".666")
    s = s.replace("\u00C2\u00BD", ".5").replace("\u00E2\u2026\u201C", ".333").replace("\u00E2\u2026\u201D", ".666")
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
    for s in sizes:
        t = (s.get("type") or "").strip().lower()
        if t == "eu":
            raw = safe_str(s.get("size"))
            val = parse_size_number(raw or "")
            if val is not None:
                return val

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
    m = re.search(r"(\d+(?:\.\d+)?)", (option1 or "").replace(",", "."))
    if not m:
        return 9999.0
    try:
        return float(m.group(1))
    except:
        return 9999.0

# -------------------------
# Build variants from Kicks
# -------------------------
def build_variants_from_kicks(p: dict, *, sku_base_fixed: str, title_hint: str, slug_hint: str):
    variants = []
    per_size = {}
    any_gtin = False
    seen = set()

    for v in (p.get("variants") or []):
        eu_val = get_eu_size_from_variant(v, title_hint=title_hint, slug_hint=slug_hint)
        if eu_val is None:
            continue

        if EU_MIN is not None and eu_val < EU_MIN - 1e-9:
            continue
        if EU_MAX is not None and eu_val > EU_MAX + 1e-9:
            continue

        eu_disp = eu_display(eu_val)
        if not eu_disp or eu_disp in seen:
            continue

        barcode, upc_backup = choose_barcode_and_upc_backup(v.get("identifiers") or [])
        if barcode:
            any_gtin = True

        option1 = apply_size_suffix(eu_disp)
        vp = {
            "option1": option1,
            "price": str(int(FIXED_PRICE_EUR)),
            "sku": sku_base_fixed,
            "inventory_management": "shopify",
            "inventory_policy": "continue",
            "requires_shipping": True,
            "grams": 2000,
        }
        if barcode:
            vp["barcode"] = str(barcode)

        variants.append(vp)
        per_size[eu_disp] = {"upc_backup": upc_backup or ""}
        seen.add(eu_disp)

    variants.sort(key=lambda x: size_numeric_key(x["option1"]))
    return variants, per_size, any_gtin

# -------------------------
# MAIN
# -------------------------
def main():
    slug = stockx_slug_from_url(STOCKX_URL)
    print("STOCKX_PRODUCT_URL=", STOCKX_URL)
    print("slug=", slug)

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

    style_color = extract_style_color(
        safe_str(p.get("styleColor")),
        safe_str(p.get("style_color")),
        raw_sku,
        title,
        slug,
    )
    print("styleColor=", style_color or "(none)")

    print("IMG_NIKE_LIMIT=", NIKE_IMG_LIMIT, "| IMG_NUMBERS_FALLBACK=", IMG_NUMBERS)
    print("DRY_RUN=", 1 if DRY_RUN else 0)

    images, img_src = build_images_nike_else_stockx360(p, style_color)
    print("images_prepared=", len(images), "| source=", img_src)

    variants, per_size, any_gtin = build_variants_from_kicks(
        p, sku_base_fixed=raw_sku, title_hint=title, slug_hint=slug
    )
    if not variants:
        raise RuntimeError("No variants matched after size conversion and range filtering.")
    print("variants_prepared=", len(variants), "| any_gtin=", any_gtin)

    payload = {
        "product": {
            "title": title,
            "vendor": brand,
            "product_type": PRODUCT_TYPE,
            "tags": TAGS,
            "template_suffix": TEMPLATE_SUFFIX,
            "status": STATUS,
            "published_scope": "global",
            "body_html": f"<p>{title}</p>",
            "options": [{"name": "Size"}],
            "variants": variants,
            "images": images,
        }
    }

    if DRY_RUN:
        print("DRY_RUN would create product:", title, "| vendor:", brand, "| variants:", len(variants), "| images:", len(images), "| img_src:", img_src)
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

    print("Created product_id=", pid, "| title=", created.get("title"))

    pgid = product_gid(int(pid))
    print("Created product_id=", pid, "| title=", created.get("title"))

    # Product metafields (slug + release_date + identifier_exists)
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

    # Variant metafields (size + UPC backup + Google attrs)
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
        eu_raw = eu_display(eu_num)
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

