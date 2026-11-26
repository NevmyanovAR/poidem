import { useAutoRefresh } from '../lib/autoRefresh'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAppData } from '../state/context'
import { EmptyState, Modal, PageHeading } from '../components/ui'
import { ActivityFeed } from '../components/ActivityFeed'
import { ResponseCard } from '../components/PlanCards'
import type { Plan } from '../types'
import { isActiveResponse } from '../lib/recordActions'
import { ResponseHistory } from '../components/ResponseHistory'

const tabs = [['own', 'Мои идеи'], ['outgoing', 'Отклики'], ['archive', 'Архив']]

export function MyPlans() {
  const location = useLocation()
  const { authorization, plansLoading, plansError, planError, refreshPlans, cancelPlan, busy,
    incomingResponses, outgoingResponses, connectionsLoading, connectionsError, refreshConnections, refreshNavigation } = useAppData()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') ?? 'own'
  const tab = requested === 'incoming' || tabs.some(([key]) => key === requested) ? requested : 'own'
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
  useAutoRefresh(() => { void refreshConnections(); void refreshNavigation() }, authorization.status === 'verified' && ['incoming', 'outgoing'].includes(tab), tab)
  const planFilter = ['incoming', 'outgoing', 'archive'].includes(tab) ? params.get('plan') : null
  const responses = (tab === 'incoming' ? incomingResponses : outgoingResponses).filter(response => !response.archived && (!planFilter || response.planId === planFilter))
  const responseTab = tab === 'incoming' || tab === 'outgoing'
  const activeResponses = responses.filter(isActiveResponse).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const historicalResponses = responses.filter(response => response.status !== 'accepted' && !isActiveResponse(response))
  const count = activeResponses.length + historicalResponses.length
  if (requested === 'matches') return <Navigate to={{ pathname: '/chats', hash: location.hash }} state={location.state} replace />
  return <>
    <div className="heading-with-action">{tab === 'archive' ? <PageHeading eyebrow="Твоя история" title="Архив" /> : <PageHeading eyebrow="Лучшее — ещё впереди" title="Твои маленькие" italic="большие планы">Идеи, которые ты выбрал, и истории, которые ещё только начинаются</PageHeading>}</div>
    <nav className="filter-row plans-tabs" aria-label="Разделы моих планов" ref={navigation}>{tabs.map(([key, label]) => <button className={`chip ${tab === key || tab === 'incoming' && key === 'own' ? 'selected' : ''}`} key={key} aria-pressed={tab === key || tab === 'incoming' && key === 'own'} onClick={() => setParams({ tab: key })}>{label}</button>)}</nav>
    {tab === 'incoming' && <div className="incoming-heading"><Link className="back-link" to="/plans?tab=own">К моим идеям</Link><h2>Полученные отклики</h2></div>}
    {authorization.status !== 'verified' ? <EmptyState title="Войди, чтобы увидеть свои планы" action="Моя анкета" to="/profile">Планы сохраняются в твоём аккаунте на сервере</EmptyState> : tab === 'own' || tab === 'archive' ? <ActivityFeed key={`${authorization.userId}:${tab}:${planFilter ?? ''}`} archive={tab === 'archive'} view={tab === 'own' ? 'own' : 'all'} revision={revision} onCancel={setCancelling} planId={planFilter ?? undefined} /> : <>
      {(plansError || planError || connectionsError) && <p role="alert" className="field-error">{planError || plansError || connectionsError} <button type="button" className="text-link" disabled={connectionsLoading} onClick={() => { void refreshPlans(); void refreshConnections() }}>Повторить загрузку</button></p>}
      {!count && (plansLoading || connectionsLoading) ? <p role="status">Загружаем планы и отклики…</p> : null}
      <div className="my-plans-list">
        {responseTab && activeResponses.map(response => <ResponseCard key={response.id} response={response} />)}
      </div>
      {responseTab && !activeResponses.length && !!historicalResponses.length && <p className="small-note">{tab === 'incoming' ? 'Сейчас нет откликов, требующих ответа' : 'Сейчас нет откликов в ожидании ответа'}</p>}
      {responseTab && !!historicalResponses.length && <ResponseHistory key={`${authorization.userId}:${tab}:${planFilter ?? ''}`} responses={historicalResponses} initiallyOpen={!activeResponses.length} />}
      {responseTab && responses.some(response => response.status === 'accepted') && <p className="small-note">Подтверждённые пары и встречи доступны в <Link className="text-link" to="/chats">«Чатах»</Link></p>}
      {responseTab && <p className="small-note">История архивных планов доступна в разделе «Архив»</p>}
      {!count && !plansLoading && !connectionsLoading && !plansError && !connectionsError && !(responseTab && responses.some(response => response.status === 'accepted')) && <EmptyState title="Пока без планов в этом разделе" action="Найти первый план" to="/catalog">Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага</EmptyState>}
    </>}
    {cancelling && <Modal title="Отменить план?" onClose={() => setCancelling(null)}><p>План исчезнет из каталога и перейдёт в архив. Дневной лимит не восстанавливается</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => { if (await cancelPlan(cancelling)) { setCancelling(null); setRevision(value => value + 1) } }}>{busy ? 'Отменяем…' : 'Отменить план'}</button>{planError && <p role="alert" className="field-error">{planError}</p>}</Modal>}
  </>
}
