#!/usr/bin/env python3
import os
import re
import hashlib
from datetime import datetime

from pymongo import MongoClient


def _norm(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v).strip().upper())


def _key(data: dict) -> str:
    fiscal = _norm(data.get("fiscal_code"))
    if fiscal:
        return f"FISCAL:{fiscal}"
    full_name = " ".join([p for p in [_norm(data.get("first_name")), _norm(data.get("last_name"))] if p]).strip()
    if full_name:
        return f"NAME:{full_name}"
    parts = [
        _norm(data.get("first_name")),
        _norm(data.get("last_name")),
        _norm(data.get("birth_date")),
        _norm(data.get("birth_place")),
        _norm(data.get("birth_country")),
        _norm(data.get("residence_city")),
    ]
    raw = "|".join(parts)
    return f"HASH:{hashlib.sha1(raw.encode('utf-8')).hexdigest()}"


def main():
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        raise SystemExit("MONGO_URL non trovato")
    client = MongoClient(mongo_url)
    db = client[os.environ.get("DB_NAME", "sharkdrop_wms")]
    col = db.purchase_identities
    now = datetime.utcnow()

    try:
        col.drop_index("identity_key_1")
    except Exception:
        pass

    seen = {}
    removed = 0
    updated = 0
    docs = list(col.find({}, {"_id": 1, "data": 1}))
    for doc in docs:
        data = doc.get("data") or {}
        key = _key(data)
        if key in seen:
            base = seen[key]
            merged = dict(base.get("data") or {})
            for k, v in (data or {}).items():
                if (not merged.get(k)) and v:
                    merged[k] = v
            col.update_one({"_id": base["_id"]}, {"$set": {"identity_key": key, "data": merged, "updated_at": now}})
            col.delete_one({"_id": doc["_id"]})
            removed += 1
            updated += 1
        else:
            col.update_one({"_id": doc["_id"]}, {"$set": {"identity_key": key}})
            seen[key] = doc
            updated += 1

    col.create_index("identity_key", unique=True)
    print(f"IDENTITIES migrate complete. Updated: {updated} | Removed dup: {removed}")


if __name__ == "__main__":
    main()
