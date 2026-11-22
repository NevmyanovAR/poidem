import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ModerationStatus } from '../components/TrustStatus'
import { EmptyState } from '../components/ui'
import { useAppData } from '../state/context'

export function People() {
  const { planId } = useParams()
  const { plans } = useAppData()
  const plan = plans.find(entry => entry.id === planId)
  if (!plan) return <EmptyState title="Этот план не найден" action="Выбрать другой" to="/catalog">Вернись к каталогу и выбери другой план</EmptyState>
  if (plan.own) return <>
    <Link className="back-link" to="/catalog"><ArrowLeft size={16} />Все планы</Link>
    <EmptyState title="Черновик сохранён" action="К моим планам" to="/plans">Черновик доступен до перезагрузки и пока не опубликован</EmptyState>
    <ModerationStatus value={plan.moderation} />
  </>
  return <EmptyState title="Анкета автора недоступна" action="К планам" to="/catalog">Выбери другое предложение</EmptyState>
}
