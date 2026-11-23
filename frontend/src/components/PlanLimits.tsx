import type { CreationQuota, ResponseCapacity } from '../lib/planRules'

export function CreationLimit({ value }: { value: CreationQuota }) {
  return <div className="plan-limit" aria-label="Лимит создания планов">{value.ready === false ? <p>Лимит доступен после входа и загрузки с сервера</p> : <><p>Доступно созданий сегодня: <strong>{value.remaining} из {value.maximum}</strong></p><span>Календарный день · {value.timeZone ?? 'Europe/Moscow'}</span>{value.remaining === 0 && <p role="alert">Дневной лимит создания планов достигнут</p>}</>}</div>
}

export function ResponseLimit({ value }: { value: ResponseCapacity | null }) {
  if (!value) return null
  return <div className="response-limit"><span>Отклики: {value.count} из {value.maximum}</span>{value.full && <span role="status">Лимит откликов достигнут</span>}</div>
}
