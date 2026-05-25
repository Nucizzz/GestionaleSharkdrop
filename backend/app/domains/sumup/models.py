from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


CASH_SALE_STATUSES = {
    "draft",
    "ready",
    "sumup_payment_created",
    "payment_pending",
    "paid",
    "failed",
    "cancelled",
    "expired",
    "inventory_committed",
    "inventory_commit_failed",
}


class CashRegisterScanRequest(BaseModel):
    barcode: str = ""
    sku: str = ""
    location_id: Optional[str] = None

    @property
    def code(self) -> str:
        return str(self.barcode or self.sku or "").strip()


class CashRegisterSaleItemInput(BaseModel):
    product_id: Optional[str] = None
    variant_id: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    quantity: int = 1
    unit_price: Optional[float] = None

    @field_validator("quantity")
    @classmethod
    def _validate_quantity(cls, value: int) -> int:
        qty = int(value or 0)
        if qty <= 0:
            raise ValueError("quantity must be > 0")
        if qty > 999:
            raise ValueError("quantity too high")
        return qty


class CashRegisterSaleCreateRequest(BaseModel):
    location_id: str
    items: List[CashRegisterSaleItemInput]
    note: Optional[str] = None


class CashRegisterSaleUpdatePriceRequest(BaseModel):
    items: List[CashRegisterSaleItemInput] = Field(default_factory=list)


class CashRegisterSaleCancelRequest(BaseModel):
    reason: Optional[str] = None


class SumupSendResponse(BaseModel):
    sale_id: str
    status: str
    checkout_id: Optional[str] = None
    sumup_status: Optional[str] = None


class SumupWebhookPayload(BaseModel):
    payload: Dict[str, Any] = Field(default_factory=dict)


class CashRegisterSaleDoc(BaseModel):
    id: str
    user_id: str
    username: str
    location_id: str
    location_name: Optional[str] = None
    items: List[Dict[str, Any]] = Field(default_factory=list)
    subtotal: float = 0.0
    discounts_total: float = 0.0
    total_amount: float = 0.0
    currency: str = "EUR"
    status: str = "draft"
    sumup_checkout_id: Optional[str] = None
    sumup_transaction_id: Optional[str] = None
    sumup_status: Optional[str] = None
    paid_at: Optional[datetime] = None
    inventory_committed_at: Optional[datetime] = None
    inventory_commit_tx_ids: List[str] = Field(default_factory=list)
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SumupStatusResponse(BaseModel):
    enabled: bool
    configured: bool
    reader_configured: bool
    base_url: str
    merchant_code_present: bool
    terminal_present: bool
    reader_present: bool
    currency: str
    allowed_username: str
