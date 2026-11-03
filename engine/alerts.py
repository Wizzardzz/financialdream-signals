"""Email alerts through Gmail. Address and app password come from environment variables (GitHub secrets)."""
import os
import smtplib
import sys
from email.message import EmailMessage


def send(subject, body):
    user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_APP_PASSWORD")
    if not user or not password:
        print(f"Email not configured, would send: {subject}")
        return False
    recipients = [a.strip() for a in (os.environ.get("ALERT_TO") or user).replace(";", ",").split(",") if a.strip()]
    sent = 0
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(user, password)
        for i, to in enumerate(recipients, 1):  # one email each, so nobody sees the other addresses
            msg = EmailMessage()
            msg["Subject"], msg["From"], msg["To"] = subject, user, to
            msg.set_content(body)
            try:
                s.send_message(msg)
                sent += 1
            except smtplib.SMTPException as e:  # one bad address must not stop the others
                print(f"Recipient {i} of {len(recipients)} failed: {type(e).__name__}")
    print(f"Email sent to {sent} of {len(recipients)} recipients: {subject}")
    if sent < len(recipients):
        raise RuntimeError("Not every alert recipient received the email.")
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
