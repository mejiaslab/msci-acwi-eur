#!/usr/bin/env python3
"""
Actualizador de datos históricos e intradía para MSCI ACWI en Euros (EUR).

Fuentes combinadas:
1. Índice oficial MSCI ACWI (código 892400) en EUR vía endpoint público de MSCI:
   - Price Return (STRD): diario oficial desde el 31/12/1998 (base 100,00).
   - Net Total Return (NETR, dividendos netos reinvertidos): diario oficial desde el 29/12/2000.
   - Empalme 1999–2000 para Total Return: construido sobre el Price Return diario oficial en EUR
     (31/12/1998 – 29/12/2000) añadiendo el devengo diario de dividendos netos implícito en el
     propio índice MSCI ACWI EUR Gross Total Return (GRTR) frente a STRD en ese bienio
     ajustado por la tasa de retención fiscal neta/bruta observada en MSCI ACWI (0,7784).
2. Proxy ETF iShares MSCI ACWI UCITS ETF EUR (Acc) - Ticker XETRA: IUSQ.DE:
   - Proporciona la curva intradía (intervalos de 5m/15m) para la vista de "Último día" (1D).
   - Actúa como respaldo automático (fallback) vía Yahoo Finance / Stooq para añadir nuevos
     cierres diarios en EUR si en alguna sesión el cierre del ETF está disponible antes que el
     de MSCI o si el servicio de MSCI no respondiese temporalmente.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT_DIR / "data" / "msci_acwi_eur.json"

MSCI_CODE = "892400"  # MSCI ACWI
ETF_TICKER = "IUSQ.DE"
ETF_NAME = "iShares MSCI ACWI UCITS ETF EUR (Acc)"
ETF_ISIN = "IE00B6R52259"

USER_AGENT = "Mozilla/5.0"


def fetch_text(url: str, retries: int = 3, timeout: int = 25) -> str:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json,text/csv,text/plain,*/*",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code == 429 and attempt < retries - 1:
                time.sleep(2.5 * (attempt + 1))
                continue
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Error al consultar {url}: {last_err}") from last_err


def fetch_json(url: str, retries: int = 3, timeout: int = 25) -> dict[str, Any]:
    return json.loads(fetch_text(url, retries=retries, timeout=timeout))


def fetch_yahoo_json_multi(path_and_query: str) -> dict[str, Any]:
    """Prueba primero query2 y luego query1 de Yahoo Finance para mitigar límites 429."""
    hosts = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]
    last_err: Exception | None = None
    for host in hosts:
        try:
            return fetch_json(f"{host}{path_and_query}", retries=2, timeout=20)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(1.0)
    raise RuntimeError(f"Yahoo Finance no disponible ({last_err})")


def int_date_to_iso(d_int: int) -> str:
    s = str(d_int)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def fetch_msci_daily_eur(variant: str, start_year: int, end_year: int) -> dict[str, float]:
    """Descarga niveles diarios EOD de MSCI ACWI en EUR en bloques de 10 años."""
    levels: dict[str, float] = {}
    today_str = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")

    for y in range(start_year, end_year + 1, 10):
        s_date = "19981231" if y == 1998 else f"{y}0101"
        e_year = min(y + 9, end_year)
        e_date = today_str if e_year == end_year else f"{e_year}1231"
        if s_date > e_date:
            continue

        url = (
            "https://app2.msci.com/products/service/index/indexmaster/getLevelDataForGraph"
            f"?currency_symbol=EUR&index_variant={variant}"
            f"&start_date={s_date}&end_date={e_date}"
            f"&data_frequency=DAILY&base_currency=EUR&index_codes={MSCI_CODE}"
        )
        data = fetch_json(url)
        rows = data.get("indexes", {}).get("INDEX_LEVELS", [])
        for row in rows:
            calc_date = row.get("calc_date")
            val = row.get("level_eod")
            if calc_date and val is not None and val > 0:
                levels[int_date_to_iso(int(calc_date))] = float(val)

    return levels


def fetch_etf_daily_with_fallback(ticker: str = ETF_TICKER) -> tuple[dict[str, float], dict[str, Any]]:
    """Obtiene el histórico diario en EUR y metadatos recientes del ETF proxy (Yahoo + Stooq)."""
    try:
        data = fetch_yahoo_json_multi(f"/v8/finance/chart/{ticker}?range=2y&interval=1d")
        result = data["chart"]["result"][0]
        meta = result.get("meta", {})
        timestamps = result.get("timestamp", []) or []
        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", []) or []

        daily: dict[str, float] = {}
        for ts, close in zip(timestamps, closes):
            if close is not None and close > 0:
                d_iso = dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d")
                daily[d_iso] = float(close)

        reg_time = meta.get("regularMarketTime")
        reg_price = meta.get("regularMarketPrice")
        if reg_time and reg_price and reg_price > 0:
            reg_iso = dt.datetime.fromtimestamp(int(reg_time), dt.timezone.utc).strftime("%Y-%m-%d")
            daily[reg_iso] = float(reg_price)

        sorted_d = sorted(daily.keys())
        prev_close_val = daily[sorted_d[-2]] if len(sorted_d) >= 2 else meta.get("chartPreviousClose")
        etf_info = {
            "ticker": ticker,
            "name": ETF_NAME,
            "isin": ETF_ISIN,
            "currency": meta.get("currency", "EUR"),
            "exchange": meta.get("fullExchangeName", "XETRA"),
            "lastPrice": round(float(reg_price), 4) if reg_price else None,
            "prevClose": round(float(prev_close_val), 4) if prev_close_val else None,
            "lastTime": dt.datetime.fromtimestamp(int(reg_time), dt.timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            if reg_time
            else None,
        }
        return daily, etf_info
    except Exception as yahoo_err:  # noqa: BLE001
        # Respaldo mediante CSV diario gratuito de Stooq (iusq.de)
        stooq_url = "https://stooq.com/q/d/l/?s=iusq.de&i=d"
        raw_csv = fetch_text(stooq_url, retries=2, timeout=20)
        reader = csv.DictReader(io.StringIO(raw_csv))
        daily = {}
        for row in reader:
            d_iso = row.get("Date") or ""
            c_str = row.get("Close") or ""
            try:
                c_val = float(c_str)
                if len(d_iso) == 10 and c_val > 0:
                    daily[d_iso] = c_val
            except ValueError:
                continue
        if not daily:
            raise RuntimeError(f"Yahoo ({yahoo_err}) y Stooq sin datos") from yahoo_err
        sorted_d = sorted(daily.keys())
        last_d = sorted_d[-1]
        prev_d = sorted_d[-2] if len(sorted_d) >= 2 else last_d
        etf_info = {
            "ticker": ticker,
            "name": ETF_NAME,
            "isin": ETF_ISIN,
            "currency": "EUR",
            "exchange": "XETRA (Stooq)",
            "lastPrice": round(daily[last_d], 4),
            "prevClose": round(daily[prev_d], 4),
            "lastTime": f"{last_d}T16:30:00Z",
        }
        return daily, etf_info


def fetch_yahoo_etf_intraday(ticker: str = ETF_TICKER) -> dict[str, Any] | None:
    """Obtiene las barras intradía de 15 minutos de la última sesión en XETRA (EUR)."""
    data = fetch_yahoo_json_multi(f"/v8/finance/chart/{ticker}?range=5d&interval=15m")
    result = data["chart"]["result"][0]
    timestamps = result.get("timestamp", []) or []
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", []) or []

    by_day: dict[str, list[tuple[str, float]]] = {}
    for ts, close in zip(timestamps, closes):
        if close is None or close <= 0:
            continue
        dt_utc = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
        day_key = dt_utc.strftime("%Y-%m-%d")
        iso_ts = dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        by_day.setdefault(day_key, []).append((iso_ts, round(float(close), 4)))

    if not by_day:
        return None

    sorted_days = sorted(by_day.keys())
    last_day = sorted_days[-1]
    prev_day_close: float | None = None
    if len(sorted_days) >= 2:
        prev_day_close = by_day[sorted_days[-2]][-1][1]

    pts = by_day[last_day]
    if prev_day_close is None and pts:
        prev_day_close = pts[0][1]

    return {
        "date": last_day,
        "ticker": ticker,
        "prevClose": prev_day_close,
        "timestamps": [p[0] for p in pts],
        "prices": [p[1] for p in pts],
    }


def load_existing_data() -> dict[str, Any] | None:
    if not DATA_FILE.exists():
        return None
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] No se pudo leer el JSON previo: {exc}", file=sys.stderr)
        return None


def lists_approx_equal(a: list[float] | None, b: list[float] | None, tol: float = 5e-4) -> bool:
    if a is None or b is None or len(a) != len(b):
        return False
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def build_combined_series(
    existing: dict[str, Any] | None,
) -> tuple[list[str], list[float], list[float], dict[str, Any], dict[str, Any] | None]:
    now_utc = dt.datetime.now(dt.timezone.utc)
    current_year = now_utc.year

    tr_map: dict[str, float] = {}
    pr_map: dict[str, float] = {}
    if existing and "dates" in existing and "tr" in existing and "pr" in existing:
        for d_iso, tr_v, pr_v in zip(existing["dates"], existing["tr"], existing["pr"]):
            tr_map[d_iso] = float(tr_v)
            pr_map[d_iso] = float(pr_v)

    existing_meta = existing.get("meta", {}) if existing else {}
    splice_tr_exact = existing_meta.get("spliceTr20001229")

    msci_ok = False
    try:
        need_full = (
            len(tr_map) < 6000
            or "1998-12-31" not in pr_map
            or splice_tr_exact is None
        )
        start_y_pr = 1998 if need_full else max(2020, current_year - 2)
        start_y_tr = 2000 if need_full else max(2020, current_year - 2)

        strd_raw = fetch_msci_daily_eur("STRD", start_y_pr, current_year)
        netr_raw = fetch_msci_daily_eur("NETR", start_y_tr, current_year)

        if need_full:
            grtr_anchor = fetch_msci_daily_eur("GRTR", 2000, 2003)
            splice_date = "2000-12-29"
            if splice_date not in strd_raw or splice_date not in netr_raw:
                raise RuntimeError("Falta la fecha de enlace 2000-12-29 en MSCI.")

            grtr_2000 = grtr_anchor.get(splice_date, 136.50845401152893)
            strd_2000 = strd_raw[splice_date]
            gross_div_factor_99_00 = grtr_2000 / strd_2000

            ref_end = "2003-12-31"
            if ref_end in grtr_anchor and ref_end in netr_raw and ref_end in strd_raw:
                g_div = (grtr_anchor[ref_end] / grtr_2000) / (strd_raw[ref_end] / strd_2000) - 1.0
                n_div = (netr_raw[ref_end] / netr_raw[splice_date]) / (
                    strd_raw[ref_end] / strd_2000
                ) - 1.0
                net_retention = n_div / g_div if g_div > 0 else 0.7784
            else:
                net_retention = 0.7784

            net_div_factor_99_00 = 1.0 + (gross_div_factor_99_00 - 1.0) * net_retention

            pre_dates = sorted(d for d in strd_raw if d <= splice_date)
            n_pre = len(pre_dates) - 1
            daily_net_div_mult = net_div_factor_99_00 ** (1.0 / max(n_pre, 1))

            base_strd_0 = strd_raw[pre_dates[0]]
            for idx, d_iso in enumerate(pre_dates):
                pr_val = 100.0 * (strd_raw[d_iso] / base_strd_0)
                tr_val = pr_val * (daily_net_div_mult**idx)
                pr_map[d_iso] = pr_val
                tr_map[d_iso] = tr_val

            splice_tr_exact = float(tr_map[splice_date])
            netr_at_splice = netr_raw[splice_date]

            for d_iso in sorted(d for d in strd_raw if d > splice_date):
                pr_map[d_iso] = 100.0 * (strd_raw[d_iso] / base_strd_0)
            for d_iso in sorted(d for d in netr_raw if d > splice_date):
                tr_map[d_iso] = splice_tr_exact * (netr_raw[d_iso] / netr_at_splice)
        else:
            # En MSCI EUR: STRD ya viene en base 100,00 (31/12/1998) y NETR en base 100,00 (29/12/2000)
            scale_tr = float(splice_tr_exact) / 100.0
            for d_iso, val in strd_raw.items():
                pr_map[d_iso] = val
            for d_iso, val in netr_raw.items():
                tr_map[d_iso] = val * scale_tr

        msci_ok = True
        print(f"[OK] MSCI ACWI EUR actualizado ({len(tr_map)} sesiones hasta {max(tr_map)}).")
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] Falló consulta a MSCI ({exc}); usando respaldo ETF.", file=sys.stderr)

    etf_info: dict[str, Any] = existing_meta.get("etfProxy", {})
    intraday_1d: dict[str, Any] | None = existing.get("intraday1d") if existing else None

    try:
        etf_daily, etf_info = fetch_etf_daily_with_fallback(ETF_TICKER)
        if tr_map and etf_daily:
            last_index_date = max(d for d in tr_map if d in pr_map)
            newer_etf_dates = sorted(d for d in etf_daily if d > last_index_date)
            if newer_etf_dates:
                common_etf = sorted(d for d in etf_daily if d <= last_index_date and d in tr_map)
                if common_etf:
                    ref_d = common_etf[-1]
                    ref_etf = etf_daily[ref_d]
                    ref_tr = tr_map[ref_d]
                    ref_pr = pr_map[ref_d]
                    daily_div_drag = (1.0 - 0.018) ** (1.0 / 252.0)
                    for idx, nd in enumerate(newer_etf_dates, start=1):
                        ratio = etf_daily[nd] / ref_etf
                        tr_map[nd] = ref_tr * ratio
                        pr_map[nd] = ref_pr * ratio * (daily_div_drag**idx)
                    print(
                        f"[OK] Añadidas {len(newer_etf_dates)} sesiones recientes vía ETF {ETF_TICKER}: {newer_etf_dates}"
                    )
        print(f"[OK] ETF proxy {ETF_TICKER} consultado (último precio: {etf_info.get('lastPrice')} EUR).")
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] No se pudo consultar diario de {ETF_TICKER}: {exc}", file=sys.stderr)

    try:
        fresh_intraday = fetch_yahoo_etf_intraday(ETF_TICKER)
        if fresh_intraday and fresh_intraday.get("prices"):
            intraday_1d = fresh_intraday
            print(
                f"[OK] Intradía 15m ({intraday_1d['date']}) obtenido: {len(intraday_1d['prices'])} puntos."
            )
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] No se pudo consultar intradía de {ETF_TICKER}: {exc}", file=sys.stderr)

    common_dates = sorted(d for d in tr_map if d in pr_map)
    if not common_dates:
        raise RuntimeError("No se obtuvieron datos históricos válidos.")

    tr_list = [round(tr_map[d], 4) for d in common_dates]
    pr_list = [round(pr_map[d], 4) for d in common_dates]

    for i, (d_iso, tv, pv) in enumerate(zip(common_dates, tr_list, pr_list)):
        if not (math.isfinite(tv) and math.isfinite(pv) and tv > 0 and pv > 0):
            raise RuntimeError(f"Valor inválido detectado en {d_iso} (idx={i}): tr={tv}, pr={pv}")

    meta = {
        "indexName": "MSCI ACWI (EUR)",
        "indexCode": MSCI_CODE,
        "currency": "EUR",
        "baseDate": common_dates[0],
        "baseValue": 100.0,
        "spliceTr20001229": splice_tr_exact,
        "lastDate": common_dates[-1],
        "updatedAt": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalPoints": len(common_dates),
        "msciUpdated": msci_ok,
        "etfProxy": etf_info,
        "methodology": (
            "Serie base 100 (31/12/1998) en EUR. Total Return combina MSCI ACWI EUR Net Total Return "
            "oficial desde el 29/12/2000 con MSCI ACWI EUR Price Return + ajuste de dividendos netos "
            "oficiales del índice para 1999–2000, e intradía/respaldo diario mediante el ETF iShares "
            "MSCI ACWI UCITS ETF EUR Acc (IUSQ.DE)."
        ),
    }

    return common_dates, tr_list, pr_list, meta, intraday_1d


def main() -> int:
    existing = load_existing_data()
    dates, tr_list, pr_list, meta, intraday_1d = build_combined_series(existing)

    payload = {
        "meta": meta,
        "dates": dates,
        "tr": tr_list,
        "pr": pr_list,
        "intraday1d": intraday_1d,
    }

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if existing:
        same_series = (
            existing.get("dates") == dates
            and lists_approx_equal(existing.get("tr"), tr_list)
            and lists_approx_equal(existing.get("pr"), pr_list)
            and existing.get("intraday1d") == intraday_1d
            and existing.get("meta", {}).get("spliceTr20001229") is not None
        )
        if same_series:
            print("[INFO] Los datos ya están al día; sin cambios nuevos que guardar.")
            return 0

    DATA_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = DATA_FILE.stat().st_size / 1024.0
    print(
        f"[OK] Guardado {DATA_FILE} ({size_kb:.1f} KB) | "
        f"{dates[0]} -> {dates[-1]} ({len(dates)} días) | "
        f"TR final: {tr_list[-1]:.2f} | PR final: {pr_list[-1]:.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
