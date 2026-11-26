import { useLocation } from 'react-router-dom'
import { listSize, saveListSize } from '../lib/scrollMemory'
import { RefreshGate, useAutoRefresh } from '../lib/autoRefresh'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppData } from '../state/context'
import type { ActivityItem, Plan } from '../types'
import { EmptyState } from './ui'
import { MatchCard, OwnPlanCard, ResponseCard } from './PlanCards'

export function ActivityFeed({ archive, onCancel, revision = 0, planId, view = 'all' }: { archive: boolean; onCancel: (plan: Plan) => void; revision?: number; planId?: string; view?: 'all' | 'own' }) {
  const { loadActivity, hideArchive, activityRevision } = useAppData()
  const location = useLocation()
  const sizeKey = location.pathname + location.search
  const [includeHidden, setIncludeHidden] = useState(false)
  const [items, setItems] = useState<ActivityItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const live = useRef(false), flight = useRef(0), shownCount = useRef(listSize(sizeKey))
  const gate = useRef(new RefreshGate())
  const invalidate = useCallback(() => { flight.current++; gate.current.invalidate() }, [])
  const refresh = useCallback((more?: string) => {
    const turn = ++flight.current
    return gate.current.run(async () => {
      if (!live.current) return
      setLoading(true)
      try {
        let next = more, result: ActivityItem[] = [], following: string | null
        do {
          const page = await loadActivity(archive ? 'archive' : 'active', includeHidden, next, planId, view)
          result = [...result, ...page.items]; following = page.nextCursor; next = following ?? undefined
        } while (!more && next && result.length < shownCount.current)
        if (!live.current || turn !== flight.current) return
        setItems(previous => more ? [...previous.filter(item => !result.some(entry => entry.key === item.key)), ...result] : result)
        setCursor(following); setError('')
      } catch (reason) { if (live.current && turn === flight.current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить список') }
      finally { if (live.current && turn === flight.current) setLoading(false) }
    })
  }, [loadActivity, archive, includeHidden, planId, view])
  useEffect(() => {
    live.current = true
    return () => { live.current = false; invalidate() }
  }, [refresh, invalidate])
  useAutoRefresh(() => { void refresh() }, true, JSON.stringify([revision, activityRevision, includeHidden, planId, view]))
  const renderItem = (item: ActivityItem) => <div key={item.key} className="activity-entry">
    {item.match && <MatchCard pair={item.match} />}
    {item.plan && <OwnPlanCard plan={item.plan} pendingCount={item.pendingResponseCount} matchId={item.matchId} history={item.history} onCancel={onCancel} onChange={() => void refresh()} />}
    {item.response && <ResponseCard response={item.response} onChange={() => void refresh()} />}
    {archive && <button className="text-link archive-visibility" type="button" disabled={loading} onClick={async () => {
      try { await hideArchive(item.planId, !item.hidden); await refresh() }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить видимость') }
    }}>{item.hidden ? 'Восстановить карточку' : 'Скрыть'}</button>}
  </div>
  const history = view === 'own' && !archive ? items.filter(item => item.history) : []
  return <>
    {archive && <label className="small-note archive-toggle"><input type="checkbox" checked={includeHidden} onChange={event => { setIncludeHidden(event.target.checked); shownCount.current = 20 }} />Показать скрытые</label>}
    {error && <p role="alert" className="field-error">{error} <button type="button" className="text-link" disabled={loading} onClick={() => void refresh()}>Повторить загрузку</button></p>}
    {!items.length && loading && <p role="status">Загружаем планы и отклики…</p>}
    <div className="my-plans-list">{items.filter(item => !history.includes(item)).map(renderItem)}</div>
    {!!history.length && <details className="own-plan-history response-history"><summary>История</summary><div className="my-plans-list">{history.map(renderItem)}</div></details>}
    {cursor && <button className="button button-outline" type="button" disabled={loading} onClick={() => { shownCount.current = items.length + 20; saveListSize(sizeKey, shownCount.current); void refresh(cursor) }}>Показать ещё</button>}
    {!items.length && !loading && !error && <EmptyState title={archive ? 'Архив пока пуст' : 'Здесь будут твои идеи'} action="Найти первый план" to="/catalog">{archive ? 'Здесь сохранятся отменённые планы и планы через семь дней после назначенной встречи' : 'Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага'}</EmptyState>}
  </>
}
