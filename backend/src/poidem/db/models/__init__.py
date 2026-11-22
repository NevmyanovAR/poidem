"""Полная metadata. Импортируется приложением, Alembic и тестами."""

from poidem.db.models.accounts import AuthSession, User
from poidem.db.models.feedback import FeedbackAnswer, ReliabilityEvent, Survey, SurveyRecipient
from poidem.db.models.maintenance import MediaDeletion, RateLimitWindow
from poidem.db.models.messaging import BotBinding, NotificationJob, TelegramUpdate
from poidem.db.models.moderation import ModerationCase, ModerationDecision, Report, UserRestriction
from poidem.db.models.operations import AdminAuditLog, AnalyticsEvent, IdempotencyRecord
from poidem.db.models.plans import Category, DailyPlanUsage, Match, Plan, PlanResponse
from poidem.db.models.profiles import (
    GenderOption,
    Interest,
    Photo,
    PreferenceOption,
    Profile,
    ProfileInterest,
)

__all__ = [
    "MediaDeletion",
    "RateLimitWindow",
    "AdminAuditLog",
    "AnalyticsEvent",
    "AuthSession",
    "BotBinding",
    "Category",
    "DailyPlanUsage",
    "FeedbackAnswer",
    "GenderOption",
    "IdempotencyRecord",
    "Interest",
    "Match",
    "ModerationCase",
    "ModerationDecision",
    "NotificationJob",
    "Photo",
    "Plan",
    "PlanResponse",
    "PreferenceOption",
    "Profile",
    "ProfileInterest",
    "ReliabilityEvent",
    "Report",
    "Survey",
    "SurveyRecipient",
    "TelegramUpdate",
    "User",
    "UserRestriction",
]
