import { ReputationBadges } from './ReputationBadges'
import { PlaceCheckCaption } from './PlaceCheckCaption'
import '../verification.css'
import { useState, type ReactNode } from 'react'
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppData } from '../state/context'
import { meetingDateLabel } from '../lib/date'
import { isActiveResponse, matchPartner, recordActions } from '../lib/recordActions'
import type { PairMatch, Plan, PlanResponse } from '../types'
import { Photo, Modal } from './ui'
import { ProfilePhoto } from './PhotoViewer'
import { RecordMenu } from './RecordMenu'
import { ArchiveResponseHistory, ResponseHistoryEntry } from './ResponseHistory'
import { SafetyMenu } from './SafetyMenu'

function ActionArrow() { return <span className="action-arrow" aria-hidden="true"><ArrowRight size={16} /></span> }
function CardFrame({ photo, alt = '', portrait, kind, children }: { photo?: string; alt?: string; portrait?: ReactNode; kind: string; children: ReactNode }) {
  return <article className={`my-plan record-card record-${kind} ${photo || portrait ? '' : 'record-no-photo'}`} data-record-kind={kind}>
    {portrait ?? (photo && <Photo src={photo} alt={alt} />)}<div className="my-plan-content">{children}</div>
  </article>
}
function MeetingMeta({ value }: { value: { startsAt?: string; timeZone?: string; date?: string; time?: string; place: string; placeCheckStatus?: import('../types').Plan['placeCheckStatus'] } }) {
  return <div className="record-meta"><p className="plan-meta"><CalendarDays size={15} /><span>{meetingDateLabel(value)}</span></p><p className="plan-meta"><MapPin size={15} /><span>{value.place}</span></p><PlaceCheckCaption value={value.placeCheckStatus} /></div>
}
export function MatchActions({ pair }: { pair: PairMatch }) {
  const location = useLocation(), origin = { returnTo: location.pathname === '/plans' ? location.pathname + location.search : '/chats' }
  const actions = recordActions({ kind: 'match', value: pair })
  return <div className="plan-actions">{actions.includes('write') && <Link className="button button-primary record-primary" to={`/match/${pair.id}/chat`} state={origin}>Написать<ActionArrow /></Link>}{actions.includes('details') && <Link className="text-link" to={`/match/${pair.id}`} state={origin}>Подробнее<ActionArrow /></Link>}</div>
}
export function OwnPlanCard({ plan, onCancel, onChange, pendingCount = 0, matchId, history = false }: { plan: Plan; onCancel: (plan: Plan) => void; onChange?: () => void; pendingCount?: number; matchId?: string | null; history?: boolean }) {
  const { busy, publishPlan } = useAppData()
  const location = useLocation(), origin = { returnTo: location.pathname + location.search }
  const actions = recordActions({ kind: 'plan', value: plan })
  const label = plan.moderation?.status === 'rejected' || plan.moderation?.status === 'blocked' ? 'Скрыт модерацией' : matchId ? 'Пара выбрана' : history && plan.publicationStatus === 'published' ? 'Время плана прошло' : plan.label
  return <CardFrame photo={plan.image} alt={plan.title} kind={plan.publicationStatus === 'draft' ? 'draft' : 'own'}>
    <div className="record-heading"><span className="plan-status">{plan.archived ? `Архив · ${label}` : label}</span>{(actions.includes('edit') || actions.includes('cancel')) && <RecordMenu>{actions.includes('edit') && <Link to={`/create?edit=${plan.id}`} state={origin}>Изменить</Link>}{actions.includes('cancel') && <button type="button" disabled={busy} onClick={() => onCancel(plan)}>Отменить план</button>}</RecordMenu>}<h2>{plan.title}</h2></div>
    <MeetingMeta value={plan} />
    {plan.archived && plan.own && <ArchiveResponseHistory planId={plan.id} />}
    <div className="plan-actions">{pendingCount > 0 ? <Link className="button button-primary record-primary" to={`/plans?tab=incoming&plan=${plan.id}`} state={origin}>Посмотреть отклики ({pendingCount})<ActionArrow /></Link> : matchId ? <Link className="text-link" to={`/match/${matchId}`} state={origin}>Подробнее о встрече<ActionArrow /></Link> : actions.includes('publish') ? <button type="button" className="button button-primary record-primary" disabled={busy} onClick={async () => { if (await publishPlan(plan)) onChange?.() }}>Опубликовать<ActionArrow /></button> : plan.publicationStatus === 'draft' && actions.includes('edit') ? <Link className="button button-primary record-primary" to={`/create?edit=${plan.id}`} state={origin}>Посмотреть черновик<ActionArrow /></Link> : !plan.archived && <Link className="text-link" to={`/people/${plan.id}`} state={origin}>Посмотреть план<ActionArrow /></Link>}</div>
  </CardFrame>
}
function PendingResponseCard({ response, onChange }: { response: PlanResponse; onChange?: () => void }) {
  const { busy, decide } = useAppData(), navigate = useNavigate()
  const location = useLocation(), origin = { returnTo: location.pathname + location.search }
  const incoming = response.viewerRole === 'author', actions = recordActions({ kind: 'response', value: response })
  const profile = response.profile
  const [showProfile, setShowProfile] = useState(false)
  return <CardFrame photo={!incoming ? profile?.photo ?? response.plan?.image : undefined} portrait={incoming ? <ProfilePhoto key={profile?.photo ?? 'missing'} src={profile?.photo ?? ''} name={profile?.name ?? 'кандидата'} /> : undefined} alt={profile?.name ?? 'Иллюстрация плана'} kind={incoming ? 'incoming' : 'outgoing'}>
    <div className="record-heading"><span className="plan-status">{incoming ? 'Полученный отклик' : 'Ожидает ответа'}</span><h2>{response.plan?.title ?? response.historyContext?.planTitle ?? 'План недоступен'}</h2></div>
    {profile && <div className="record-person-row"><p className="record-person">{profile.name}, {profile.age}</p><SafetyMenu label="Действия с анкетой" personName={profile.name} context={{ target_type: 'profile', context_type: 'response', context_id: response.id }} allowBlock onBlocked={onChange} /></div>}
    {incoming && profile && <ReputationBadges photoVerified={profile.photoVerified} experience={profile.experience} />}
    {response.plan && <MeetingMeta value={response.plan} />}
    {profile && <div className="record-additional"><p className="review-description response-bio-preview">{profile.bio}</p></div>}
    {!!actions.length && <div className="plan-actions">
      {actions.includes('accept') && <button type="button" className="button button-primary record-primary" disabled={busy} onClick={async () => { const result = await decide(response, 'accept'); if (result?.matchId) navigate(`/match/${result.matchId}`, { state: origin }) }}>Принять</button>}
      {actions.includes('decline') && <button type="button" className="text-link record-cancel" disabled={busy} onClick={async () => { if (await decide(response, 'decline')) onChange?.() }}>Отклонить</button>}
      {actions.includes('view') && <Link className="text-link" to={`/people/${response.planId}`} state={origin}>Посмотреть пару<ActionArrow /></Link>}
      {incoming && profile && <button type="button" className="text-link" onClick={() => setShowProfile(true)}>Посмотреть анкету</button>}
    </div>}
    {incoming && profile && showProfile && <Modal title={`${profile.name}, ${profile.age}`} className="candidate-profile-dialog" decoration={false} closeLabel="Закрыть анкету" onClose={() => setShowProfile(false)}><ProfilePhoto key={profile.photo} src={profile.photo} name={profile.name} /><p>{profile.bio}</p><div className="interest-tags">{profile.interests.map(interest => <span className="chip" key={interest}>{interest}</span>)}</div></Modal>}
  </CardFrame>
}
export function ResponseCard({ response, onChange }: { response: PlanResponse; onChange?: () => void }) {
  if (response.status === 'accepted' && response.match) return <MatchCard pair={response.match} />
  if (isActiveResponse(response)) return <PendingResponseCard response={response} onChange={onChange} />
  return <ResponseHistoryEntry response={response} explainRejection />
}
export function MatchCard({ pair }: { pair: PairMatch }) {
  const partner = matchPartner(pair)
  return <CardFrame photo={pair.image} alt={pair.title} kind="match">
    <div className="record-heading"><span className="plan-status">{pair.archived ? 'Архив · Мэтч' : 'Мэтч'}{pair.meetingCancelled ? ' · Встреча отменена' : ''}</span><h2>{pair.title}</h2></div>
    <p className="record-person">{partner ? `${partner.name}, ${partner.age}` : 'Анкета партнёра недоступна'}</p>
    <MeetingMeta value={pair} />{!!pair.unreadCount && <span className="plan-status" aria-label="Непрочитанные сообщения">Новых сообщений: {pair.unreadCount}</span>}
    <MatchActions pair={pair} />
    {pair.archived && pair.viewerRole === 'author' && <ArchiveResponseHistory planId={pair.planId} />}
  </CardFrame>
}
