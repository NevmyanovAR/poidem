import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react'
import { ModerationStatus } from '../components/TrustStatus'
import { EmptyState, Photo } from '../components/ui'
import { useAppData } from '../state/context'

export function People() {
  const { planId } = useParams()
  const { plans, publishedPlans, plansLoading, plansError, authorization, refreshPlans } = useAppData()
  const plan = [...plans, ...publishedPlans].find(entry => entry.id === planId)
  if (authorization.status === 'checking' || plansLoading && !plan) return <p role="status">Загружаем план…</p>
  if (authorization.status !== 'verified') return <EmptyState title="Войди, чтобы открыть план" action="Моя анкета" to="/profile">Пользовательские планы доступны после входа через Telegram</EmptyState>
  if (plansError && !plan) return <><p role="alert" className="field-error">{plansError}</p><button type="button" className="button button-outline" onClick={() => void refreshPlans()}>Повторить загрузку</button></>
  if (!plan) return <EmptyState title="Этот план не найден" action="Выбрать другой" to="/catalog">Вернись к каталогу и выбери другой план</EmptyState>
  const author = 'author' in plan ? plan.author as { name: string } : null
  return <>
    <Link className="back-link" to={plan.own ? '/plans' : '/catalog'}><ArrowLeft size={16} />{plan.own ? 'Мои планы' : 'Все планы'}</Link>
    <article className="my-plan"><Photo src={plan.image} alt={plan.title} /><div className="my-plan-content">
      <span className="plan-status">{plan.label}</span><h2>{plan.title}</h2>
      {author && <p>Автор: {author.name}</p>}
      <p className="plan-meta"><CalendarDays size={16} />{plan.date} · {plan.time} · {plan.timeZone}</p>
      <p className="plan-meta"><MapPin size={16} />{plan.place}</p>
      <p className="review-description">{plan.description}</p><ModerationStatus value={plan.moderation} serverVerified />
      {plan.own ? <Link className="text-link" to="/plans">Управлять планом</Link> : <p className="small-note">Отклики и мэтчи появятся на следующем этапе</p>}
    </div></article>
  </>
}
