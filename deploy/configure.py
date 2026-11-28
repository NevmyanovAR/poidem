"""Production env: hidden input, no overwrite, validation without printing values."""

import argparse
import getpass
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = Path(os.environ.get("POIDEM_PRODUCTION_ENV", ROOT / "deploy" / "production.env")).resolve()


def read_env(path=None):
    path = path or ENV
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        key, value = raw.split("=", 1)
        value = value.strip()
        if value.startswith('"'):
            value = json.loads(value)
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        if key in values:
            raise ValueError("Duplicate env key")
        values[key.strip()] = value
    return values


def domain(value):
    if (
        len(value) > 253
        or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", value)
        or value.endswith((".invalid", ".localhost", ".test", ".example"))
        or value in {"example.com", "example.org", "example.net"}
    ):
        raise ValueError("Set a real ASCII domain (punycode for IDN)")
    return value


def validate(values):
    if not re.fullmatch(
        r"poidem[-a-z0-9]*", values.get("COMPOSE_PROJECT_NAME", "poidem-production")
    ):
        raise ValueError("Use an explicit poidem Compose project")
    name = domain(values.get("APP_DOMAIN", ""))
    origin = "https://" + name
    if values.get("MINI_APP_URL") != origin or values.get("API_PUBLIC_URL") != origin + "/api/v1":
        raise ValueError("Production URLs must use the configured HTTPS origin")
    if json.loads(values.get("CORS_ORIGINS", "[]")) != [origin]:
        raise ValueError("Set the exact HTTPS origin")
    if json.loads(values.get("TRUSTED_HOSTS", "[]")) != [name]:
        raise ValueError("Set the exact public hostname")
    passwords = [
        values.get(key, "")
        for key in ("POSTGRES_PASSWORD", "POSTGRES_APP_PASSWORD", "POSTGRES_MIGRATION_PASSWORD")
    ]
    if len(set(passwords)) != 3 or any(not re.fullmatch(r"[a-f0-9]{64}", p) for p in passwords):
        raise ValueError("Three independent 64-character hexadecimal passwords are required")
    if not re.fullmatch(r"\d{5,15}:[A-Za-z0-9_-]{30,100}", values.get("TELEGRAM_BOT_TOKEN", "")):
        raise ValueError("Set the bot token with hidden input")
    if not re.fullmatch(r"[A-Za-z0-9_]{5,32}", values.get("TELEGRAM_BOT_USERNAME", "")):
        raise ValueError("Invalid bot username")
    if not re.fullmatch(r"[a-f0-9]{12,40}", values.get("RELEASE_TAG", "")):
        raise ValueError("RELEASE_TAG must identify a committed Git revision")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values.get("ACME_EMAIL", "")):
        raise ValueError("Set the certificate renewal email")
    for key in ("PHOTO_VERIFICATION_ENABLED", "PHOTO_VERIFICATION_POLICY_APPROVED"):
        if values.get(key) not in {"true", "false"}:
            raise ValueError("Set explicit photo verification flags")
    if values["PHOTO_VERIFICATION_ENABLED"] == "true":
        if (
            values["PHOTO_VERIFICATION_POLICY_APPROVED"] != "true"
            or not values.get("PHOTO_VERIFICATION_CONSENT_VERSION", "").strip()
            or not values.get("PHOTO_VERIFICATION_CONSENT_TEXT", "").strip()
        ):
            raise ValueError("Explicitly approved production consent is required")
        pending = int(values.get("PHOTO_VERIFICATION_PENDING_HOURS", ""))
        reviewed = int(values.get("PHOTO_VERIFICATION_REVIEWED_RETENTION_HOURS", ""))
        if not 1 <= pending <= 336 or not 0 <= reviewed <= 168:
            raise ValueError("Set approved retention values within the existing technical bounds")
    if values.get("POSITIVE_IMPRESSIONS_THRESHOLD", "3") != "3":
        raise ValueError("Keep the approved reputation threshold")
    if values.get("SESSION_COOKIE_SAMESITE", "none") not in {"none", "lax"}:
        raise ValueError("Use Secure cookies with SameSite none or lax")
    if os.name != "nt" and ENV.exists() and ENV.stat().st_mode & 0o077:
        raise ValueError("production.env must have mode 600")


def main():
    parser = argparse.ArgumentParser(
        description="Production configuration; secrets are never printed"
    )
    sub = parser.add_subparsers(dest="action", required=True)
    init = sub.add_parser("init")
    init.add_argument("--domain", required=True)
    init.add_argument("--email", required=True)
    init.add_argument("--bot-username", default="ShallWeGoo_bot")
    sub.add_parser("check")
    value = sub.add_parser("public-value")
    value.add_argument(
        "key", choices=["APP_DOMAIN", "ACME_EMAIL", "RELEASE_TAG", "COMPOSE_PROJECT_NAME"]
    )
    release = sub.add_parser("set-release")
    release.add_argument("revision")
    project = sub.add_parser("set-project")
    project.add_argument("project")
    args = parser.parse_args()
    if args.action == "init":
        if ENV.exists():
            raise ValueError("production.env already exists; it will not be overwritten")
        if not sys.stdin.isatty():
            raise ValueError("Interactive terminal required for hidden token input")
        name = domain(args.domain)
        revision = subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"], cwd=ROOT, text=True
        ).strip()
        values = read_env(ROOT / "deploy" / "production.env.example")
        values.update(
            APP_DOMAIN=name,
            ACME_EMAIL=args.email,
            RELEASE_TAG=revision,
            TELEGRAM_BOT_USERNAME=args.bot_username,
            TELEGRAM_BOT_TOKEN=getpass.getpass("Telegram token (hidden): ").strip(),
            MINI_APP_URL="https://" + name,
            API_PUBLIC_URL="https://" + name + "/api/v1",
            CORS_ORIGINS=json.dumps(["https://" + name]),
            TRUSTED_HOSTS=json.dumps([name]),
        )
        for key in ("POSTGRES_PASSWORD", "POSTGRES_APP_PASSWORD", "POSTGRES_MIGRATION_PASSWORD"):
            values[key] = secrets.token_hex(32)
        validate(values)
        os.umask(0o077)
        with ENV.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
        print("Production env created; no secrets printed")
    elif args.action == "public-value":
        values = read_env()
        print(
            values.get(args.key, "poidem-production")
            if args.key == "COMPOSE_PROJECT_NAME"
            else values[args.key]
        )
    elif args.action in {"set-release", "set-project"}:
        values = read_env()
        if args.action == "set-release":
            if not re.fullmatch(r"[a-f0-9]{12,40}", args.revision):
                raise ValueError("Use a hexadecimal commit revision")
            values["RELEASE_TAG"] = args.revision
        else:
            values["COMPOSE_PROJECT_NAME"] = args.project
        validate(values)
        # Preserve all other values; replacement is atomic on the same filesystem.
        target = ENV.with_suffix(".env.tmp")
        os.umask(0o077)
        with target.open("x", encoding="utf-8", newline="\n") as stream:
            for key, item in values.items():
                item = (
                    json.dumps(item, ensure_ascii=False)
                    if any(c in item for c in "#\n'\"") and not item.startswith("[")
                    else item
                )
                stream.write(f"{key}={item}\n")
        target.replace(ENV)
        print("Configuration selection updated; passwords and token preserved")
    else:
        validate(read_env())
        print("Production configuration valid (values redacted)")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError):
        raise SystemExit(
            "Production configuration invalid; check the template, paths and permissions"
        ) from None
