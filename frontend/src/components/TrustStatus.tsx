import type { AuthorizationState, ModerationState, ReliabilityState } from '../types'

export function AuthorizationStatus({ value, demoMode = false }: { value: AuthorizationState; demoMode?: boolean }) {
  const text = demoMode ? 'Деморежим · Telegram-авторизация не проверяется'
    : value.status === 'verified' ? 'Данные Telegram подтверждены сервером'
    : value.status === 'checking' ? 'Проверяем данные авторизации'
    : value.status === 'error' ? value.message : 'Telegram-авторизация пока не подтверждена'
  return <p className="trust-status" role="status">{text}</p>
}

export function ModerationStatus({ value, serverVerified = false }: { value?: ModerationState; serverVerified?: boolean }) {
  if (!value || value.status === 'not_submitted') return null
  if (value.source === 'server' && !serverVerified) return <p className="moderation-status">Статус модерации не подтверждён сервером</p>
  const labels = { pending: 'На проверке', approved: 'Проверка пройдена', rejected: 'Отклонён', blocked: 'Заблокирован' }
  const prefix = value.source === 'demo' ? 'Пример статуса: ' : value.source === 'local_text' ? 'Проверка текста: ' : ''
  return <div className="moderation-status" role="status"><span>{prefix}{labels[value.status]}</span>{value.reason && <p>{value.reason}</p>}</div>
}

export function ReliabilityStatus({ value, demoMode = false }: { value: ReliabilityState; demoMode?: boolean }) {
  if (!demoMode || value.kind !== 'demo') return <p className="trust-status">Надёжность: пока нет данных</p>
  return <section className="reliability-status" aria-label="Демонстрационная надёжность"><span>Надёжность: {value.label}</span><p>Подтверждённые встречи: {value.confirmedMeetings} · отмены: {value.cancellations} · подтверждённые неявки: {value.confirmedNoShows} · участия: {value.participations}</p></section>
}
