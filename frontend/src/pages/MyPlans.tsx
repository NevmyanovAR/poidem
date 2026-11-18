import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, Heart, MapPin, Plus } from 'lucide-react'
import { useDemo } from '../state/context'
import { EmptyState, PageHeading, Photo } from '../components/ui'
import { ModerationStatus } from '../components/TrustStatus'
import { ResponseLimit } from '../components/PlanLimits'
import { dateLabel } from '../lib/date'

export function MyPlans() {
  const { data, plans, fixtureMode, responseInfo } = useDemo()
  const [tab, setTab] = useState('Все')
  const mine = plans.filter(p => p.own || data.selectedIds.includes(p.id))
  const filtered = mine.filter(p => tab === 'Все' || (tab === 'Мои идеи' && p.own) || (tab === 'Выбранные' && !p.own) || (tab === 'Мэтчи' && fixtureMode && data.invites.some(i => i.planId === p.id && i.status === 'matched')))
  return <><div className="heading-with-action"><PageHeading eyebrow="Лучшее — ещё впереди" title="Твои маленькие" italic="большие планы">Идеи, которые ты выбрал, и истории, которые ещё только начинаются</PageHeading><Link className="button button-outline" to="/create"><Plus size={18} />Создать план</Link></div><div className="filter-row">{['Все', 'Мои идеи', 'Выбранные', 'Мэтчи'].map(t => <button className={`chip ${tab === t ? 'selected' : ''}`} key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>{filtered.length ? <div className="my-plans-list">{filtered.map(plan => { const matched = fixtureMode ? data.invites.find(i => i.planId === plan.id && i.status === 'matched') : undefined; const waiting = fixtureMode && data.invites.some(i => i.planId === plan.id && i.status === 'waiting'); return <article className="my-plan" key={plan.id}><Photo src={plan.image} alt={plan.title} /><div className="my-plan-content"><span className={`plan-status ${matched ? 'status-match' : ''}`}>{matched ? <><Heart size={13} />Совпадение</> : waiting ? 'Ждём согласия' : plan.own ? (fixtureMode && plan.published ? 'Опубликован в деморежиме' : 'Черновик') : 'Выбранный план'}</span><h2>{plan.title}</h2><ModerationStatus value={plan.moderation} /><ResponseLimit value={responseInfo(plan.id)} /><p className="plan-meta"><CalendarDays size={15} />{dateLabel(plan.date)} · {plan.time}</p><p className="plan-meta"><MapPin size={15} />{plan.place}</p><Link className="text-link" to={matched ? `/match/${matched.id}` : `/people/${plan.id}`}>{matched ? 'Посмотреть мэтч' : plan.own ? 'Посмотреть статус' : 'Посмотреть пару'}<ArrowRight size={16} /></Link></div></article> })}</div> : <EmptyState title={tab === 'Все' ? 'Здесь будет ваша история' : 'Пока без планов в этом разделе'} action="Найти первый план" to="/catalog">Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага</EmptyState>}</>
}
