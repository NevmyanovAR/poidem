import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Heart, MapPin } from 'lucide-react'
import { DEMO_PEOPLE, DEMO_RELIABILITY } from '../data/demo'
import { ResponseLimit } from '../components/PlanLimits'
import { ModerationStatus, ReliabilityStatus } from '../components/TrustStatus'
import { EmptyState, Photo } from '../components/ui'
import { useDemo } from '../state/context'
import { dateLabel } from '../lib/date'
import { isProfileReady } from '../lib/profile'

export function People() {
  const { planId } = useParams()
  const { data, plans, publishedPlans, fixtureMode, invite, respondToInvite, publishPlan, simulateIncoming, responseInfo } = useDemo()
  const navigate = useNavigate()
  const plan = plans.find(p => p.id === planId)
  if (!plan) return <EmptyState title="Этот план не найден" action="Выбрать другой" to="/catalog">Вернись к каталогу и выбери другой план</EmptyState>
  const ready = isProfileReady(data.profile)
  const capacity = responseInfo(plan.id)
  const moderationBlocksPublication = !!plan.moderation && ['pending', 'rejected', 'blocked'].includes(plan.moderation.status)

  if (plan.own && (!fixtureMode || !plan.published)) {
    return <><Link className="back-link" to="/catalog"><ArrowLeft size={16} />Все планы</Link>
      <EmptyState title="Черновик сохранён" action="К моим планам" to="/plans">План сохранён только на этом устройстве и пока не опубликован</EmptyState>
      <ModerationStatus value={plan.moderation} />
      {fixtureMode && (ready ? <button className="button button-primary center-link" disabled={moderationBlocksPublication} onClick={() => publishPlan(plan.id)}>Опубликовать в деморежиме<ArrowRight size={18} /></button> : <Link className="text-link center-link" to="/profile">Заполнить анкету для публикации<ArrowRight size={18} /></Link>)}
    </>
  }

  if (plan.own) {
    const response = data.invites.find(i => i.planId === plan.id && i.direction === 'incoming')
    const candidate = DEMO_PEOPLE.find(person => person.id === response?.personId)
    return <div className="people-page"><Link className="back-link" to="/plans"><ArrowLeft size={16} />К моим планам</Link>
      <div className="person-layout"><div className="person-photo"><Photo src={plan.image} alt={plan.title} eager /></div>
        <div className="person-details own-plan-details"><span className="eyebrow">Твой план · деморежим</span><h1>{plan.title}</h1><p className="person-bio">{plan.description}</p>
          <ModerationStatus value={plan.moderation} /><ResponseLimit value={capacity} /><div className="shared-plan"><p><CalendarDays size={16} />{dateLabel(plan.date)} · {plan.time}</p><p><MapPin size={16} />{plan.place}</p></div>
          {!response ? <div className="waiting-panel"><p>План опубликован только для демонстрации. Можно показать отклик вымышленного персонажа</p><button className="button button-primary" disabled={capacity?.full} onClick={() => simulateIncoming(plan.id)}>Показать тестовый отклик<Heart size={17} /></button></div> :
            <section className="response-card" aria-label="Отклик на твой план">
              {candidate && <><div className="response-person"><Photo src={candidate.photo} alt={candidate.name} /><div><span className="eyebrow">Вымышленный персонаж</span><h2>{candidate.name}, {candidate.age}</h2></div></div><p>{candidate.bio}</p><div className="interest-chips">{candidate.interests.map(interest => <span className="chip" key={interest}>{interest}</span>)}</div></>}
              {response.status === 'waiting' ? <><p>Хочет пойти с тобой. Принять отклик?</p><button className="button button-primary" onClick={() => { respondToInvite(response.id, true); navigate(`/match/${response.id}`) }}>Принять отклик<Heart size={17} /></button><button className="button button-outline next-button" onClick={() => respondToInvite(response.id, false)}>Отклонить отклик</button></> :
                response.status === 'matched' ? <Link className="button button-primary" to={`/match/${response.id}`}>Посмотреть совпадение<Heart size={17} /></Link> : <p role="status">Отклик отклонён</p>}
            </section>}
        </div></div></div>
  }

  const publication = publishedPlans.find(p => p.id === plan.id)
  const person = fixtureMode ? DEMO_PEOPLE.find(p => p.id === publication?.author.id) : undefined
  if (!person) return <EmptyState title="Анкета автора недоступна" action="К планам" to="/catalog">Выбери другое предложение</EmptyState>
  const sent = data.invites.find(i => i.planId === plan.id && i.personId === person.id && i.direction === 'outgoing')
  const nextPlan = publishedPlans.find(p => !p.own && p.id !== plan.id)
  return <div className="people-page"><div className="people-top"><Link className="back-link" to="/catalog"><ArrowLeft size={16} />К планам</Link><span className="small-note">Вымышленная анкета · автор плана</span></div>
    <div className="person-layout"><div className="person-photo"><Photo src={person.photo} alt={person.name} eager /><div className="person-photo-caption"><span>Предлагает встретиться</span><h2>{plan.title}</h2></div></div>
      <div className="person-details"><span className="eyebrow">Автор твоего возможного плана</span><h1>{person.name}<span>, {person.age}</span><Heart className="person-heart" /></h1><p className="person-bio">{person.bio}</p>
        <ReliabilityStatus value={DEMO_RELIABILITY[person.id] ?? { kind: 'unavailable' }} demoMode={fixtureMode} /><div className="interest-chips">{person.interests.map(interest => <span className={`chip ${data.profile?.interests.includes(interest) ? 'common-interest' : ''}`} key={interest}>{data.profile?.interests.includes(interest) && <Check size={13} />}{interest}</span>)}</div>
        <ResponseLimit value={capacity} /><ModerationStatus value={plan.moderation} /><div className="shared-plan"><span className="eyebrow">Ваш возможный план</span><h3>{plan.title}</h3><p>{plan.description}</p><p><CalendarDays size={16} />{dateLabel(plan.date)} · {plan.time}</p><p><MapPin size={16} />{plan.place}</p></div>
        {!ready ? <Link className="button button-primary" to="/profile">Заполнить анкету<ArrowRight size={18} /></Link> :
          sent ? <div className="waiting-panel" role="status"><span className="eyebrow">{sent.status === 'matched' ? 'Вы выбрали друг друга' : sent.status === 'declined' ? 'Автор отклонил отклик' : 'Отклик отправлен'}</span>
            <p>{sent.status === 'waiting' ? 'Нужен ответ автора плана. Пока совпадения нет' : sent.status === 'matched' ? 'Ваш общий план уже ждёт' : 'Можно выбрать другой план'}</p>
            {sent.status === 'waiting' ? <><button className="button button-primary" onClick={() => { respondToInvite(sent.id, true); navigate(`/match/${sent.id}`) }}>Имитировать принятие автором<Heart size={17} /></button><button className="button button-outline next-button" onClick={() => respondToInvite(sent.id, false)}>Имитировать отказ автора</button></> :
              sent.status === 'matched' && <Link className="button button-primary" to={`/match/${sent.id}`}>Посмотреть совпадение<Heart size={17} /></Link>}
          </div> : <button className="button button-primary invite-button" disabled={capacity?.full || capacity?.alreadyResponded} onClick={() => invite(plan.id, person.id)}>Пойдём?<Heart size={19} /></button>}
        {nextPlan && <Link className="button button-outline next-button" to={`/people/${nextPlan.id}`}>Следующий план<ArrowRight size={18} /></Link>}
      </div></div></div>
}
