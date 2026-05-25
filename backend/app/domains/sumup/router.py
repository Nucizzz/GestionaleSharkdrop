from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request

from app.core.deps import get_current_user
from app.domains.sumup.models import (
    CashRegisterSaleCancelRequest,
    CashRegisterSaleCreateRequest,
    CashRegisterScanRequest,
)
from app.domains.sumup import service

router = APIRouter()


@router.get("/sumup/status")
async def get_sumup_status_route(current_user: dict = Depends(get_current_user)):
    return await service.get_sumup_status(current_user)


@router.get("/sumup/readers")
async def get_sumup_readers_route(current_user: dict = Depends(get_current_user)):
    return await service.get_sumup_readers(current_user)


@router.post("/cash-register/scan")
async def scan_cash_register_item_route(data: CashRegisterScanRequest, current_user: dict = Depends(get_current_user)):
    return await service.scan_item(data, current_user)


@router.post("/cash-register/sales")
async def create_cash_register_sale_route(data: CashRegisterSaleCreateRequest, current_user: dict = Depends(get_current_user)):
    return await service.create_sale(data, current_user)


@router.post("/cash-register/sales/{sale_id}/send-to-sumup")
async def send_cash_register_sale_to_sumup_route(sale_id: str, current_user: dict = Depends(get_current_user)):
    return await service.send_sale_to_sumup(sale_id, current_user)


@router.get("/cash-register/sales/{sale_id}/status")
async def get_cash_register_sale_status_route(sale_id: str, current_user: dict = Depends(get_current_user)):
    return await service.get_sale_status(sale_id, current_user)


@router.post("/cash-register/sales/{sale_id}/cancel")
async def cancel_cash_register_sale_route(
    sale_id: str,
    data: Optional[CashRegisterSaleCancelRequest] = None,
    current_user: dict = Depends(get_current_user),
):
    return await service.cancel_sale(sale_id, current_user, reason=(data.reason if data else None))


@router.post("/sumup/webhook")
async def sumup_webhook_route(request: Request):
    payload = await request.json()
    return await service.handle_webhook(payload if isinstance(payload, dict) else {}, dict(request.headers or {}))
