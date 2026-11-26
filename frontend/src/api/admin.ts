export interface AdminPeriod { start_date: string; end_date: string; time_zone: string }
export interface Metric { id: string; label: string; unit: string; value: number | null; previous: number | null; change_percent: number | null; definition: string; reason: string | null; data_status?: 'complete' | 'incomplete' | 'unavailable'; collection_started_at?: string | null }
export interface AnalyticsReport {
  generated_at: string
  period: AdminPeriod & { from: string; to_exclusive: string; previous_from: string; previous_to_exclusive: string }
  collection_started_at: string | null
  metrics: Metric[]
  daily: { date: string; registrations: number; active_users: number }[]
  categories: { code: string; label: string; value: number }[]
  funnel: { basis: string; unit: string; note: string; stages: { label: string; value: number | null; numerator: number | null; denominator: number | null; conversion: number | null }[] }
  meetings: { id: string; value: number }[]
  limitations: string[]
}
export interface AdminUser { id: string; name: string | null; state: string; created_at: string; profile_state: string; plans: number; matches: number; related_reports?: number }
export interface AdminPlan { id: string; title: string; category: string; category_code: string; starts_at: string; time_zone: string; publication_status: string; moderation_status: string; responses: number; created_at: string; author: { id: string; name: string | null }; has_reports: boolean; description?: string; place?: string; related_reports?: number }
export interface AdminPage<T> { items: T[]; total: number; next_cursor: string | null }
export interface AdminSystem { checked_at: string; api: string; database: string; worker: string; worker_explanation: string; jobs: Record<string, number>; categories?: { id: string; label: string; count: number }[]; heartbeat?: Record<string, { state: string; label: string; last_seen_at: string | null }>; expired_leases?: number; last_sent_at: string | null; oldest_due_at: string | null; errors: { code: string; count: number }[]; audit: AuditEntry[] }
export type StaffRole = 'user' | 'analyst' | 'moderator' | 'admin' | 'owner'
export interface AdminAccess { role: Exclude<StaffRole, 'user'>; permissions: string[] }
export interface StaffMember { id: string; name: string | null; role: StaffRole; state: string; version: number; created_at: string }
export interface OffsetPage<T> { items: T[]; total: number; next_offset: number | null }
export interface AuditEntry { id?: string; action: string; occurred_at: string; target: string; reason?: string; old_status?: string | null; new_status?: string | null }
export interface NotificationTask { id: string; kind: string; category: string; state_label: string; created_at: string; due_at: string; next_attempt_at: string; sent_at: string | null; attempts: number; reason: string; overdue: boolean }
export interface EditorialFields { title: string; subtitle: string; category_code: string; place: string; plan_title: string; tag: string; sort_order: number }
export interface EditorialIdea extends EditorialFields { id: string; state: 'draft' | 'published'; image: string | null; version: number; created_at: string; updated_at: string }
export const roleLabels: Record<StaffRole, string> = { owner: 'Владелец', admin: 'Администратор', moderator: 'Модератор', analyst: 'Аналитик', user: 'Пользователь' }
export const adminStates: Record<string, string> = { active: 'Активен', blocked: 'Заблокирован', missing: 'Анкеты нет', not_submitted: 'Не проверено', pending: 'На рассмотрении', approved: 'Одобрено', rejected: 'Отклонено', draft: 'Черновик', submitted: 'На проверке', published: 'Опубликован', closed: 'Закрыт', cancelled: 'Отменён', sent: 'Отправлено', retry: 'Повтор', failed: 'Ошибка', suppressed: 'Не отправляется', leased: 'В обработке' }
