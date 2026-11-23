"""Экспортировать только публичные правила. Запуск из venv backend, без БД."""

import argparse
import json
from pathlib import Path

from poidem.services.content_policy import public_policy

TARGET = Path(__file__).resolve().parents[1] / "frontend/src/config/contentPolicy.generated.json"


def serialized_policy() -> str:
    return json.dumps(public_policy(), ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    expected = serialized_policy()
    if options.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != expected:
            raise SystemExit("Клиентский фильтр устарел: запусти scripts/export_content_policy.py")
        print("Клиентская политика совпадает с backend")
    else:
        TARGET.write_text(expected, encoding="utf-8")
        print("Публичная политика frontend обновлена")


if __name__ == "__main__":
    main()
