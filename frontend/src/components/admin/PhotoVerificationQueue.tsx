import { Modal } from '../ui'
import { useAutoRefresh } from '../../lib/autoRefresh'
import { useCallback, useState } from 'react'
import { useAppData } from '../../state/context'
import { useResource, stamp } from './common'
import { ProfilePhoto } from '../PhotoViewer'
import { verificationReasons } from '../../api/verification'
import type { VerificationDetail } from '../../api/verification'
import '../../verification.css'

export function PhotoVerificationQueue() {
  const { verification } = useAppData()
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null)
  const [state, setState] = useState('pending'), [offset, setOffset] = useState(0)
  const [chosen, setChosen] = useState<VerificationDetail | null>(null), [reason, setReason] = useState('')
  const [comment, setComment] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(() => verification.verificationQueue(state, offset), [verification, state, offset])
  const resource = useResource(`${state}:${offset}`, load)
  useAutoRefresh(resource.refresh, !busy && !chosen)
  async function choose(id: string) { setError(''); setBusy(true); try { setChosen(await verification.verificationDetail(id)); setReason(''); setComment('') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Заявка недоступна') } finally { setBusy(false) } }
  async function decide(decision: 'approved' | 'rejected') {
    if (!chosen || busy) return
    setBusy(true); setError('')
    try { await verification.verificationDecision(chosen, decision, decision === 'rejected' ? reason : undefined, decision === 'rejected' && reason === 'other' ? comment : undefined); setChosen(null); setConfirm(null); resource.refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить решение') }
    finally { setBusy(false) }
  }
  return <section className="admin-panel"><h2>Проверка фото</h2><label className="field">Статус<select value={state} disabled={busy} onChange={event => { setState(event.target.value); setOffset(0); setChosen(null) }}><option value="pending">Ожидают проверки</option><option value="approved">Одобрены</option><option value="rejected">Отклонены</option></select></label>
    {resource.loading && <p role="status">Загружаем заявки…</p>}{resource.error && <p role="alert">{resource.error} <button className="text-link" onClick={resource.refresh}>Повторить</button></p>}{error && <p role="alert" className="field-error">{error}</p>}
    {!resource.loading && resource.data?.items.length === 0 && <p>Заявок в этом списке нет</p>}
    <div className="admin-list">{resource.data?.items.map(entry => <article className="admin-panel" key={entry.id}><strong>{entry.user_name}</strong><p className="small-note">{stamp(entry.submitted_at)} · {entry.state === 'pending' ? `Ожидание: ${entry.waiting_minutes ?? 0} мин` : entry.state === 'approved' ? 'Одобрено' : 'Отклонено'}</p><button className="text-link" disabled={busy} onClick={() => void choose(entry.id)}>Открыть заявку</button></article>)}</div>
    <div className="verification-actions">{offset > 0 && <button className="text-link" disabled={busy} onClick={() => setOffset(Math.max(0, offset - 20))}>Назад</button>}{resource.data?.next_offset != null && <button className="text-link" disabled={busy} onClick={() => setOffset(resource.data!.next_offset!)}>Следующие заявки</button>}</div>
    {chosen && <section className="admin-panel verification-decision"><h3>{chosen.user_name}</h3><p>{chosen.instruction}</p><div className="verification-compare"><figure><figcaption>Фото анкеты на момент заявки</figcaption><ProfilePhoto key={chosen.primary_url} src={verification.mediaUrl(chosen.primary_url)} name="Фото анкеты на момент заявки" /></figure><figure><figcaption>Проверочное селфи</figcaption><ProfilePhoto key={chosen.selfie_url} src={verification.mediaUrl(chosen.selfie_url)} name="Проверочное селфи" /></figure></div>{!chosen.primary_url && <p>Проверочные материалы больше не хранятся</p>}
      {chosen.can_decide ? <><button className="button button-primary" disabled={busy} onClick={() => { setError(''); setConfirm('approved') }}>Подтвердить фото</button><label className="field">Причина отказа<select value={reason} disabled={busy} onChange={event => setReason(event.target.value)}><option value="">Выбери причину</option>{Object.entries(verificationReasons).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>{reason === 'other' && <label className="field">Комментарий<textarea value={comment} disabled={busy} maxLength={300} onChange={event => setComment(event.target.value)} /></label>}<button className="button button-outline" disabled={busy || !reason || reason === 'other' && !comment.trim()} onClick={() => { setError(''); setConfirm('rejected') }}>Отклонить</button></> : <p>Решение по этой заявке недоступно</p>}<button className="text-link" disabled={busy} onClick={() => setChosen(null)}>Закрыть заявку</button>
    </section>}
    {confirm && <Modal title={confirm === 'approved' ? 'Подтвердить фото?' : 'Отклонить заявку?'} decoration={false} onClose={() => { if (!busy) setConfirm(null) }}><p>{confirm === 'approved' ? 'Подтверди, что фотографии сверены и инструкция выполнена' : 'Пользователь увидит выбранную причину и сможет попробовать ещё раз'}</p><button className="button button-primary" disabled={busy} onClick={() => void decide(confirm)}>{confirm === 'approved' ? 'Подтвердить фото' : 'Отклонить заявку'}</button>{error && <p className="field-error" role="alert">{error}</p>}</Modal>}
  </section>
}
