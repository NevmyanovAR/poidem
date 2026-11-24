import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useAppData } from '../state/context'
import { EmptyState, Modal, PageHeading } from '../components/ui'
import { ActivityFeed } from '../components/ActivityFeed'
import { MatchCard, OwnPlanCard, ResponseCard } from '../components/PlanCards'
import type { Plan } from '../types'
import { isActiveResponse } from '../lib/recordActions'
import { ResponseHistory } from '../components/ResponseHistory'

const tabs = [['all', 'Все'], ['own', 'Мои идеи'], ['outgoing', 'Выбранные'], ['incoming', 'Полученные отклики'], ['matches', 'Мэтчи'], ['archive', 'Архив']]

export function MyPlans() {
  const { plans, authorization, plansLoading, plansError, planError, refreshPlans, cancelPlan, busy,
    incomingResponses, outgoingResponses, matches, connectionsLoading, connectionsError, refreshConnections } = useAppData()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') ?? 'all'
  const tab = tabs.some(([key]) => key === requested) ? requested : 'all'
  const [cancelling, setCancelling] = useState<Plan | null>(null)
  const [revision, setRevision] = useState(0)
  const navigation = useRef<HTMLElement>(null)
  useEffect(() => {
    const row = navigation.current, active = row?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!row || !active) return
    let live = true
    const reveal = () => {
      if (!live) return
      const bounds = row.getBoundingClientRect(), button = active.getBoundingClientRect()
      const offset = button.left < bounds.left ? button.left - bounds.left : button.right > bounds.right ? button.right - bounds.right : 0
      if (offset) row.scrollLeft += offset
    }
    const observer = new ResizeObserver(reveal)
    observer.observe(row)
    row.querySelectorAll('button').forEach(button => observer.observe(button))
    reveal()
    void document.fonts.ready.then(reveal)
    return () => { live = false; observer.disconnect() }
  }, [tab])
  useEffect(() => { if (authorization.status === 'verified') { void refreshPlans(); void refreshConnections() } }, [authorization.status, refreshPlans, refreshConnections])
  useEffect(() => {
    if (authorization.status !== 'verified') return
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshConnections() }, 10000)
    return () => window.clearInterval(interval)
  }, [authorization.status, refreshConnections])
  const mine = plans.filter(plan => plan.own && !plan.archived)
  const planFilter = tab === 'incoming' ? params.get('plan') : null
  const responses = (tab === 'incoming' ? incomingResponses : outgoingResponses).filter(response => !response.archived && (!planFilter || response.planId === planFilter))
  const responseTab = tab === 'incoming' || tab === 'outgoing'
  const activeResponses = responses.filter(isActiveResponse).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const historicalResponses = responses.filter(response => response.status !== 'accepted' && !isActiveResponse(response))
  const pairs = matches.filter(pair => !pair.archived)
  const count = tab === 'own' ? mine.length : tab === 'matches' ? pairs.length : activeResponses.length + historicalResponses.length
  return <>
    <div className="heading-with-action">{tab === 'archive' ? <PageHeading eyebrow="Твоя история" title="Архив" /> : <PageHeading eyebrow="Лучшее — ещё впереди" title="Твои маленькие" italic="большие планы">Идеи, которые ты выбрал, и истории, которые ещё только начинаются</PageHeading>}<Link className="button button-outline" to="/create"><Plus size={18} />Создать план</Link></div>
    <nav className="filter-row plans-tabs" aria-label="Разделы моих планов" ref={navigation}>{tabs.map(([key, label]) => <button className={`chip ${tab === key ? 'selected' : ''}`} key={key} aria-pressed={tab === key} onClick={() => setParams(key === 'all' ? {} : { tab: key })}>{label}{key === 'incoming' && incomingResponses.some(isActiveResponse) ? ` · ${incomingResponses.filter(isActiveResponse).length}` : ''}</button>)}</nav>
    {authorization.status !== 'verified' ? <EmptyState title="Войди, чтобы увидеть свои планы" action="Моя анкета" to="/profile">Планы сохраняются в твоём аккаунте на сервере</EmptyState> : tab === 'all' || tab === 'archive' ? <ActivityFeed key={`${authorization.userId}:${tab}`} archive={tab === 'archive'} revision={revision} onCancel={setCancelling} /> : <>
      <button className="text-link" type="button" disabled={plansLoading || connectionsLoading} onClick={() => { void refreshPlans(); void refreshConnections() }}>{plansLoading || connectionsLoading ? 'Обновляем…' : 'Обновить планы'}</button>
      {(plansError || planError || connectionsError) && <p role="alert" className="field-error">{planError || plansError || connectionsError}</p>}
      {!count && (plansLoading || connectionsLoading) ? <p role="status">Загружаем планы и отклики…</p> : null}
      <div className="my-plans-list">
        {tab === 'own' && mine.map(plan => <OwnPlanCard key={plan.id} plan={plan} onCancel={setCancelling} />)}
        {responseTab && activeResponses.map(response => <ResponseCard key={response.id} response={response} />)}
        {tab === 'matches' && pairs.map(pair => <MatchCard key={pair.id} pair={pair} />)}
      </div>
      {responseTab && !activeResponses.length && !!historicalResponses.length && <p className="small-note">{tab === 'incoming' ? 'Сейчас нет откликов, требующих ответа' : 'Сейчас нет откликов в ожидании ответа'}</p>}
      {responseTab && !!historicalResponses.length && <ResponseHistory key={`${authorization.userId}:${tab}:${planFilter ?? ''}`} responses={historicalResponses} initiallyOpen={!activeResponses.length} />}
      {responseTab && responses.some(response => response.status === 'accepted') && <p className="small-note">Подтверждённые пары находятся в разделе «Мэтчи»</p>}
      {responseTab && <p className="small-note">История архивных планов доступна в разделе «Архив»</p>}
      {!count && !plansLoading && !connectionsLoading && !plansError && !connectionsError && !(responseTab && responses.some(response => response.status === 'accepted')) && <EmptyState title="Пока без планов в этом разделе" action="Найти первый план" to="/catalog">Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага</EmptyState>}
    </>}
    {cancelling && <Modal title="Отменить план?" onClose={() => setCancelling(null)}><p>План исчезнет из каталога и перейдёт в архив. Дневной лимит не восстанавливается</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => { if (await cancelPlan(cancelling)) { setCancelling(null); setRevision(value => value + 1) } }}>{busy ? 'Отменяем…' : 'Отменить план'}</button>{planError && <p role="alert" className="field-error">{planError}</p>}</Modal>}
  </>
}
