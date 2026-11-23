"""user_plans: статусы и неперсональные категории существующей формы."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATEGORIES = (
    ("art", "Искусство", "/images/gallery.jpeg"),
    ("food", "Кофе и еда", "/images/dinner.jpeg"),
    ("walks", "Прогулки", "/images/museum.jpeg"),
    ("experiences", "Впечатления", "/images/art.jpeg"),
)


def upgrade() -> None:
    op.drop_constraint(op.f("ck_plans_publication_status"), "plans", type_="check")
    op.create_check_constraint(
        op.f("ck_plans_publication_status"),
        "plans",
        "publication_status IN ('draft','submitted','published','closed','cancelled')",
    )
    for code, title, image in CATEGORIES:
        op.execute(
            sa.text(
                "INSERT INTO categories(code,title,cover_asset_key,enabled) "
                "VALUES (:code,:title,:image,true) ON CONFLICT (code) DO NOTHING"
            ).bindparams(code=code, title=title, image=image)
        )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM plans WHERE publication_status='cancelled'")
    ):
        raise RuntimeError("Откат требует отдельного решения для существующих отменённых планов")
    op.drop_constraint(op.f("ck_plans_publication_status"), "plans", type_="check")
    op.create_check_constraint(
        op.f("ck_plans_publication_status"),
        "plans",
        "publication_status IN ('draft','submitted','published','closed')",
    )
    # Категории сохраняются: ими могли воспользоваться реальные планы.
