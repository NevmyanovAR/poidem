export interface VerificationRequest {
  id: string; state: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'; version: number
  created_at: string; submitted_at: string | null; expires_at: string; reviewed_at: string | null
  instruction: string; reason_code: string | null; reason: string | null; consent_version: string
}
export interface VerificationState {
  photo_id: string | null
  available: boolean; state: 'unverified' | 'pending' | 'verified' | 'rejected' | 'invalidated'
  photo_verified: boolean; consent_version: string; consent_text: string; request: VerificationRequest | null
  retention?: { pending_hours: number; reviewed_hours: number } | null
}
export interface VerificationDetail extends VerificationRequest {
  user_name: string; primary_url: string | null; selfie_url: string | null; can_decide: boolean
}
export interface VerificationPage { items: (VerificationRequest & { user_name: string; waiting_minutes?: number })[]; next_offset: number | null }
export const verificationLabels = { unverified: 'Не подтверждено', pending: 'Фото на проверке', verified: 'Фото подтверждено', rejected: 'Заявка отклонена', invalidated: 'Проверка недействительна после смены фотографии' }
export const verificationReasons = { face_mismatch: 'Лицо не совпадает с фотографией анкеты', face_unclear: 'Лицо плохо видно', instruction_mismatch: 'Проверочный снимок не соответствует инструкции', insufficient: 'Недостаточно данных для подтверждения', other: 'Другая причина' }
