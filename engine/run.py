"""Writes docs/signal.json and emails when the instruction changes. Run by GitHub Actions."""
import datetime as dt
import json
import os
import sys
import time

import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alerts
import model

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PTAX_FILE = os.path.join(ROOT, "data", "ptax.csv")
SIGNAL_FILE = os.path.join(ROOT, "docs", "signal.json")
MAX_SIGNAL_AGE_DAYS = 10


def download_close(tickers, tries=4, **kwargs):
    """Close prices for every ticker, or an error. yfinance reports a failed ticker (for example its
    cache saying 'database is locked' when threads collide) only by leaving that column empty, so check."""
    for attempt in range(tries):
        px = yf.download(tickers, progress=False, threads=False, **kwargs)["Close"]
        missing = [t for t in tickers if t not in px.columns or px[t].dropna().empty]
        if not missing:
            return px
        print(f"No prices for {missing} (attempt {attempt + 1} of {tries})")
        if attempt < tries - 1:
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Could not download prices for {missing}.")


def fetch_ptax(start, end, tries=4):
    url = ("https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json"
           f"&dataInicial={start:%d/%m/%Y}&dataFinal={end:%d/%m/%Y}")
    for attempt in range(tries):
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            s = pd.DataFrame(r.json())
            s.index = pd.to_datetime(s["data"], dayfirst=True)
            return s["valor"].astype(float).sort_index()
        except (requests.RequestException, ValueError, KeyError):
            if attempt == tries - 1:
                raise
            time.sleep(10 * (attempt + 1))


def load_fx(today):
    """Stored official history plus recent PTAX. If the central bank is down, Yahoo fills recent days only,
    and only official rates are ever saved, so an outage cannot change the stored history."""
    stored = pd.read_csv(PTAX_FILE, index_col=0, parse_dates=True)["ptax"]
    start = stored.index[-1] - pd.Timedelta(days=7)
    try:
        fresh = fetch_ptax(start, today)
    except (requests.RequestException, ValueError, KeyError) as e:
        print(f"PTAX unavailable ({e}); using Yahoo BRL=X for recent days")
        y = yf.download("BRL=X", start=str((stored.index[-1] + pd.Timedelta(days=1)).date()),
                        auto_adjust=True, progress=False, threads=False)["Close"].squeeze()
        if isinstance(y, pd.Series) and len(y):
            y.index = pd.to_datetime(y.index).tz_localize(None)
        elif (today - stored.index[-1]).days > MAX_SIGNAL_AGE_DAYS:
            raise RuntimeError("No PTAX and no fallback exchange rate available.")
        else:
            y = pd.Series(dtype=float)
        return pd.concat([stored, y]).sort_index(), "fallback"
    merged = fresh.combine_first(stored).sort_index()
    merged.rename("ptax").to_csv(PTAX_FILE, index_label="date")
    return merged, "ptax"


def build(today):
    px = download_close(["QQQ", "SMH"], period="6y", auto_adjust=True)
    px.index = pd.to_datetime(px.index).tz_localize(None)
    fx, source = load_fx(today)
    usd = fx.reindex(px.index.union(fx.index)).ffill().reindex(px.index)
    levels = px.mul(usd, axis=0).dropna()
    sig = model.compute(levels, today)
    age = (today - pd.Timestamp(sig["signal_date"])).days
    if age > MAX_SIGNAL_AGE_DAYS:
        raise RuntimeError(f"Signal data is stale: last close used is {sig['signal_date']}.")

    funds = download_close(["NASD11.SA", "CHIP11.SA"], period="1mo", auto_adjust=False)
    prices = {}
    for t in funds.columns:
        s = funds[t].dropna()
        prices[t.replace(".SA", "")] = dict(close=round(float(s.iloc[-1]), 2), date=str(s.index[-1].date()))
    sig.update(prices=prices, fx_source=source,
               generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    return sig


def instruction(target):
    return f"Hold {target}" if target else "Stay out, in cash (CDI)"


def main():
    today = pd.Timestamp(dt.date.today())
    sig = build(today)
    previous = None
    if os.path.exists(SIGNAL_FILE):
        with open(SIGNAL_FILE, encoding="utf-8") as f:
            previous = json.load(f)
    os.makedirs(os.path.dirname(SIGNAL_FILE), exist_ok=True)
    tmp = SIGNAL_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sig, f, indent=2)
    os.replace(tmp, SIGNAL_FILE)
    print(json.dumps(sig, indent=2))
    if previous is not None and previous.get("target") != sig["target"]:
        alerts.send(f"FinancialDream: action needed - {instruction(sig['target'])}",
                    f"The signal changed at the {sig['signal_date']} close.\n\n"
                    f"Before: {instruction(previous.get('target'))}\nNow: {instruction(sig['target'])}\n\n"
                    "Open the page for the exact order:\n" + os.environ.get("PAGE_URL", ""))


if __name__ == "__main__":
    main()
