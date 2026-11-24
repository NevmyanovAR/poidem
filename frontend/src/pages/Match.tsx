import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarDays, Heart, MapPin } from 'lucide-react'
import { EmptyState, Glasses, Photo } from '../components/ui'
import { useAppData } from '../state/context'
import type { MatchContact, PairMatch } from '../types'
import { ApiError } from '../api/client'
import { meetingDateLabel } from '../lib/date'
import { matchPartner } from '../lib/recordActions'
import { ArchiveResponseHistory } from '../components/ResponseHistory'

export function Match() {
  const { inviteId = '' } = useParams()
  const { authorization, loadMatch, loadContact } = useAppData()
  const userId = authorization.status === 'verified' ? authorization.userId : ''
  const [screen, setScreen] = useState<{ userId: string; match: PairMatch; contact: MatchContact } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const flight = useRef(0)
  const invalidate = useCallback(() => { flight.current++ }, [])
  const reload = useCallback(async () => {
    if (!userId) return
    const turn = ++flight.current
    setLoading(true); setError('')
    try {
      const [match, contact] = await Promise.all([loadMatch(inviteId), loadContact(inviteId).catch(reason => {
        if (reason instanceof ApiError && reason.status === 404) return { available: false, telegramUrl: null, reason: 'unavailable' }
        throw reason
      })])
      if (turn === flight.current) setScreen({ userId, match, contact })
    } catch (reason) { if (turn === flight.current) { setScreen(null); setError(reason instanceof Error ? reason.message : 'Совпадение недоступно') } }
    finally { if (turn === flight.current) setLoading(false) }
  }, [userId, inviteId, loadMatch, loadContact])
  useEffect(() => {
    let live = true
    queueMicrotask(() => { if (live) void reload() })
    return () => { live = false; invalidate() }
  }, [reload, invalidate])
  if (!userId && authorization.status !== 'checking') return <EmptyState title="Для встречи нужны двое" action="К моим планам" to="/plans">Совпадение не найдено. Вернись к своим планам</EmptyState>
  if (loading || screen && (screen.userId !== userId || screen.match.id !== inviteId)) return <p role="status">Загружаем совпадение…</p>
  if (!screen) return <><EmptyState title="Для встречи нужны двое" action="К моим планам" to="/plans">{error || 'Совпадение недоступно'}</EmptyState><button type="button" className="text-link" onClick={() => void reload()}>Повторить загрузку</button></>
  const { match, contact } = screen
  const partner = matchPartner(match)
  return <section className="match-page">
    <div className="match-heading"><span className="eyebrow">Вы выбрали друг друга</span><h1>Кажется, вам <em>по пути</em></h1><Glasses /></div>
    <div className="match-portraits">{match.participants.map((part, index) => <Fragment key={part.role}><div className={`match-portrait ${index ? 'second' : 'first'}`}>{part.profile ? <Photo src={part.profile.photo} alt={part.profile.name} eager /> : <div className="match-photo-unavailable">Анкета недоступна</div>}<span title={part.profile?.name}>{part.profile?.name ?? 'Участник'}</span></div>{index === 0 && <Heart className="match-heart" size={30} />}</Fragment>)}</div>
    <p className="match-description">План есть. Пара тоже. Осталось договориться о деталях</p>
    <div className="match-plan"><Photo src={match.image} alt={match.title} /><div><span className="eyebrow">Ваш план</span><h2>{match.title}</h2><p><CalendarDays size={15} />{meetingDateLabel(match)}</p><p><MapPin size={15} />{match.place}</p></div></div>
    {match.archived && match.viewerRole === 'author' && <ArchiveResponseHistory planId={match.planId} />}
    {partner && <section className="match-partner" aria-label="Анкета партнёра"><h2>{partner.name}, {partner.age}</h2><p>{partner.bio}</p><div className="interest-tags">{partner.interests.map(interest => <span className="chip" key={interest}>{interest}</span>)}</div></section>}
    {match.meetingCancelled && <p className="small-note">Встреча отменена. Переписка сохранена</p>}
    <Link className="button button-primary match-contact" to={`/match/${match.id}/chat`}>Открыть чат{match.unreadCount ? ` · ${match.unreadCount}` : ''}</Link>
    {contact.available && contact.telegramUrl && <a className="button button-outline match-contact" href={contact.telegramUrl} target="_blank" rel="noopener noreferrer" onClick={event => {
      const app = window.Telegram?.WebApp
      if (app?.openTelegramLink && contact.telegramUrl) { event.preventDefault(); app.openTelegramLink(contact.telegramUrl) }
    }}>Написать в Telegram</a>}
    <button type="button" className="text-link" onClick={() => void reload()}>Обновить данные</button>
    <p><Link className="text-link" to="/plans?tab=matches">К моим планам</Link></p>
  </section>
}
