"""11А: снимки общественных мест, прежние места остаются legacy без переписывания."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    # Сначала NULL для всех существующих строк; default применяется лишь новым.
    op.add_column("plans", sa.Column("place_policy_version", sa.Text(), nullable=True))
    op.alter_column("plans", "place_policy_version", server_default="public-poi-v1")
    op.add_column("plans", sa.Column("venue", JSONB(), nullable=True))
    op.create_table(
        "place_selections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("provider_place_id", sa.Text(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.UniqueConstraint("user_id", "provider", "provider_place_id", name="uq_place_selection"),
        sa.CheckConstraint("jsonb_typeof(snapshot) = 'object'", name="snapshot_object"),
    )
    op.create_index(
        "ix_place_selections_user_created", "place_selections", ["user_id", "created_at"]
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON place_selections TO poidem_app")


def downgrade():
    raise RuntimeError("Откат потребовал бы удаления снимков выбранных мест; согласуйте экспорт")
