import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Heart, MapPin } from 'lucide-react'
import { EmptyState, Photo } from '../components/ui'
import { useAppData } from '../state/context'
import type { PublicProfile, PublishedPlan, ResponseCapacity } from '../types'
import { meetingDateLabel } from '../lib/date'

export function People() {
  const { planId = '' } = useParams()
  const { authorization, loadPlan, loadAuthor, loadCapacity, respond, busy, connectionsError } = useAppData()
  const userId = authorization.status === 'verified' ? authorization.userId : ''
  const [screen, setScreen] = useState<{ userId: string; plan: PublishedPlan; profile: PublicProfile; capacity: ResponseCapacity } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const flight = useRef(0)
  const requestKey = useRef(crypto.randomUUID())
  const invalidate = useCallback(() => { flight.current++ }, [])
  const reload = useCallback(async () => {
    if (!userId) return
    const turn = ++flight.current
    setLoading(true); setError('')
    try {
      const [plan, profile, capacity] = await Promise.all([loadPlan(planId), loadAuthor(planId), loadCapacity(planId)])
      if (turn !== flight.current) return
      if (!capacity.ownResponseId) requestKey.current = crypto.randomUUID()
      setScreen({ userId, plan, profile, capacity })
    } catch (reason) { if (turn === flight.current) { setScreen(null); setError(reason instanceof Error ? reason.message : 'Не удалось открыть анкету') } }
    finally { if (turn === flight.current) setLoading(false) }
  }, [userId, planId, loadPlan, loadAuthor, loadCapacity])
  useEffect(() => {
    let live = true
    queueMicrotask(() => { if (live) void reload() })
    return () => { live = false; invalidate() }
  }, [reload, invalidate])
  if (authorization.status === 'checking') return <p role="status">Загружаем план…</p>
  if (!userId) return <EmptyState title="Войди, чтобы открыть план" action="Моя анкета" to="/profile">Пользовательские планы доступны после входа через Telegram</EmptyState>
  if (loading || screen && (screen.userId !== userId || screen.plan.id !== planId)) return <p role="status">Загружаем анкету…</p>
  if (!screen) return <><EmptyState title="Этот план недоступен" action="Мои планы" to="/plans">{error || 'Выбери другой план в каталоге'}</EmptyState><button type="button" className="text-link" onClick={() => void reload()}>Повторить загрузку</button></>
  const { plan, profile, capacity } = screen
  return <section className="people-page">
    <Link className="back-link" to={plan.own ? '/plans' : '/catalog'}><ArrowLeft size={16} />{plan.own ? 'Мои планы' : 'Все планы'}</Link>
    <div className="person-layout">
      <div className="person-photo"><Photo src={profile.photo} alt={profile.name} eager /><div className="person-photo-caption"><span>Сначала — что делать. Потом — с кем</span><h2>{plan.title}</h2></div></div>
      <div className="person-details"><span className="eyebrow">{plan.own ? 'Твоя анкета' : 'Анкета автора плана'}</span>
        <h1>{profile.name} <span>{profile.age}</span><Heart className="person-heart" /></h1>
        <p className="person-bio">{profile.bio}</p>
        <div className="interest-tags">{profile.interests.map(interest => <span className="chip common-interest" key={interest}>{interest}</span>)}</div>
        <div className="shared-plan"><span className="eyebrow">Ваш возможный вечер</span><h3>{plan.title}</h3><p><CalendarDays size={16} />{meetingDateLabel(plan)}</p><p><MapPin size={16} />{plan.place}</p><p>{plan.description}</p></div>
        {plan.own ? <Link className="button button-outline invite-button" to="/plans">Управлять планом</Link> : <>
          <p className="small-note">Ожидают ответа: {capacity.count} из {capacity.maximum}</p>
          {capacity.ownResponseId ? <div className="waiting-panel"><span className="eyebrow">Ожидает ответа</span><p>Автор увидит твою анкету и сможет принять или отклонить отклик</p><Link className="button button-outline" to="/plans?tab=outgoing">Мои отклики</Link></div> : <button type="button" className="button button-primary invite-button" disabled={busy || !capacity.canRespond} onClick={async () => {
            const response = await respond(plan, requestKey.current)
            if (response) await reload()
          }}>{busy ? 'Отправляем…' : 'Пойдём?'}<Heart size={18} /></button>}
          {!capacity.canRespond && !capacity.ownResponseId && <p className="small-note">{capacity.remaining === 0 ? 'На план уже ожидают ответа 15 человек' : 'Для отклика нужна доступная анкета с фотографией'}</p>}
        </>}
        {(connectionsError || error) && <p role="alert" className="field-error">{connectionsError || error}</p>}
        <button type="button" className="text-link next-button" disabled={busy} onClick={() => void reload()}>Обновить план</button>
        {!plan.own && <Link className="button button-outline next-button" to="/catalog">Следующий план</Link>}
      </div>
    </div>
  </section>
}
