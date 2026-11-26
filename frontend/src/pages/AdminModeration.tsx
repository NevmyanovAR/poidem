import { useCallback, useEffect, useRef, useState } from 'react'
import { meetingLabels } from '../api/feedback'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppData } from '../state/context'
import { EmptyState, Modal } from '../components/ui'
import { reportReasons, reportTargets } from '../api/safety'
import type { ReportDetail, SafetyReport } from '../api/safety'

export function AdminModeration() {
  const { authorization } = useAppData()
  if (authorization.status === 'checking') return <p role="status">Проверяем доступ…</p>
  if (authorization.status !== 'verified') return <EmptyState title="Войди через Telegram" action="Моя анкета" to="/profile">Этот раздел доступен только назначенному администратору</EmptyState>
  return <ModerationQueue key={authorization.userId} />
}

function ModerationQueue() {
  const [params, setParams] = useSearchParams()
  const scopeUser = params.get('user') ?? '', scopePlan = params.get('plan') ?? ''
  const [reasonFilter, setReasonFilter] = useState('')
  const { safety, notify, refreshPlans, refreshConnections } = useAppData()
  const [access, setAccess] = useState(false), [denied, setDenied] = useState('')
  const [status, setStatus] = useState(scopeUser || scopePlan ? '' : 'pending'), [type, setType] = useState('')
  const [items, setItems] = useState<SafetyReport[]>([]), [cursor, setCursor] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportDetail | null>(null), [reason, setReason] = useState('')
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  const flight = useRef(0), selection = useRef(0)
  const invalidate = useCallback(() => { flight.current++; selection.current++ }, [])
  useEffect(() => { let live = true; void safety.adminSession().then(() => { if (live) setAccess(true) }).catch(error => { if (live) setDenied(error instanceof Error ? error.message : 'Доступ недоступен') }); return () => { live = false; invalidate() } }, [safety, invalidate])
  const load = useCallback(async (next?: string) => {
    const turn = ++flight.current; setLoading(true); setError('')
    try { const page = await safety.adminReports(status, type, next, { reason: reasonFilter, user: scopeUser, plan: scopePlan }); if (turn === flight.current) { setItems(current => next ? [...current, ...page.items] : page.items); setCursor(page.next_cursor) } }
    catch (error) { if (turn === flight.current) setError(error instanceof Error ? error.message : 'Не удалось загрузить жалобы') }
    finally { if (turn === flight.current) setLoading(false) }
  }, [safety, status, type, reasonFilter, scopeUser, scopePlan])
  useEffect(() => { let live = true; queueMicrotask(() => { if (live && access) void load() }); return () => { live = false; invalidate() } }, [access, load, invalidate])
  async function choose(id: string) {
    const turn = ++selection.current; setError(''); setReason(''); setDetail(null)
    try { const row = await safety.adminReport(id); if (turn === selection.current) setDetail(row) }
    catch (error) { if (turn === selection.current) setError(error instanceof Error ? error.message : 'Жалоба недоступна') }
  }
  async function decide(action: 'dismiss' | 'hide_plan') {
    if (!detail || busy || reason.trim().length < 3) return
    setBusy(true); setError('')
    try {
      const saved = await safety.adminDecision(detail.id, action, reason.trim()); setDetail(saved); setConfirm(false)
      notify('Решение сохранено'); await load(); void refreshPlans(); void refreshConnections()
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось сохранить решение') }
    finally { setBusy(false) }
  }
  if (denied) return <EmptyState title="Доступ ограничен" action="На главную" to="/home">{denied}</EmptyState>
  if (!access) return <p role="status">Проверяем права администратора…</p>
  return <section className="admin-page"><Link className="back-link" to="/settings"><ArrowLeft size={16} />Настройки</Link><div className="page-heading"><span className="eyebrow">Безопасность</span><h1>Рассмотрение <em>жалоб</em></h1></div>
    <div className="admin-filters"><label>Статус<select value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setDetail(null); selection.current++ }}><option value="pending">Новые</option><option value="reviewed">Рассмотренные</option><option value="">Все</option></select></label><label>Тип жалобы<select value={type} disabled={busy} onChange={event => { setType(event.target.value); setDetail(null); selection.current++ }}><option value="">Все типы</option>{Object.entries(reportTargets).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><button type="button" className="text-link" disabled={loading || busy} onClick={() => void load()}>Обновить</button></div>
    <div className="admin-filters"><label>Причина<select value={reasonFilter} disabled={busy} onChange={event => { setReasonFilter(event.target.value); setDetail(null); selection.current++ }}><option value="">Любая причина</option>{Object.entries(reportReasons).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>{(scopeUser || scopePlan) && <p className="admin-id">{scopeUser ? 'Пользователь' : 'План'}: {scopeUser || scopePlan} <button className="text-link" onClick={() => setParams({ section: 'moderation' })}>Все жалобы</button></p>}</div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="admin-layout"><div className="admin-queue" aria-label="Очередь жалоб">{items.map(item => <button type="button" className={`admin-report ${detail?.id === item.id ? 'is-selected' : ''}`} key={item.id} disabled={busy} onClick={() => void choose(item.id)}><span className="eyebrow">{reportTargets[item.target_type] ?? 'Жалоба'} · {item.state === 'pending' ? 'Новая' : 'Рассмотрена'}</span><strong>{reportReasons[item.reason_code] ?? item.reason_code}</strong><time>{new Date(item.created_at).toLocaleString('ru-RU')}</time></button>)}{!loading && !items.length && <p className="small-note">Жалоб с такими фильтрами нет</p>}{loading && <p role="status">Загружаем…</p>}{cursor && <button type="button" className="text-link" disabled={loading} onClick={() => void load(cursor)}>Показать ещё</button>}</div>
    <div className="admin-detail">{detail ? <><h2>{reportReasons[detail.reason_code] ?? detail.reason_code}</h2><p className="small-note">{reportTargets[detail.target_type]} · {new Date(detail.created_at).toLocaleString('ru-RU')}</p>{detail.comment && <blockquote>{detail.comment}</blockquote>}
      <section aria-label="Контекст жалобы"><h3>Сведения на момент жалобы</h3>{detail.evidence.title && <h3>{detail.evidence.title}</h3>}{detail.evidence.name && <h3>{detail.evidence.name}, {detail.evidence.age}</h3>}{detail.evidence.photo_id && <EvidencePhoto key={detail.id} src={safety.reportPhotoUrl(detail.id)} />}{detail.evidence.bio && <p>{detail.evidence.bio}</p>}{detail.evidence.description && <p>{detail.evidence.description}</p>}{detail.evidence.place && <p>{detail.evidence.place}</p>}{detail.evidence.messages?.map(message => <blockquote key={message.id}><span className="eyebrow">{message.speaker === 'reported' ? 'Участник жалобы' : 'Отправитель жалобы'}{message.id === detail.evidence.reported_message_id ? ' · Сообщение с жалобой' : ''}</span><p>{message.text}</p><small>{new Date(message.created_at).toLocaleString('ru-RU')}</small></blockquote>)}</section>
      {detail.meeting_review && <section aria-label="Результат опроса по жалобе"><h3>Ответы о встрече</h3><p>{meetingLabels[detail.meeting_review.current.result]}</p><p className="small-note">Автор: {detail.meeting_review.current.author_answered ? 'ответил' : 'нет завершённого ответа'} · Кандидат: {detail.meeting_review.current.responder_answered ? 'ответил' : 'нет завершённого ответа'}</p>{detail.meeting_review.at_report && detail.meeting_review.at_report.result !== detail.meeting_review.current.result && <p className="small-note">При подаче жалобы: {meetingLabels[detail.meeting_review.at_report.result]}</p>}<p className="small-note">Самоотчёты не устанавливают нарушение или виновного</p></section>}
      {!!detail.decisions.length && <section><h3>История решений</h3>{detail.decisions.map((decision, index) => <div key={index}><strong>{decision.action === 'hide_plan' ? 'План скрыт' : 'Жалоба признана необоснованной'}</strong><p>{decision.reason}</p><p className="small-note">{decision.actor} · {decision.actor_id} · {new Date(decision.decided_at).toLocaleString('ru-RU')}</p></div>)}</section>}
      {detail.state === 'pending' && <div className="safety-form"><label htmlFor="moderation-reason">Причина решения</label><textarea id="moderation-reason" maxLength={1000} rows={3} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /><div className="plan-actions"><button type="button" className="button button-outline" disabled={busy || reason.trim().length < 3} onClick={() => void decide('dismiss')}>Жалоба необоснованна</button>{detail.can_hide_plan && <button type="button" className="button button-primary" disabled={busy || reason.trim().length < 3} onClick={() => setConfirm(true)}>Скрыть план</button>}</div></div>}
    </> : <p className="small-note">Выбери жалобу, чтобы посмотреть разрешённый контекст</p>}</div></div>
    {confirm && <Modal title="Скрыть нарушающий правила план?" onClose={() => { if (!busy) setConfirm(false) }}><p>План исчезнет из каталога. Мэтчи и сообщения сохранятся; встреча не будет автоматически отменена</p><button type="button" className="button button-outline" disabled={busy} onClick={() => void decide('hide_plan')}>{busy ? 'Сохраняем…' : 'Подтвердить скрытие'}</button></Modal>}
  </section>
}

function EvidencePhoto({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? <p className="small-note">Фото больше недоступно</p> : <img className="admin-evidence-photo" src={src} alt="Фотография из жалобы" onError={() => setFailed(true)} />
}
