"""Индексы агрегатов D61 и честная граница нового учёта, без backfill событий."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

INDEXES = (
    ("ix_users_created_id", "users"),
    ("ix_plans_created_id", "plans"),
    ("ix_matches_created_id", "matches"),
    ("ix_chat_messages_created_id", "chat_messages"),
)


def upgrade():
    for name, table in INDEXES:
        op.create_index(name, table, ["created_at", "id"])
    op.execute(
        sa.text("""
        INSERT INTO analytics_events
          (id,event_key,event_type,occurred_at,allowed_dimensions)
        VALUES (gen_random_uuid(),'measurement:D61','measurement_started',now(),
          '{"policy":"D61-v1","events":["plan_detail_view","plan_published"]}'::jsonb)
        ON CONFLICT(event_key) DO NOTHING
    """)
    )


def downgrade():
    # Историю измерений не уничтожаем при откате индексов/приложения.
    for name, table in reversed(INDEXES):
        op.drop_index(name, table_name=table)
