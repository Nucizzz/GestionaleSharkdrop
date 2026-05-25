from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_SUMUP_BASE_URL = "https://api.sumup.com"
DEFAULT_SUMUP_CURRENCY = "EUR"
DEFAULT_SUMUP_TIMEOUT_SECONDS = 20.0
DEFAULT_SUMUP_ALLOWED_USERNAME = "cassa"


@dataclass(frozen=True)
class SumupSettings:
    enabled: bool
    api_key: str
    base_url: str
    merchant_code: str
    currency: str
    timeout_seconds: float
    reader_id: str
    webhook_secret: str
    allowed_username: str

    @property
    def configured(self) -> bool:
        return bool(self.enabled and self.api_key and self.merchant_code and self.reader_id)

    @property
    def base_configured(self) -> bool:
        return bool(self.enabled and self.api_key and self.merchant_code)

    @property
    def reader_present(self) -> bool:
        return bool(self.reader_id)

    @property
    def terminal_present(self) -> bool:
        # Backward-compatible alias used by existing status payload/clients.
        return self.reader_present


def _as_bool(raw: str) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


def _parse_timeout(raw: str) -> float:
    try:
        value = float(raw)
    except Exception:
        return DEFAULT_SUMUP_TIMEOUT_SECONDS
    if value <= 0:
        return DEFAULT_SUMUP_TIMEOUT_SECONDS
    return min(value, 120.0)


def load_sumup_settings() -> SumupSettings:
    enabled = _as_bool(os.getenv("SUMUP_ENABLED") or "")
    api_key = str(os.getenv("SUMUP_API_KEY") or "").strip()
    base_url = str(os.getenv("SUMUP_BASE_URL") or DEFAULT_SUMUP_BASE_URL).strip().rstrip("/")
    merchant_code = str(os.getenv("SUMUP_MERCHANT_CODE") or "").strip()
    currency = str(os.getenv("SUMUP_CURRENCY") or DEFAULT_SUMUP_CURRENCY).strip().upper() or DEFAULT_SUMUP_CURRENCY
    timeout_seconds = _parse_timeout(str(os.getenv("SUMUP_TIMEOUT_SECONDS") or ""))
    reader_id = str(os.getenv("SUMUP_READER_ID") or "").strip()
    webhook_secret = str(os.getenv("SUMUP_WEBHOOK_SECRET") or "").strip()
    allowed_username = str(os.getenv("SUMUP_ALLOWED_USERNAME") or DEFAULT_SUMUP_ALLOWED_USERNAME).strip().lower() or DEFAULT_SUMUP_ALLOWED_USERNAME
    return SumupSettings(
        enabled=enabled,
        api_key=api_key,
        base_url=base_url or DEFAULT_SUMUP_BASE_URL,
        merchant_code=merchant_code,
        currency=currency,
        timeout_seconds=timeout_seconds,
        reader_id=reader_id,
        webhook_secret=webhook_secret,
        allowed_username=allowed_username,
    )
