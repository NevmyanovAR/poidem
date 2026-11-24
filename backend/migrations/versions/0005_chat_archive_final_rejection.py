"""Окончательный отказ, переписка пары и персональный архив (D50)."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    # D49 допускал несколько попыток. Их нельзя молча удалить ради нового UNIQUE.
    # Проверка выполняется до любого изменения и не выводит идентификаторы/тексты.
    if op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM (SELECT plan_id,responder_id FROM plan_responses "
            "GROUP BY plan_id,responder_id HAVING count(*)>1) t"
        )
    ):
        raise RuntimeError(
            "Найдена история повторных откликов D49. Миграция остановлена без изменений; "
            "необходимо отдельно согласовать перенос истории, не удаляйте записи"
        )
    for name in ("response_status", "decision_by_author", "terminal_no_slot"):
        op.drop_constraint(op.f(f"ck_plan_responses_{name}"), "plan_responses", type_="check")
    op.execute("UPDATE plan_responses SET status='rejected' WHERE status='declined'")
    op.create_check_constraint(
        op.f("ck_plan_responses_response_status"),
        "plan_responses",
        "status IN ('waiting','accepted','rejected','closed')",
    )
    op.create_check_constraint(
        op.f("ck_plan_responses_decision_by_author"),
        "plan_responses",
        "(status='waiting' AND decision_actor_id IS NULL AND decided_at IS NULL) OR "
        "(status IN ('accepted','rejected') AND decision_actor_id=plan_author_id "
        "AND decision_actor_id IS NOT NULL AND decided_at IS NOT NULL) OR "
        "(status='closed' AND decision_actor_id IS NULL AND decided_at IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_plan_responses_terminal_no_slot"),
        "plan_responses",
        "status NOT IN ('rejected','closed') OR slot_no IS NULL",
    )
    op.create_unique_constraint(
        "uq_plan_responses_plan_responder", "plan_responses", ["plan_id", "responder_id"]
    )
    op.add_column(
        "plans",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute("UPDATE plans SET updated_at=created_at")
    op.add_column("plans", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.create_index("ix_plans_archived_at", "plans", ["archived_at"])
    op.create_table(
        "chat_threads",
        sa.Column(
            "match_id",
            sa.Uuid(),
            sa.ForeignKey("matches.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("last_sequence", sa.BigInteger(), server_default="0", nullable=False),
        sa.CheckConstraint("last_sequence >= 0", name=op.f("ck_chat_threads_sequence_nonnegative")),
    )
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "match_id",
            sa.Uuid(),
            sa.ForeignKey("chat_threads.match_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "sender_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.UniqueConstraint("match_id", "sequence", name="uq_chat_messages_sequence"),
        sa.UniqueConstraint("match_id", "sender_id", "client_id", name="uq_chat_messages_retry"),
        sa.CheckConstraint("sequence > 0", name=op.f("ck_chat_messages_sequence_positive")),
        sa.CheckConstraint(
            "length(btrim(body)) BETWEEN 1 AND 2000", name=op.f("ck_chat_messages_body_length")
        ),
    )
    op.create_index("ix_chat_messages_sender_created", "chat_messages", ["sender_id", "created_at"])
    op.create_table(
        "chat_read_states",
        sa.Column(
            "match_id",
            sa.Uuid(),
            sa.ForeignKey("chat_threads.match_id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("role", sa.Text(), primary_key=True),
        sa.Column("last_read_sequence", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "role IN ('author','responder')", name=op.f("ck_chat_read_states_participant_role")
        ),
        sa.CheckConstraint(
            "last_read_sequence >= 0", name=op.f("ck_chat_read_states_sequence_nonnegative")
        ),
    )
    op.create_table(
        "archive_hidden",
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
        ),
        sa.Column(
            "plan_id", sa.Uuid(), sa.ForeignKey("plans.id", ondelete="RESTRICT"), primary_key=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute("INSERT INTO chat_threads(match_id) SELECT id FROM matches")
    op.execute(
        "INSERT INTO chat_read_states(match_id,role) SELECT id,role FROM matches "
        "CROSS JOIN (VALUES ('author'),('responder')) roles(role)"
    )
    op.execute(
        "UPDATE plans SET archived_at=now() WHERE publication_status='cancelled' OR "
        "((starts_at AT TIME ZONE time_zone + interval '7 days') AT TIME ZONE time_zone) <= now()"
    )


def downgrade():
    raise RuntimeError(
        "Откат 0005 требует отдельного переноса переписки и истории; данные не удалены"
    )
