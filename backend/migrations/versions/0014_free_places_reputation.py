"""D67: optional per-plan address review and independent positive impressions."""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("place_name", "place_address", "place_check_reason"):
        op.add_column("plans", sa.Column(name, sa.Text()))
    for name in ("place_revision", "place_review_version"):
        op.add_column("plans", sa.Column(name, sa.Integer(), nullable=False, server_default="1"))
    op.add_column(
        "plans",
        sa.Column("place_check_status", sa.Text(), nullable=False, server_default="pending"),
    )
    op.add_column("plans", sa.Column("place_checked_revision", sa.Integer()))
    op.add_column(
        "plans",
        sa.Column("place_checked_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.add_column("plans", sa.Column("place_checked_at", sa.DateTime(timezone=True)))
    for name, expression in {
        "place_check_valid": "place_check_status IN ('pending','confirmed','unconfirmed')",
        "place_versions_positive": "place_revision > 0 AND place_review_version > 0",
        "place_fields_pair": (
            "(place_name IS NULL AND place_address IS NULL) OR "
            "(length(btrim(place_name)) > 0 AND length(btrim(place_address)) > 0 AND "
            "place_name IS NOT NULL AND place_address IS NOT NULL) "
        ),
        "place_review_current": (
            "place_check_status = 'pending' OR (place_checked_revision = "
            "place_revision AND place_checked_revision IS NOT NULL AND "
            "place_checked_at IS NOT NULL) "
        ),
    }.items():
        op.create_check_constraint(name, "plans", expression)
    op.create_index("ix_plans_place_check", "plans", ["place_check_status", "created_at", "id"])
    op.alter_column("plans", "place_policy_version", server_default="free-place-v1")
    op.create_table(
        "positive_impressions",
        sa.Column("survey_id", sa.Uuid(), primary_key=True),
        sa.Column("participant_side", sa.Text(), primary_key=True),
        *[
            sa.Column(name, sa.Boolean(), nullable=False)
            for name in ("pleasant", "interesting", "comfortable")
        ],
        sa.Column("consent_version", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["survey_id", "participant_side"],
            ["survey_recipients.survey_id", "survey_recipients.participant_side"],
            name="fk_positive_impressions_recipient",
            ondelete="RESTRICT",
        ),
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON positive_impressions TO poidem_app")


def downgrade():
    raise RuntimeError("История адресов и добровольные ответы не удаляются автоматически")
