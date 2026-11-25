export type MeetingOutcome = 'mutual_yes' | 'mutual_no' | 'insufficient' | 'conflicting' | 'no_data'
export interface MeetingResult { result: MeetingOutcome; author_answered: boolean; responder_answered: boolean }
export interface Experience { unique_confirmed_partners: number; policy_version: 'D58-mutual-unique-partners-v1' }
export interface OwnFeedback { met: boolean | null; rating: number | null; comment: string | null; submitted: boolean; updated_at: string }
export interface SurveyState {
  availability: 'not_scheduled' | 'upcoming' | 'available' | 'expired' | 'cancelled' | 'unavailable'
  opens_at: string | null; closes_at: string | null; can_answer: boolean
  own_answer: OwnFeedback | null; other_answered: boolean; result: MeetingResult; policy_version: string | null
}
export interface FeedbackInput { met: boolean; rating: number | null; comment: string | null }
export const meetingLabels: Record<MeetingOutcome, string> = {
  mutual_yes: 'Оба подтвердили встречу', mutual_no: 'По ответам обоих встреча не состоялась',
  insufficient: 'Недостаточно информации', conflicting: 'Ответы не совпали', no_data: 'Нет данных о встрече',
}
