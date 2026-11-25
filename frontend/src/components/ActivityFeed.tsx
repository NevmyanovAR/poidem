import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppData } from '../state/context'
import type { ActivityItem, Plan } from '../types'
import { EmptyState } from './ui'
import { MatchCard, OwnPlanCard, ResponseCard } from './PlanCards'

export function ActivityFeed({ archive, onCancel, revision = 0, planId }: { archive: boolean; onCancel: (plan: Plan) => void; revision?: number; planId?: string }) {
  const { loadActivity, hideArchive } = useAppData()
  const [includeHidden, setIncludeHidden] = useState(false)
  const [items, setItems] = useState<ActivityItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const live = useRef(false), flight = useRef(0), shownCount = useRef(20)
  const invalidate = useCallback(() => { flight.current++ }, [])
  const refresh = useCallback(async (more?: string) => {
    const turn = ++flight.current
    setLoading(true)
    try {
      let next = more, result: ActivityItem[] = [], following: string | null
      do {
        const page = await loadActivity(archive ? 'archive' : 'active', includeHidden, next, planId)
        result = [...result, ...page.items]; following = page.nextCursor; next = following ?? undefined
      } while (!more && next && result.length < shownCount.current)
      if (!live.current || turn !== flight.current) return
      setItems(previous => more ? [...previous.filter(item => !result.some(entry => entry.key === item.key)), ...result] : result)
      setCursor(following); setError('')
    } catch (reason) { if (live.current && turn === flight.current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить список') }
    finally { if (live.current && turn === flight.current) setLoading(false) }
  }, [loadActivity, archive, includeHidden, planId])
  useEffect(() => {
    live.current = true
    queueMicrotask(() => { if (live.current) void refresh() })
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 10000)
    return () => { live.current = false; invalidate(); window.clearInterval(interval) }
  }, [refresh, invalidate, revision])
  return <>
    <button className="text-link feed-refresh" type="button" aria-busy={loading} disabled={loading} onClick={() => void refresh()}>{loading ? 'Обновляем…' : 'Обновить список'}</button>
    {archive && <label className="small-note archive-toggle"><input type="checkbox" checked={includeHidden} onChange={event => { setIncludeHidden(event.target.checked); shownCount.current = 20 }} />Показать скрытые</label>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {!items.length && loading && <p role="status">Загружаем планы и отклики…</p>}
    <div className="my-plans-list">{items.map(item => <div key={item.key} className="activity-entry">
      {item.match && <MatchCard pair={item.match} />}
      {item.plan && <OwnPlanCard plan={item.plan} onCancel={onCancel} onChange={() => void refresh()} />}
      {item.response && <ResponseCard response={item.response} onChange={() => void refresh()} />}
      {archive && <button className="text-link archive-visibility" type="button" disabled={loading} onClick={async () => {
        try { await hideArchive(item.planId, !item.hidden); await refresh() }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить видимость') }
      }}>{item.hidden ? 'Восстановить карточку' : 'Скрыть'}</button>}
    </div>)}</div>
    {cursor && <button className="button button-outline" type="button" disabled={loading} onClick={() => { shownCount.current = items.length + 20; void refresh(cursor) }}>Показать ещё</button>}
    {!items.length && !loading && !error && <EmptyState title={archive ? 'Архив пока пуст' : 'Здесь будет ваша история'} action="Найти первый план" to="/catalog">{archive ? 'Здесь сохранятся отменённые планы и планы через семь дней после назначенной встречи' : 'Выбери что-нибудь по душе или предложи свою идею. Пусть хороший вечер начнётся с одного шага'}</EmptyState>}
  </>
}
