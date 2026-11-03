# FinancialDream signal

A free page that says what to buy or sell under model v3 "LEADER", and how many shares your money covers. You place the orders yourself at your broker. Nothing here trades.

**Not investment advice.** This is one person's rule, tested on past data. It depends heavily on semiconductors, and falls of 25–35% are expected along the way.

- `engine/`: calculates the signal, runs on GitHub Actions on Saturday and Monday mornings
- `docs/`: the page, served by GitHub Pages. Amounts you enter stay in your browser
- `data/ptax.csv`: official USD/BRL history, so a central bank outage can't change past signals

## Setup
1. Create a **public** repo on GitHub called `financialdream-signals` and push this folder to it.
2. Under Settings → Pages, choose "Deploy from a branch", then `main` and `/docs`.
3. Under Settings → Actions → General → Workflow permissions, choose "Read and write".
4. Turn on 2-step verification on your Google account, then create an [app password](https://myaccount.google.com/apppasswords).
5. Under Settings → Secrets and variables → Actions, add:
   - `SMTP_USER`: your Gmail address
   - `SMTP_APP_PASSWORD`: the app password
   - `ALERT_TO`: where alerts go, with several addresses separated by commas (optional, defaults to `SMTP_USER`). Each person gets their own email. Keep the addresses in this secret, not in the code, because the repo is public
6. Under Actions → signal → Run workflow, run it with `test` set to:
   - `alert`: you should get a test email
   - `failure`: you should get a failure email
   - `none`: the normal update

## Local checks
```
node tests/test_logic.js
python tests/check_against_backtest.py   # needs the FinancialDream research folder
```

GitHub turns off scheduled runs after 60 days without repo activity. The Monday price refresh commits a change most weeks, which keeps it active. The page warns and hides the order if the signal is more than 10 days old.
