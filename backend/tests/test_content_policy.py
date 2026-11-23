import json
from pathlib import Path

import pytest

from poidem.services.content_policy import public_policy
from poidem.services.plan_content import content_errors

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads(
    (Path(__file__).parent / "fixtures/content_cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["text"])
def test_shared_browser_and_server_examples(case):
    assert (not content_errors(description=case["text"])) == case["allowed"], case["text"]


def test_frontend_policy_is_generated_from_current_backend():
    path = ROOT / "frontend/src/config/contentPolicy.generated.json"
    assert json.loads(path.read_text(encoding="utf-8")) == public_policy(), (
        "Клиентские правила устарели: запусти scripts/export_content_policy.py"
    )
