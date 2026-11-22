import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, MapPin, Plus } from 'lucide-react'
import { useAppData } from '../state/context'
import { EmptyState, PageHeading, Photo } from '../components/ui'
import { ModerationStatus } from '../components/TrustStatus'
import { dateLabel } from '../lib/date'

export function MyPlans() {
  const { plans } = useAppData()
  const [tab, setTab] = useState('Все')
  const mine = plans.filter(p => p.own)
  const filtered = tab === 'Все' || tab === 'Мои идеи' ? mine : []
  return <><div className="heading-with-action"><PageHeading eyebrow="Лучшее — ещё впереди" title="Твои маленькие" italic="большие планы">Идеи, которые ты выбрал, и истории, которые ещё только начинаются</PageHeading><Link className="button button-outline" to="/create"><Plus size={18} />Создать план</Link></div><div className="filter-row">{['Все', 'Мои идеи', 'Выбранные', 'Мэтчи'].map(t => <button className={`chip ${tab === t ? 'selected' : ''}`} key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>{filtered.length ? <div className="my-plans-list">{filtered.map(plan => <article className="my-plan" key={plan.id}><Photo src={plan.image} alt={plan.title} /><div className="my-plan-content"><span className="plan-status">Черновик</span><h2>{plan.title}</h2><ModerationStatus value={plan.moderation} /><p className="plan-meta"><CalendarDays size={15} />{dateLabel(plan.date)} · {plan.time}</p><p className="plan-meta"><MapPin size={15} />{plan.place}</p><Link className="text-link" to={`/people/${plan.id}`}>Посмотреть статус<ArrowRight size={16} /></Link></div></article>)}</div> : <EmptyState title={tab === 'Все' ? 'Здесь будет ваша история' : 'Пока без планов в этом разделе'} action="Найти первый план" to="/catalog">Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага</EmptyState>}</>
}
