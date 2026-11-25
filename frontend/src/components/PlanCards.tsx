import type { ReactNode } from 'react'
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppData } from '../state/context'
import { meetingDateLabel } from '../lib/date'
import { isActiveResponse, matchPartner, recordActions } from '../lib/recordActions'
import type { PairMatch, Plan, PlanResponse } from '../types'
import { Photo } from './ui'
import { ModerationStatus } from './TrustStatus'
import { ArchiveResponseHistory, ResponseHistoryEntry } from './ResponseHistory'
import { SafetyMenu } from './SafetyMenu'

function ActionArrow() { return <span className="action-arrow" aria-hidden="true"><ArrowRight size={16} /></span> }
function CardFrame({ photo, alt = '', kind, children }: { photo?: string; alt?: string; kind: string; children: ReactNode }) {
  return <article className={`my-plan record-card record-${kind} ${photo ? '' : 'record-no-photo'}`} data-record-kind={kind}>
    {photo && <Photo src={photo} alt={alt} />}<div className="my-plan-content">{children}</div>
  </article>
}
function MeetingMeta({ value }: { value: { startsAt?: string; timeZone?: string; date?: string; time?: string; place: string } }) {
  return <div className="record-meta"><p className="plan-meta"><CalendarDays size={15} /><span>{meetingDateLabel(value)}</span></p><p className="plan-meta"><MapPin size={15} /><span>{value.place}</span></p></div>
}
export function MatchActions({ pair }: { pair: PairMatch }) {
  const actions = recordActions({ kind: 'match', value: pair })
  return <div className="plan-actions">{actions.includes('write') && <Link className="button button-primary record-primary" to={`/match/${pair.id}/chat`}>Написать<ActionArrow /></Link>}{actions.includes('details') && <Link className="text-link" to={`/match/${pair.id}`}>Подробнее<ActionArrow /></Link>}</div>
}
export function OwnPlanCard({ plan, onCancel, onChange }: { plan: Plan; onCancel: (plan: Plan) => void; onChange?: () => void }) {
  const { busy, publishPlan } = useAppData()
  const actions = recordActions({ kind: 'plan', value: plan })
  return <CardFrame photo={plan.image} alt={plan.title} kind={plan.publicationStatus === 'draft' ? 'draft' : 'own'}>
    <div className="record-heading"><span className="plan-status">{plan.archived ? `Архив · ${plan.label}` : plan.label}</span><h2>{plan.title}</h2></div>
    <ModerationStatus value={plan.moderation} serverVerified /><MeetingMeta value={plan} />
    {plan.archived && plan.own && <ArchiveResponseHistory planId={plan.id} />}
    {!!actions.length && <div className="record-action-groups">
      <div className="plan-actions">{actions.includes('status') && <Link className="text-link" to={`/people/${plan.id}`}>Посмотреть статус<ActionArrow /></Link>}{actions.includes('incoming') && <Link className="text-link" to={`/plans?tab=incoming&plan=${plan.id}`}>Полученные отклики</Link>}</div>
      <div className="plan-actions record-secondary-actions">{actions.includes('edit') && <Link className="text-link" to={`/create?edit=${plan.id}`}>Изменить</Link>}{actions.includes('publish') && <button type="button" className="text-link" disabled={busy} onClick={async () => { if (await publishPlan(plan)) onChange?.() }}>Опубликовать</button>}{actions.includes('cancel') && <button type="button" className="text-link record-cancel" disabled={busy} onClick={() => onCancel(plan)}>Отменить план</button>}</div>
    </div>}
  </CardFrame>
}
function PendingResponseCard({ response, onChange }: { response: PlanResponse; onChange?: () => void }) {
  const { busy, decide } = useAppData(), navigate = useNavigate()
  const incoming = response.viewerRole === 'author', actions = recordActions({ kind: 'response', value: response })
  const profile = response.profile
  return <CardFrame photo={profile?.photo ?? response.plan?.image} alt={profile?.name ?? 'Иллюстрация плана'} kind={incoming ? 'incoming' : 'outgoing'}>
    <div className="record-heading"><span className="plan-status">{incoming ? 'Полученный отклик' : 'Ожидает ответа'}</span><h2>{response.plan?.title ?? response.historyContext?.planTitle ?? 'План недоступен'}</h2></div>
    {profile && <div className="record-person-row"><p className="record-person">{profile.name}, {profile.age}</p><SafetyMenu label="Действия с анкетой" personName={profile.name} context={{ target_type: 'profile', context_type: 'response', context_id: response.id }} allowBlock onBlocked={onChange} /></div>}
    {response.plan && <MeetingMeta value={response.plan} />}
    {profile && <div className="record-additional"><p className="review-description">{profile.bio}</p><div className="interest-tags">{profile.interests.map(interest => <span className="chip" key={interest}>{interest}</span>)}</div></div>}
    {!!actions.length && <div className="plan-actions">
      {actions.includes('accept') && <button type="button" className="button button-primary record-primary" disabled={busy} onClick={async () => { const result = await decide(response, 'accept'); if (result?.matchId) navigate(`/match/${result.matchId}`) }}>Принять</button>}
      {actions.includes('decline') && <button type="button" className="text-link record-cancel" disabled={busy} onClick={async () => { if (await decide(response, 'decline')) onChange?.() }}>Отклонить</button>}
      {actions.includes('view') && <Link className="text-link" to={`/people/${response.planId}`}>Посмотреть пару<ActionArrow /></Link>}
    </div>}
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
