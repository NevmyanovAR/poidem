import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ChevronDown, Heart, MapPin, UserRound } from 'lucide-react'
import { EmptyState } from '../components/ui'
import { useAppData } from '../state/context'
import type { PublicProfile, PublishedPlan, ResponseCapacity } from '../types'
import { meetingDateLabel } from '../lib/date'
import { SafetyMenu } from '../components/SafetyMenu'
import { ExperienceCaption } from '../components/MeetingFeedback'

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
  return <section className="people-page plan-detail-page">
    <div className="plan-detail-toolbar"><Link className="back-link" to={plan.own ? '/plans' : '/catalog'}><ArrowLeft size={16} />{plan.own ? 'Мои планы' : 'Все планы'}</Link><div className="person-heading-actions"><Heart className="person-heart" aria-hidden="true" />{!plan.own && <SafetyMenu label="Действия с анкетой" personName={profile.name} context={{ target_type: 'profile', context_type: 'plan', context_id: plan.id }} allowBlock />}</div></div>
    <div className="person-layout">
      <AuthorPhoto key={profile.photo} src={profile.photo} name={profile.name} />
      <div className="person-details">
        <h1>{profile.name}<span>, {profile.age}</span></h1>
        <ExperienceCaption value={profile.experience} />
        <section className="person-plan" aria-label="План встречи"><h2>{plan.title}</h2><p><CalendarDays size={16} /><span>{meetingDateLabel(plan)}</span></p><p><MapPin size={16} /><span>{plan.place}</span></p></section>
        <div className="person-response">
        {plan.own ? <Link className="button button-outline invite-button" to="/plans">Управлять планом</Link> : <>
          {capacity.ownResponseId ? <div className="waiting-panel"><span className="eyebrow">Ожидает ответа</span><p>Автор увидит твою анкету и сможет принять или отклонить отклик</p><Link className="button button-outline" to="/plans?tab=outgoing">Мои отклики</Link></div> : <button type="button" className="button button-primary invite-button" disabled={busy || !capacity.canRespond} onClick={async () => {
            const response = await respond(plan, requestKey.current)
            if (response) await reload()
          }}>{busy ? 'Отправляем…' : 'Пойдём?'}<Heart size={18} /></button>}
          {!capacity.canRespond && !capacity.ownResponseId && <p className="small-note">{capacity.remaining === 0 ? 'На план уже ожидают ответа 15 человек' : 'Сейчас откликнуться на этот план нельзя'}</p>}
          {capacity.count > 0 && <p className="small-note">Ожидают ответа: {capacity.count} из {capacity.maximum}</p>}
        </>}
        </div>
        {(connectionsError || error) && <p role="alert" className="field-error">{connectionsError || error}</p>}
        <div className="person-utilities"><button type="button" className="text-link" disabled={busy} onClick={() => void reload()}>Обновить план</button>{!plan.own && <Link className="text-link" to="/catalog">Следующий план</Link>}</div>
        <details className="person-more"><summary>Об авторе и плане<ChevronDown size={16} aria-hidden="true" /></summary><p className="person-bio">{profile.bio}</p><div className="interest-tags">{profile.interests.map(interest => <span className="chip common-interest" key={interest}>{interest}</span>)}</div><h3>Подробности плана</h3><p>{plan.description}</p></details>
      </div>
    </div>
  </section>
}

function AuthorPhoto({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(!src)
  return <div className="person-photo">{failed ? <div className="person-photo-placeholder" role="img" aria-label="Фотография автора недоступна"><UserRound size={56} aria-hidden="true" /><span>Фото пока недоступно</span></div> : <img src={src} alt={`Фотография ${name}`} loading="eager" decoding="async" onError={() => setFailed(true)} />}</div>
}
