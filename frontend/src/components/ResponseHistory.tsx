import { useCallback, useEffect, useRef, useState } from 'react'
import { meetingDateLabel } from '../lib/date'
import { responseEventTime } from '../lib/recordActions'
import { useAppData } from '../state/context'
import type { PlanResponse } from '../types'

function responseResultLabel(response: PlanResponse, archive = false): string {
  switch (response.displayStatus) {
    case 'expired': return 'Время плана прошло'
    case 'rejected': return archive ? 'Отклонён' : response.viewerRole === 'author' ? 'Вы отклонили отклик' : 'Ваш отклик не принят'
    case 'accepted': return 'Принят'
    case 'closed': return 'Выбрана другая пара'
    case 'cancelled': return 'План отменён'
    case 'unavailable': return 'План недоступен'
    default: return response.archived ? 'План в архиве' : 'Ожидает ответа'
  }
}

function responseTitle(response: PlanResponse): string {
  return response.historyContext?.planTitle ?? response.plan?.title ?? 'Название плана не сохранено'
}

export function ResponseHistoryEntry({ response, archive = false, explainRejection = false }: { response: PlanResponse; archive?: boolean; explainRejection?: boolean }) {
  const context = response.historyContext
  const person = response.viewerRole === 'author'
    ? context ? `${context.responderName}, ${context.responderAge}` : response.profile ? `${response.profile.name}, ${response.profile.age}` : 'Имя кандидата не сохранено'
    : `Автор: ${context?.authorName ?? response.profile?.name ?? response.plan?.author.name ?? 'имя не сохранено'}`
  return <article className="response-history-entry" data-response-id={response.id}>
    <div className="record-heading"><span className="plan-status">{responseResultLabel(response, archive)}</span>{!archive && <h3>{responseTitle(response)}</h3>}</div>
    <p className="record-person">{person}</p>
    <time className="small-note" dateTime={response.createdAt}>Отклик {meetingDateLabel({ startsAt: response.createdAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</time>
    {context?.source === 'legacy' && <span className="small-note">Сведения сохранены позже отклика</span>}
    {explainRejection && response.status === 'rejected' && response.viewerRole === 'responder' && <p className="small-note">Повторный отклик на этот план недоступен</p>}
  </article>
}

export function ResponseHistory({ responses, initiallyOpen }: { responses: PlanResponse[]; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const sorted = [...responses].sort((a, b) => responseEventTime(b) - responseEventTime(a) || b.id.localeCompare(a.id))
  if (!sorted.length) return null
  const latest = sorted.find(response => response.status === 'rejected') ?? sorted[0]
  return <details className="response-history" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>История ({sorted.length})</span><span className="response-history-preview" role="status">{responseResultLabel(latest)} · {responseTitle(latest)}</span></summary>
    {sorted.some(response => response.status === 'rejected' && response.viewerRole === 'responder') && <p className="small-note">Повторные отклики на планы с отказом недоступны</p>}
    <ul className="response-history-list">{sorted.map(response => <li key={response.id}><ResponseHistoryEntry response={response} /></li>)}</ul>
  </details>
}

export function ArchiveResponseHistory({ planId }: { planId: string }) {
  const { authorization } = useAppData()
  if (authorization.status !== 'verified') return null
  return <ArchiveHistoryContent key={`${authorization.userId}:${planId}`} planId={planId} />
}

function ArchiveHistoryContent({ planId }: { planId: string }) {
  const { loadPlanResponses } = useAppData()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PlanResponse[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const live = useRef(false), flight = useRef(0)
  const invalidate = useCallback(() => { flight.current++ }, [])
  useEffect(() => { live.current = true; return () => { live.current = false; invalidate() } }, [invalidate])
  const load = async (next?: string) => {
    const turn = ++flight.current
    setLoading(true); setError('')
    try {
      const page = await loadPlanResponses(planId, next)
      if (!live.current || turn !== flight.current) return
      setItems(previous => next ? [...previous.filter(item => !page.items.some(entry => entry.id === item.id)), ...page.items] : page.items)
      setCursor(page.nextCursor); setLoaded(true)
    } catch (reason) { if (live.current && turn === flight.current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить историю') }
    finally { if (live.current && turn === flight.current) setLoading(false) }
  }
  return <details className="response-history archive-response-history" open={open} onToggle={event => {
    const expanded = event.currentTarget.open
    setOpen(expanded)
    if (expanded && !loaded && !loading && !error) void load()
  }}>
    <summary>История откликов</summary>
    {loading && <p className="small-note" role="status">Загружаем историю…</p>}
    {error && <div role="alert" className="field-error">{error} <button type="button" className="text-link" disabled={loading} onClick={() => void load(loaded ? cursor ?? undefined : undefined)}>Повторить загрузку</button></div>}
    <ul className="response-history-list">{items.map(response => <li key={response.id}><ResponseHistoryEntry response={response} archive /></li>)}</ul>
    {loaded && !items.length && <p className="small-note">На этот план не было откликов</p>}
    {cursor && <button type="button" className="text-link" disabled={loading} onClick={() => void load(cursor)}>Показать ещё отклики</button>}
  </details>
}
