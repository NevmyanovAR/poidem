import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppData } from '../state/context'
import { meetingLabels } from '../api/feedback'
import type { Experience, SurveyState } from '../api/feedback'

export function ExperienceCaption({ value, own = false }: { value?: Experience | null; own?: boolean }) {
  if (!value) return null
  if (own) return <p className="reliability-status" title="Число уникальных партнёров, с которыми встречу подтвердили оба участника. Самоотчёт, без проверки факта встречи" aria-label={`Уникальных партнёров со взаимным подтверждением встречи: ${value.unique_confirmed_partners}`}>Взаимные подтверждения · {value.unique_confirmed_partners}</p>
  if (!(value.unique_confirmed_partners > 0)) return null
  return <details className="experience-badge"><summary>Есть подтверждённые встречи</summary><p className="small-note">Участники хотя бы одной встречи подтвердили, что встретились</p></details>
}

export function OwnExperience() {
  const { authorization } = useAppData()
  return authorization.status === 'verified' ? <OwnExperienceValue key={authorization.userId} /> : null
}

function OwnExperienceValue() {
  const { meeting } = useAppData()
  const [value, setValue] = useState<Experience | null>(null), [error, setError] = useState(false)
  const alive = useRef(false)
  const load = useCallback(async () => {
    try { const result = await meeting.reliability(); if (alive.current) { setValue(result); setError(false) } }
    catch { if (alive.current) setError(true) }
  }, [meeting])
  useEffect(() => {
    alive.current = true
    queueMicrotask(() => { if (alive.current) void load() })
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { alive.current = false; document.removeEventListener('visibilitychange', visible) }
  }, [load])
  return <><ExperienceCaption value={value} own />{error && <p className="small-note">Не удалось обновить подтверждения <button className="text-link" type="button" onClick={() => void load()}>Повторить</button></p>}</>
}

export function MeetingFeedback({ matchId, onSaved }: { matchId: string; onSaved?: () => void }) {
  const { authorization } = useAppData()
  return authorization.status === 'verified' ? <FeedbackPanel key={`${authorization.userId}:${matchId}`} matchId={matchId} onSaved={onSaved} /> : null
}

function FeedbackPanel({ matchId, onSaved }: { matchId: string; onSaved?: () => void }) {
  const { meeting } = useAppData()
  const [state, setState] = useState<SurveyState | null>(null), [error, setError] = useState('')
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false)
  const [met, setMet] = useState<boolean | null>(null), [rating, setRating] = useState(''), [comment, setComment] = useState('')
  const alive = useRef(false), busy = useRef(false), turn = useRef(0)
  const previousResult = useRef<string | null>(null)
  const invalidate = useCallback(() => { turn.current++ }, [])
  const load = useCallback(async () => {
    if (busy.current) return
    const request = ++turn.current
    try {
      const result = await meeting.survey(matchId)
      if (alive.current && request === turn.current) { setState(result); setError('') }
    } catch (reason) { if (alive.current && request === turn.current) setError(reason instanceof Error ? reason.message : 'Не удалось получить результат встречи') }
  }, [matchId, meeting])
  useEffect(() => {
    alive.current = true
    queueMicrotask(() => { if (alive.current) void load() })
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    const interval = window.setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    return () => { alive.current = false; invalidate(); window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [load, invalidate])
  const resultKey = state ? `${state.availability}:${state.result.result}` : null
  useEffect(() => {
    if (resultKey && previousResult.current && resultKey !== previousResult.current) onSaved?.()
    previousResult.current = resultKey
  }, [resultKey, onSaved])
  if (state?.availability === 'upcoming' || state?.availability === 'not_scheduled') return null
  const own = state?.own_answer
  const label = state?.result.result === 'insufficient'
    ? own?.submitted ? 'Ожидаем ответ второго участника' : 'Остался твой ответ'
    : state ? meetingLabels[state.result.result] : 'Загружаем ответы…'
  return <section className="meeting-feedback" aria-label="Итоги встречи">
    <h2>Итоги встречи</h2>
    <p role="status" className="meeting-result">{state?.availability === 'cancelled' ? 'Встреча отменена' : label}</p>
    {state && <>
      <p className="small-note">По ответам участников, без проверки факта встречи</p>
      <p>{own?.submitted ? 'Твой ответ сохранён' : own ? 'Твой ответ ещё не завершён' : 'Ты ещё не ответил'}</p>
      {own?.submitted && <p className="small-note">Твой ответ: {own.met ? `Да · оценка ${own.rating} из 5` : 'Нет'}</p>}
      {state.availability === 'expired' && <p className="small-note">Срок изменения ответа прошёл</p>}
      {state.availability === 'unavailable' && <p className="small-note">Опрос сейчас недоступен</p>}
      {state.can_answer && own?.submitted && !editing && <button type="button" className="text-link" onClick={() => { setMet(own.met); setRating(own.rating === null ? '' : String(own.rating)); setComment(own.comment ?? ''); setEditing(true); setError('') }}>Изменить ответ</button>}
      {state.can_answer && (!own?.submitted || editing) && <form className="meeting-feedback-form" onSubmit={async event => {
        event.preventDefault()
        if (busy.current || met === null || met && !rating) return
        busy.current = true; setSaving(true); setError(''); const request = ++turn.current
        try {
          const result = await meeting.saveFeedback(matchId, { met, rating: met ? Number(rating) : null, comment: met ? comment.trim() || null : null })
          if (alive.current && request === turn.current) { setState(result); setEditing(false) }
        } catch (reason) { if (alive.current && request === turn.current) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить ответ') }
        finally { busy.current = false; if (alive.current) setSaving(false) }
      }}>
        <div role="group" aria-label="Вы встретились?" className="plan-actions"><span>Вы встретились?</span>{[true, false].map(value => <button key={String(value)} type="button" className={`chip ${met === value ? 'selected' : ''}`} aria-pressed={met === value} disabled={saving} onClick={() => setMet(value)}>{value ? 'Да' : 'Нет'}</button>)}</div>
        {met && <><label htmlFor="meeting-rating">Твоя оценка встречи</label><select id="meeting-rating" required disabled={saving} value={rating} onChange={event => setRating(event.target.value)}><option value="">Выбери от 1 до 5</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select><label htmlFor="meeting-comment">Комментарий · необязательно</label><textarea id="meeting-comment" rows={3} maxLength={2000} disabled={saving} value={comment} onChange={event => setComment(event.target.value)} /><p className="small-note">Оценка и комментарий не показываются партнёру</p></>}
        <div className="plan-actions"><button type="submit" className="button button-outline" disabled={saving || met === null || met && !rating}>{saving ? 'Сохраняем…' : 'Сохранить ответ'}</button>{editing && <button className="text-link" type="button" disabled={saving} onClick={() => setEditing(false)}>Отмена</button>}</div>
      </form>}
    </>}
    {error && <p role="alert" className="field-error">{error} <button type="button" className="text-link" disabled={saving} onClick={() => void load()}>Повторить загрузку</button></p>}
  </section>
}
