"""Model v3 "LEADER": the same rule as FinancialDream/live/mt5_trader.py and market_model/v3_final.py.

Level = USD adjusted close x USD/BRL, for QQQ and SMH.
Leader: on the first trading day of Jan/Apr/Jul/Oct, the higher 2-year (504-day) level return.
Trend:  in above average*(1+4%), out below average*(1-4%), otherwise unchanged (200-day average).
Read once a week, at the last completed week's final close.
"""
import pandas as pd

MA_DAYS, BUFFER, LOOKBACK, REVIEW_MONTHS = 200, 0.04, 504, (1, 4, 7, 10)
TICKER = {"QQQ": "NASD11", "SMH": "CHIP11"}


def trend_state(level):
    """1 above avg*(1+buffer), 0 below avg*(1-buffer), otherwise keep the previous state."""
    ma = level.rolling(MA_DAYS).mean()
    s = pd.Series(float("nan"), index=level.index)
    s[level > ma * (1 + BUFFER)] = 1.0
    s[level < ma * (1 - BUFFER)] = 0.0
    return s.ffill().fillna(0.0)


def leader_series(levels):
    """Asset chosen at each quarterly review. Backtest timing: effective two days after the review."""
    mom = levels / levels.shift(LOOKBACK) - 1
    per = pd.Series(levels.index.to_period("M"), index=levels.index)
    first = (~per.duplicated()) & levels.index.month.isin(REVIEW_MONTHS)
    h = pd.Series(index=levels.index, dtype=object)
    for d in levels.index[first]:
        m = mom.loc[d].dropna()
        if len(m):
            h.loc[d] = m.idxmax()
    return h.ffill().shift(2).fillna("QQQ")


def daily_state(levels):
    """Daily (leader, invested) before the weekly read."""
    h = leader_series(levels)
    st = pd.Series(0.0, index=levels.index)
    for t in levels.columns:
        on = trend_state(levels[t].dropna()).reindex(levels.index).ffill().fillna(0.0)
        st[h == t] = on[h == t]
    return h, st


def last_week_close(index, today):
    """Mon->3d back, Sat->1d, Sun->2d; on a Friday the session isn't complete -> previous Friday."""
    last_fri = today - pd.Timedelta(days=((today.weekday() - 4) % 7) or 7)
    return index[index <= last_fri][-1]


def weekly_targets(levels):
    """Fund to hold (or None) as decided at each week's final close."""
    h, st = daily_state(levels)
    last = st.groupby(st.index.to_period("W-FRI")).tail(1).index
    return pd.Series([TICKER[h.loc[d]] if st.loc[d] > 0 else None for d in last], index=last, dtype=object)


def compute(levels, today):
    """Signal for `today` from a DataFrame of BRL levels with QQQ and SMH columns."""
    h, st = daily_state(levels)
    d = last_week_close(levels.index, today)
    leader = h.loc[d]
    level = float(levels[leader].loc[d])
    ma = float(levels[leader].rolling(MA_DAYS).mean().loc[d])
    invested = bool(st.loc[d] > 0)
    wk = weekly_targets(levels)
    wk = wk[wk.index <= d]
    changed = wk[wk.ne(wk.shift()) | (wk.isna() != wk.shift().isna())].iloc[1:]
    start = d - pd.DateOffset(years=3)
    changes = [dict(date=str(k.date()), target=v) for k, v in changed.items() if k >= start]
    return dict(signal_date=str(d.date()), leader=leader, leader_fund=TICKER[leader], invested=invested,
                target=TICKER[leader] if invested else None, level=round(level, 2), average=round(ma, 2),
                enter_above=round(ma * (1 + BUFFER), 2), exit_below=round(ma * (1 - BUFFER), 2), changes=changes)
