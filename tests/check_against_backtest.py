"""Local check, needs the FinancialDream research folder: the page's model must match the backtest."""
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "engine"), os.environ.get("MARKET_MODEL_DIR", os.path.join(HERE, "..", "..", "FinancialDream", "market_model"))]
import model
from v3_final import IDX, LVL, plan

levels = pd.DataFrame(LVL).dropna(how="all")
h_new, st_new = model.daily_state(levels)
h_bt, w_bt = plan("LEADER")
last = st_new.groupby(st_new.index.to_period("W-FRI")).tail(1).index
wk = st_new.reindex(IDX).where(IDX.isin(last)).ffill().shift(2).fillna(0.0)
a = "2001-01-01"
print("weekly invested mismatches:", int((wk.loc[a:] != w_bt.loc[a:]).sum()), "of", len(w_bt.loc[a:]))
print("leader mismatches:", int((h_new.reindex(IDX).loc[a:] != h_bt.loc[a:]).sum()))
s = model.compute(levels, pd.Timestamp("2026-11-03"))
print({k: s[k] for k in ["signal_date", "leader", "invested", "target", "level", "average"]})
print("changes:", s["changes"])
print("6 years of data gives the same answer:", model.compute(levels.iloc[-1500:], pd.Timestamp("2026-11-03"))["target"] == s["target"])
