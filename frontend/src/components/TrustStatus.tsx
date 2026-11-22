import type { AuthorizationState, ModerationState } from '../types'

export function AuthorizationStatus({ value }: { value: AuthorizationState }) {
  const text = value.status === 'verified' ? 'Данные Telegram подтверждены сервером'
    : value.status === 'checking' ? 'Проверяем данные авторизации'
    : value.status === 'error' ? value.message : 'Telegram-авторизация пока не подтверждена'
  return <p className="trust-status" role="status">{text}</p>
}

export function ModerationStatus({ value, serverVerified = false }: { value?: ModerationState; serverVerified?: boolean }) {
  if (!value || value.status === 'not_submitted') return null
  if (value.source === 'server' && !serverVerified) return <p className="moderation-status">Статус модерации не подтверждён сервером</p>
  const labels = { pending: 'На проверке', approved: 'Проверка пройдена', rejected: 'Отклонён', blocked: 'Заблокирован' }
  const prefix = value.source === 'local_text' ? 'Проверка текста: ' : ''
  return <div className="moderation-status" role="status"><span>{prefix}{labels[value.status]}</span>{value.reason && <p>{value.reason}</p>}</div>
}
