from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict

import httpx

from app.domains.sumup.config import SumupSettings


class SumupConfigError(RuntimeError):
    pass


class SumupClientError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502, retriable: bool = False):
        super().__init__(message)
        self.status_code = int(status_code)
        self.retriable = bool(retriable)


class SumupClient:
    def __init__(self, settings: SumupSettings):
        self.settings = settings

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _reader_checkout_url(self) -> str:
        return (
            f"{self.settings.base_url}/v0.1/merchants/{self.settings.merchant_code}/readers/"
            f"{self.settings.reader_id}/checkout"
        )

    def _transactions_url(self) -> str:
        return f"{self.settings.base_url}/v2.1/merchants/{self.settings.merchant_code}/transactions"

    def _readers_url(self) -> str:
        return f"{self.settings.base_url}/v0.1/merchants/{self.settings.merchant_code}/readers"

    @staticmethod
    def _to_cents(amount: float) -> int:
        value = Decimal(str(amount or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        cents = int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))
        if cents <= 0:
            raise SumupClientError("Importo non valido per checkout SumUp", status_code=400, retriable=False)
        return cents

    async def create_reader_checkout(
        self,
        *,
        sale_id: str,
        amount: float,
        currency: str,
        description: str,
    ) -> Dict[str, Any]:
        if not self.settings.base_configured:
            raise SumupConfigError("SumUp non configurato")
        if not self.settings.reader_present:
            raise SumupConfigError("SUMUP_READER_ID mancante")
        currency_code = str(currency or self.settings.currency or "EUR").strip().upper() or "EUR"
        cents = self._to_cents(float(amount or 0))
        payload: Dict[str, Any] = {
            "total_amount": {
                "currency": currency_code,
                "minor_unit": 2,
                "value": cents,
            },
            # Idempotency/traceability reference for sale.
            "client_transaction_id": str(sale_id),
            # Harmless optional metadata, useful for POS operator view if accepted by API.
            "description": str(description or f"SharkDrop sale {sale_id}")[:256],
        }

        timeout = self.settings.timeout_seconds
        retries = 2
        last_error: SumupClientError | None = None
        for attempt in range(retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    response = await client.post(self._reader_checkout_url(), headers=self._headers(), json=payload)
                if response.status_code >= 500:
                    raise SumupClientError(
                        f"SumUp errore server HTTP {response.status_code}",
                        status_code=502,
                        retriable=True,
                    )
                if response.status_code >= 400:
                    detail = (response.text or "")[:400]
                    raise SumupClientError(
                        f"SumUp reader checkout fallito HTTP {response.status_code}: {detail}",
                        status_code=400,
                        retriable=False,
                    )
                return response.json()
            except httpx.TimeoutException:
                last_error = SumupClientError("Timeout SumUp", status_code=504, retriable=True)
            except httpx.HTTPError as exc:
                last_error = SumupClientError(f"Errore rete SumUp: {exc}", status_code=502, retriable=True)
            except SumupClientError as exc:
                if not exc.retriable:
                    raise
                last_error = exc
            if last_error and attempt < retries and last_error.retriable:
                continue
            if last_error:
                raise last_error
        raise SumupClientError("Errore SumUp sconosciuto", status_code=502, retriable=False)

    async def get_transaction_by_client_transaction_id(self, client_transaction_id: str) -> Dict[str, Any]:
        if not self.settings.base_configured:
            raise SumupConfigError("SumUp non configurato")
        cid = str(client_transaction_id or "").strip()
        if not cid:
            raise SumupClientError("client_transaction_id mancante", status_code=400)
        try:
            async with httpx.AsyncClient(timeout=self.settings.timeout_seconds, follow_redirects=True) as client:
                response = await client.get(
                    self._transactions_url(),
                    headers=self._headers(),
                    params={"client_transaction_id": cid},
                )
        except httpx.TimeoutException:
            raise SumupClientError("Timeout SumUp transaction status", status_code=504, retriable=True)
        except httpx.HTTPError as exc:
            raise SumupClientError(f"Errore rete SumUp: {exc}", status_code=502, retriable=True)

        if response.status_code >= 400:
            detail = (response.text or "")[:400]
            raise SumupClientError(
                f"SumUp transactions status fallito HTTP {response.status_code}: {detail}",
                status_code=400,
                retriable=False,
            )
        payload = response.json()
        if isinstance(payload, list):
            records = payload
        elif isinstance(payload, dict):
            raw_list = payload.get("items")
            if isinstance(raw_list, list):
                records = raw_list
            elif isinstance(payload.get("transactions"), list):
                records = payload.get("transactions") or []
            else:
                records = [payload]
        else:
            records = []

        if not records:
            raise SumupClientError(
                f"Nessuna transazione trovata per client_transaction_id={cid}",
                status_code=404,
                retriable=False,
            )
        first = records[0] if isinstance(records[0], dict) else {}
        first["client_transaction_id"] = first.get("client_transaction_id") or cid
        return first

    async def list_readers(self) -> list[Dict[str, Any]]:
        if not self.settings.base_configured:
            raise SumupConfigError("SumUp non configurato (API key/merchant code mancanti)")
        try:
            async with httpx.AsyncClient(timeout=self.settings.timeout_seconds, follow_redirects=True) as client:
                response = await client.get(self._readers_url(), headers=self._headers())
        except httpx.TimeoutException:
            raise SumupClientError("Timeout SumUp readers", status_code=504, retriable=True)
        except httpx.HTTPError as exc:
            raise SumupClientError(f"Errore rete SumUp: {exc}", status_code=502, retriable=True)

        if response.status_code >= 400:
            detail = (response.text or "")[:400]
            raise SumupClientError(
                f"SumUp readers fallito HTTP {response.status_code}: {detail}",
                status_code=400,
                retriable=False,
            )

        payload = response.json()
        if isinstance(payload, list):
            return [x for x in payload if isinstance(x, dict)]
        if isinstance(payload, dict):
            if isinstance(payload.get("items"), list):
                return [x for x in payload.get("items") if isinstance(x, dict)]
            if isinstance(payload.get("readers"), list):
                return [x for x in payload.get("readers") if isinstance(x, dict)]
            return [payload]
        return []
