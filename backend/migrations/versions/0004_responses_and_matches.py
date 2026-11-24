"""Одна пара на план, история повторных откликов, до 15 ожидающих."""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.scalar(
        sa.text(
            "SELECT count(*) FROM (SELECT plan_id FROM matches "
            "GROUP BY plan_id HAVING count(*) > 1) t"
        )
    ):
        raise RuntimeError(
            "Существуют несколько мэтчей на план; требуется отдельное решение, записи не удалены"
        )
    if bind.scalar(
        sa.text(
            "SELECT count(*) FROM (SELECT plan_id FROM plan_responses "
            "WHERE status='accepted' GROUP BY plan_id HAVING count(*) > 1) t"
        )
    ):
        raise RuntimeError("Существуют несколько принятых откликов на план; записи не изменены")
    op.create_unique_constraint("uq_matches_plan_id", "matches", ["plan_id"])
    op.drop_constraint("uq_plan_responses_plan_responder", "plan_responses", type_="unique")
    op.drop_constraint(op.f("ck_plan_responses_response_status"), "plan_responses", type_="check")
    op.create_check_constraint(
        op.f("ck_plan_responses_response_status"),
        "plan_responses",
        "status IN ('waiting','accepted','declined','closed')",
    )
    op.drop_constraint(
        op.f("ck_plan_responses_decision_by_author"), "plan_responses", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_plan_responses_decision_by_author"),
        "plan_responses",
        "(status = 'waiting' AND decision_actor_id IS NULL AND decided_at IS NULL) OR "
        "(status IN ('accepted','declined') AND decision_actor_id = plan_author_id "
        "AND decision_actor_id IS NOT NULL AND decided_at IS NOT NULL) OR "
        "(status = 'closed' AND decision_actor_id IS NULL AND decided_at IS NOT NULL)",
    )
    op.execute("UPDATE plan_responses SET slot_no=NULL WHERE status='declined'")
    op.create_check_constraint(
        op.f("ck_plan_responses_terminal_no_slot"),
        "plan_responses",
        "status NOT IN ('declined','closed') OR slot_no IS NULL",
    )
    op.create_index(
        "uq_plan_responses_active_person",
        "plan_responses",
        ["plan_id", "responder_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('waiting','accepted')"),
    )
    op.create_index(
        "uq_plan_responses_accepted_plan",
        "plan_responses",
        ["plan_id"],
        unique=True,
        postgresql_where=sa.text("status='accepted'"),
    )


def downgrade():
    bind = op.get_bind()
    if bind.scalar(
        sa.text("SELECT count(*) FROM plan_responses WHERE status='closed'")
    ) or bind.scalar(
        sa.text(
            "SELECT count(*) FROM (SELECT plan_id,responder_id FROM plan_responses "
            "GROUP BY plan_id,responder_id HAVING count(*)>1) t"
        )
    ):
        raise RuntimeError(
            "Откат удалил бы историю повторных/закрытых откликов; требуется отдельное решение"
        )
    op.drop_index("uq_plan_responses_accepted_plan", "plan_responses")
    op.drop_index("uq_plan_responses_active_person", "plan_responses")
    op.drop_constraint(op.f("ck_plan_responses_terminal_no_slot"), "plan_responses", type_="check")
    op.drop_constraint(
        op.f("ck_plan_responses_decision_by_author"), "plan_responses", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_plan_responses_decision_by_author"),
        "plan_responses",
        "(status='waiting' AND decision_actor_id IS NULL AND decided_at IS NULL) OR "
        "(status IN ('accepted','declined') AND decision_actor_id=plan_author_id "
        "AND decision_actor_id IS NOT NULL AND decided_at IS NOT NULL)",
    )
    op.drop_constraint(op.f("ck_plan_responses_response_status"), "plan_responses", type_="check")
    op.create_check_constraint(
        op.f("ck_plan_responses_response_status"),
        "plan_responses",
        "status IN ('waiting','accepted','declined')",
    )
    op.create_unique_constraint(
        "uq_plan_responses_plan_responder", "plan_responses", ["plan_id", "responder_id"]
    )
    op.drop_constraint("uq_matches_plan_id", "matches", type_="unique")
