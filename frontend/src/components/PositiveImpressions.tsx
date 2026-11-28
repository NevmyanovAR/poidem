import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppData } from '../state/context'
import type { ImpressionState } from '../api/feedback'

const options = { pleasant: 'Приятно общаться', interesting: 'Интересный собеседник', comfortable: 'Комфортная встреча' }
export function PositiveImpressions({ matchId, resultKey, onSaved }: { matchId: string; resultKey: string; onSaved?: () => void }) {
  const { meeting } = useAppData()
  const [state, setState] = useState<ImpressionState | null>(null), [chosen, setChosen] = useState<string[]>([]), [editing, setEditing] = useState(false), [consent, setConsent] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const flight = useRef(0), mutation = useRef(false), alive = useRef(false)
  const invalidate = useCallback(() => { flight.current++ }, [])
  const load = useCallback(async () => { if (mutation.current) return; const turn = ++flight.current; try { const value = await meeting.impressions(matchId); if (turn === flight.current) { setState(value); setError('') } } catch { if (turn === flight.current) setError('Не удалось загрузить впечатления') } }, [meeting, matchId])
  useEffect(() => { alive.current = true; return () => { alive.current = false; invalidate() } }, [invalidate])
  useEffect(() => { queueMicrotask(() => { if (alive.current) void load() }); return invalidate }, [load, resultKey, invalidate])
  if (!state) return error ? <p className="small-note">{error} <button type="button" className="text-link" onClick={() => void load()}>Повторить</button></p> : null
  if (!state.eligible && !state.submitted) return null
  async function save(withdraw = false) {
    if (mutation.current) return
    mutation.current = true; setBusy(true); const turn = ++flight.current
    try { const value = withdraw ? await meeting.withdrawImpressions(matchId) : await meeting.saveImpressions(matchId, chosen); if (turn === flight.current) { setState(value); setEditing(false); setConsent(false); setError(''); onSaved?.() } }
    catch (reason) { if (turn === flight.current) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить впечатления') }
    finally { mutation.current = false; if (alive.current) { setBusy(false); if (turn !== flight.current) void load() } }
  }
  return <div className="positive-impressions"><h3>Что понравилось в общении?</h3>
    <p className="small-note">Отвечать необязательно. Положительные ответы влияют на публичную отметку «Приятное общение». Партнёр не увидит твой ответ или имя автора</p>
    {state.submitted && !editing && <p role="status">Впечатления сохранены</p>}
    {!state.eligible && <p className="small-note">Сейчас нет взаимного подтверждения встречи — ответ не влияет на отметку</p>}
    {state.eligible && !editing && <button type="button" className="text-link" onClick={() => { setChosen(state.own_options); setEditing(true) }}>{state.submitted ? 'Изменить впечатления' : 'Поделиться впечатлением'}</button>}
    {state.eligible && editing && <><div className="impression-options" role="group" aria-label="Положительные впечатления">{Object.entries(options).map(([key, label]) => <button key={key} type="button" className={`chip ${chosen.includes(key) ? 'selected' : ''}`} aria-pressed={chosen.includes(key)} disabled={busy} onClick={() => setChosen(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key])}>{label}</button>)}</div>
      <label className="verification-agree"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />Согласен, что положительный ответ влияет на публичную отметку</label>
      <div className="plan-actions"><button type="button" className="button button-outline" disabled={busy || !consent || !chosen.length} onClick={() => void save()}>Сохранить впечатления</button><button type="button" className="text-link" disabled={busy} onClick={() => setEditing(false)}>Пропустить</button></div></>}
    {state.submitted && <button type="button" className="text-link" disabled={busy} onClick={() => void save(true)}>Отозвать впечатления</button>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </div>
}
