import { Check } from 'lucide-react'
import type { Plan } from '../types'

export function PlaceCheckCaption({ value }: { value?: Plan['placeCheckStatus'] }) {
  if (!value) return null
  return value === 'confirmed' ? <details className="place-check-caption"><summary><Check size={13} aria-hidden="true" /> Место проверено</summary><p className="small-note">Модератор сверил название и адрес места. Это не гарантия его безопасности или доступности</p></details> : <span className="place-check-caption">{value === 'unconfirmed' ? 'Место не подтверждено' : 'Место пока не проверено'}</span>
}
