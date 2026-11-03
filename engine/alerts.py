"""Email alerts through Gmail. Address and app password come from environment variables (GitHub secrets)."""
import os
import smtplib
import sys
from email.message import EmailMessage


def send(subject, body):
    user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_APP_PASSWORD")
    to = os.environ.get("ALERT_TO") or user
    if not user or not password:
        print(f"Email not configured, would send: {subject}")
        return False
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, to
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(user, password)
        s.send_message(msg)
    print(f"Email sent: {subject}")
    return True


if __name__ == "__main__":
    page = os.environ.get("PAGE_URL", "")
    if sys.argv[1:] == ["failure"]:
        ok = send("FinancialDream: signal update FAILED",
                  "The weekly signal did not update, so the page may be out of date.\n"
                  "Check the failed run in the GitHub Actions tab of the repo.\n\n" + page)
    elif sys.argv[1:] == ["test"]:
        ok = send("FinancialDream: test alert", "Email alerts are working.\n\n" + page)
    else:
        sys.exit("usage: alerts.py failure|test")
    sys.exit(0 if ok else 1)
