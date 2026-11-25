export type SafetyTarget = 'profile' | 'plan' | 'match' | 'chat' | 'message'
export type ReportReason = 'content' | 'harassment' | 'fraud' | 'fake' | 'danger' | 'other'
export interface BlockedUser { id: string; name: string; age: number | null; created_at: string; display_code: string; photo_url: string | null; context: string | null; context_saved_later: boolean }
export interface SafetyContext {
  target_type: Exclude<SafetyTarget, 'message'>
  context_type: 'plan' | 'response' | 'match'
  context_id: string
}
export interface SafetyReport { id: string; state: 'pending' | 'reviewed'; target_type: SafetyTarget; reason_code: ReportReason; created_at: string }
export interface ReportDetail extends SafetyReport {
  comment: string | null
  evidence: { name?: string; age?: number; bio?: string; photo_id?: string; title?: string; description?: string; place?: string; starts_at?: string; reported_message_id?: string; messages?: { id: string; text: string; speaker: 'reporter' | 'reported'; created_at: string }[] }
  can_hide_plan: boolean
  decisions: { action: string; reason: string; actor: string; actor_id: string; decided_at: string }[]
}
export const reportReasons: Record<ReportReason, string> = { content: 'Неподходящий контент', harassment: 'Оскорбления или домогательства', fraud: 'Мошенничество', fake: 'Фейковая анкета', danger: 'Опасное поведение', other: 'Другое' }
export const reportTargets: Record<SafetyTarget, string> = { profile: 'Анкета', plan: 'План', match: 'Мэтч', chat: 'Переписка', message: 'Сообщение' }
