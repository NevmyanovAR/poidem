import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminPeriod } from '../../api/admin'

export const number = (value: number | null) => value == null ? 'Нет данных' : value.toLocaleString('ru-RU')
export const stamp = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'Нет данных'
export function range(days: number): AdminPeriod {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const begin = new Date(`${today}T12:00:00Z`)
  begin.setUTCDate(begin.getUTCDate() - days + 1)
  return { start_date: begin.toISOString().slice(0, 10), end_date: today, time_zone: 'Europe/Moscow' }
}
export function useResource<T>(key: string, load: () => Promise<T>) {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  const flight = useRef(0)
  const invalidate = useCallback(() => { flight.current++ }, [])
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    const turn = ++flight.current
    queueMicrotask(() => {
      if (turn !== flight.current) return
      setLoading(true); setError('')
      void load().then(value => { if (turn === flight.current) setResult({ key, value }) })
        .catch(error => { if (turn === flight.current) { setResult(null); setError(error instanceof Error ? error.message : 'Не удалось загрузить данные') } })
        .finally(() => { if (turn === flight.current) setLoading(false) })
    })
    return invalidate
  }, [key, load, revision, invalidate])
  return { data: result?.key === key ? result.value : null, error, loading, refresh, replace: (value: T) => setResult({ key, value }) }
}
