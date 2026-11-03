"""Run with: python tests/test_alerts.py. Uses a fake mail server, so nothing is sent."""
import os
import smtplib
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
import alerts


class FakeSMTP:
    sent, fail = [], set()

    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, u, p): pass

    def send_message(self, msg):
        if msg["To"] in FakeSMTP.fail:
            raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"no")})
        FakeSMTP.sent.append(msg)


smtplib.SMTP_SSL = FakeSMTP
os.environ.update(SMTP_USER="me@example.com", SMTP_APP_PASSWORD="x")

os.environ["ALERT_TO"] = "a@example.com, b@example.com;c@example.com,"
assert alerts.send("s", "b") is True
assert [m["To"] for m in FakeSMTP.sent] == ["a@example.com", "b@example.com", "c@example.com"]
assert all("," not in m["To"] and m["Bcc"] is None for m in FakeSMTP.sent)
print("ok  three recipients, one email each, none sees the others")

FakeSMTP.sent.clear()
FakeSMTP.fail = {"a@example.com"}
try:
    alerts.send("s", "b")
    raise SystemExit("should have raised")
except RuntimeError:
    pass
assert [m["To"] for m in FakeSMTP.sent] == ["b@example.com", "c@example.com"]
print("ok  a bad address doesn't block the others, and the run is reported as failed")

FakeSMTP.sent.clear()
FakeSMTP.fail = set()
del os.environ["ALERT_TO"]
assert alerts.send("s", "b") is True and FakeSMTP.sent[0]["To"] == "me@example.com"
print("ok  no list falls back to the sender")
