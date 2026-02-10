#!/usr/bin/env python3
import csv
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
import argparse

from dotenv import load_dotenv
from pymongo import MongoClient


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")


def _normalize_identity_str(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip().upper())


def _build_identity_key(data: dict) -> str:
    fiscal = _normalize_identity_str(data.get("fiscal_code"))
    if fiscal:
        return f"FISCAL:{fiscal}"
    first_name = _normalize_identity_str(data.get("first_name"))
    last_name = _normalize_identity_str(data.get("last_name"))
    full_name = " ".join([p for p in [first_name, last_name] if p]).strip()
    if full_name:
        return f"NAME:{full_name}"
    parts = [
        first_name,
        last_name,
        _normalize_identity_str(data.get("birth_date")),
        _normalize_identity_str(data.get("birth_place")),
        _normalize_identity_str(data.get("birth_country")),
        _normalize_identity_str(data.get("residence_city")),
    ]
    raw = "|".join(parts)
    import hashlib
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
    return f"HASH:{digest}"


def _repair_mojibake(value: str) -> str:
    if value is None:
        return ""
    s = str(value)
    # Attempt to fix common UTF-8 read as latin-1 artifacts.
    if "Ã" in s or "â" in s or "Â" in s:
        try:
            return s.encode("latin1").decode("utf-8")
        except Exception:
            return s
    return s


def _parse_address_city(raw: str):
    if not raw:
        return "", ""
    text = _repair_mojibake(raw).strip()
    if "," in text:
        addr, city = text.rsplit(",", 1)
        return addr.strip(), city.strip()
    return text, ""


def _guess_residence_country(res_prov: str, cap: str):
    prov = (res_prov or "").strip().upper()
    if prov and re.fullmatch(r"[A-Z]{2,3}", prov):
        return "IT"
    cap_digits = re.sub(r"\D+", "", cap or "")
    if cap_digits:
        return "IT"
    return ""


def _resolve_csv_path(arg_value: str | None) -> Path:
    candidates = []
    if arg_value:
        candidates.append(Path(arg_value))
    env_path = os.environ.get("CSV_PATH")
    if env_path:
        candidates.append(Path(env_path))
    # Common defaults (Windows + Linux deploy)
    candidates.append(Path(r"C:\Users\jnuci\OneDrive\Desktop\SharkShopify\identita_complete.csv"))
    candidates.append(Path("/home/deploy/identita_complete.csv"))

    for c in candidates:
        try:
            if c.exists():
                return c
        except Exception:
            continue
    raise SystemExit("CSV non trovato. Passa --csv oppure imposta CSV_PATH.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", dest="csv_path", default=None)
    args = parser.parse_args()

    csv_path = _resolve_csv_path(args.csv_path)

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        raise SystemExit("MONGO_URL non trovato in backend/.env")
    db_name = os.environ.get("DB_NAME", "sharkdrop_wms")

    client = MongoClient(mongo_url)
    db = client[db_name]
    col = db.purchase_identities

    inserted = 0
    updated = 0
    now = datetime.utcnow()

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            nome = _repair_mojibake(row.get("Nome", "")).strip()
            cognome = _repair_mojibake(row.get("Cognome", "")).strip()
            birth_date = _repair_mojibake(row.get("Data_Nascita", "")).strip()
            birth_place = _repair_mojibake(row.get("Luogo_Nascita", "")).strip()
            birth_country = _repair_mojibake(row.get("Prov_Nascita", "")).strip()
            indirizzo_raw = row.get("Indirizzo", "") or ""
            residence_address, residence_city = _parse_address_city(indirizzo_raw)
            residence_province = _repair_mojibake(row.get("Provincia", "")).strip()
            residence_cap = _repair_mojibake(row.get("CAP", "")).strip()
            phone = _repair_mojibake(row.get("Telefono", "")).strip()
            email = _repair_mojibake(row.get("Email", "")).strip()
            fiscal = _repair_mojibake(row.get("Codice_Fiscale", "")).strip()

            data = {
                "first_name": nome,
                "last_name": cognome,
                "birth_date": birth_date,
                "birth_place": birth_place,
                "birth_country": birth_country,
                "residence_address": residence_address,
                "residence_city": residence_city,
                "residence_province": residence_province,
                "residence_cap": residence_cap,
                "residence_country": _guess_residence_country(residence_province, residence_cap),
                "fiscal_code": fiscal,
                "phone": phone,
                "email": email or None,
            }

            identity_key = _build_identity_key(data)
            res = col.update_one(
                {"identity_key": identity_key},
                {
                    "$set": {
                        "updated_at": now,
                        "last_used_at": now,
                        "data": data,
                    },
                    "$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "created_at": now,
                        "identity_key": identity_key,
                    },
                },
                upsert=True,
            )
            if res.upserted_id:
                inserted += 1
            elif res.modified_count:
                updated += 1

    print(f"IDENTITIES importate. Nuove: {inserted} | Aggiornate: {updated}")


if __name__ == "__main__":
    main()
