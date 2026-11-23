import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, MapPin, Plus } from 'lucide-react'
import { useAppData } from '../state/context'
import { EmptyState, Modal, PageHeading, Photo } from '../components/ui'
import { ModerationStatus } from '../components/TrustStatus'
import { dateLabel } from '../lib/date'
import type { Plan } from '../types'

export function MyPlans() {
  const { plans, authorization, plansLoading, plansError, planError, refreshPlans, publishPlan, cancelPlan, busy } = useAppData()
  const [tab, setTab] = useState('Все')
  const [cancelling, setCancelling] = useState<Plan | null>(null)
  useEffect(() => { if (authorization.status === 'verified') void refreshPlans() }, [authorization.status, refreshPlans])
  const mine = plans.filter(p => p.own)
  const filtered = tab === 'Все' || tab === 'Мои идеи' ? mine : []
  return <>
    <div className="heading-with-action"><PageHeading eyebrow="Лучшее — ещё впереди" title="Твои маленькие" italic="большие планы">Идеи, которые ты выбрал, и истории, которые ещё только начинаются</PageHeading><Link className="button button-outline" to="/create"><Plus size={18} />Создать план</Link></div>
    <div className="filter-row">{['Все', 'Мои идеи', 'Выбранные', 'Мэтчи'].map(t => <button className={`chip ${tab === t ? 'selected' : ''}`} key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
    {authorization.status !== 'verified' ? <EmptyState title="Войди, чтобы увидеть свои планы" action="Моя анкета" to="/profile">Планы сохраняются в твоём аккаунте на сервере</EmptyState> : <>
      <button className="text-link" type="button" disabled={plansLoading} onClick={() => void refreshPlans()}>{plansLoading ? 'Обновляем…' : 'Обновить планы'}</button>
      {(plansError || planError) && <p role="alert" className="field-error">{planError || plansError}</p>}
      {plansLoading && !mine.length ? <p role="status">Загружаем планы…</p> : filtered.length ? <div className="my-plans-list">{filtered.map(plan => <article className="my-plan" key={plan.id}>
        <Photo src={plan.image} alt={plan.title} /><div className="my-plan-content">
          <span className="plan-status">{plan.label}</span><h2>{plan.title}</h2><ModerationStatus value={plan.moderation} serverVerified />
          <p className="plan-meta"><CalendarDays size={15} />{dateLabel(plan.date)} · {plan.time} · {plan.timeZone}</p>
          <p className="plan-meta"><MapPin size={15} />{plan.place}</p>
          <div className="plan-actions"><Link className="text-link" to={`/people/${plan.id}`}>Посмотреть статус<ArrowRight size={16} /></Link>
            {['draft', 'published'].includes(plan.publicationStatus ?? '') && <>
              <Link className="text-link" to={`/create?edit=${plan.id}`}>Изменить</Link>
              {plan.publicationStatus === 'draft' && <button type="button" className="text-link" disabled={busy} onClick={() => void publishPlan(plan)}>Опубликовать</button>}
              <button type="button" className="text-link" disabled={busy} onClick={() => setCancelling(plan)}>Отменить план</button>
            </>}
          </div>
        </div>
      </article>)}</div> : !plansError && <EmptyState title={tab === 'Все' ? 'Здесь будет ваша история' : 'Пока без планов в этом разделе'} action="Найти первый план" to="/catalog">Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага</EmptyState>}
    </>}
    {cancelling && <Modal title="Отменить план?" onClose={() => setCancelling(null)}><p>План исчезнет из каталога, но сохранится в твоей истории. Дневной лимит не восстанавливается</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => { if (await cancelPlan(cancelling)) setCancelling(null) }}>{busy ? 'Отменяем…' : 'Отменить план'}</button>{planError && <p role="alert" className="field-error">{planError}</p>}</Modal>}
  </>
}
