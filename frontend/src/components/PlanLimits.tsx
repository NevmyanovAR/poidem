import type { CreationQuota, ResponseCapacity } from '../lib/planRules'

export function CreationLimit({ value }: { value: CreationQuota }) {
  return <div className="plan-limit" aria-label="Лимит создания планов"><p>Доступно созданий сегодня: <strong>{value.remaining} из {value.maximum}</strong></p><span>День по времени устройства · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>{value.remaining === 0 && <p role="alert">Дневной лимит создания планов достигнут</p>}</div>
}

export function ResponseLimit({ value }: { value: ResponseCapacity | null }) {
  if (!value) return null
  return <div className="response-limit"><span>Отклики: {value.count} из {value.maximum}</span>{value.full && <span role="status">Лимит откликов достигнут</span>}</div>
}
