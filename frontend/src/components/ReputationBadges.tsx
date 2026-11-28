import { Check, MessageCircle } from 'lucide-react'
import type { Experience } from '../api/feedback'
import { PhotoVerified } from './PhotoVerified'

export function ReputationBadges({ photoVerified, experience }: { photoVerified?: boolean; experience?: Experience | null }) {
  if (!photoVerified && !(experience && (experience.unique_confirmed_partners > 0 || experience.pleasant_communication))) return null
  return <div className="reputation-badges" aria-label="Положительные признаки"><PhotoVerified value={photoVerified} />
    {!!experience && experience.unique_confirmed_partners > 0 && <details className="experience-badge"><summary><Check size={14} aria-hidden="true" />Есть подтверждённые встречи</summary><p className="small-note">Участники хотя бы одной встречи подтвердили, что встретились</p></details>}
    {experience?.pleasant_communication && <details className="experience-badge"><summary><MessageCircle size={14} aria-hidden="true" />Приятное общение</summary><p className="small-note">Положительные впечатления оставили разные партнёры после взаимно подтверждённых встреч. Это не гарантия безопасности</p></details>}
  </div>
}
