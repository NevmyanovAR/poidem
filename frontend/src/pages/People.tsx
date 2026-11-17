import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, Check, Heart, MapPin, RotateCcw } from 'lucide-react'
import { DEMO_PEOPLE } from '../data/demo'
import { EmptyState, Photo } from '../components/ui'
import { useDemo } from '../state/context'
import { dateLabel } from '../lib/date'
import type { DemoPerson, Profile } from '../types'

function compatible(person: DemoPerson, profile: Profile | null): boolean {
  if (!profile) return true
  const accepts = (preference: string, gender: string) => preference === 'any' || (preference === 'men' && gender === 'man') || (preference === 'women' && gender === 'woman')
  return accepts(profile.preference, person.gender) && accepts(person.preference, profile.gender)
}

export function People() {
  const { planId } = useParams()
  const { data, plans, invite, simulateReply } = useDemo()
  const navigate = useNavigate()
  const [skipped, setSkipped] = useState<string[]>([])
  const plan = plans.find(p => p.id === planId)
  if (!plan) return <EmptyState title="Этот план не найден" action="Выбрать другой" to="/catalog">Вернись к каталогу и выбери другой план.</EmptyState>
  const people = plan.own ? [] : DEMO_PEOPLE.filter(p => p.scenarios.includes(plan.id) && compatible(p, data.profile))
  const person = people.find(p => !skipped.includes(p.id))
  if (!person) return <><Link className="back-link" to="/catalog"><ArrowLeft size={16} />Все планы</Link><EmptyState title={plan.own ? 'Твой план ждёт свою историю' : 'На сегодня это все'} action={plan.own ? 'К моим планам' : 'Выбрать другой план'} to={plan.own ? '/plans' : '/catalog'}>{plan.own ? 'Ты сохранил свою идею. Пока здесь нет подходящих анкет.' : 'Для этого плана больше нет подходящих анкет. Можно выбрать другой план.'}</EmptyState>{!plan.own && people.length > 0 && <button className="text-link center-link" onClick={() => setSkipped([])}><RotateCcw size={16} />Посмотреть анкеты заново</button>}</>
  const sent = data.invites.find(i => i.planId === plan.id && i.personId === person.id)
  return <div className="people-page"><div className="people-top"><Link className="back-link" to="/catalog"><ArrowLeft size={16} />К планам</Link><span className="small-note">{people.indexOf(person) + 1} / {people.length} анкет</span></div><div className="person-layout"><div className="person-photo"><Photo src={person.photo} alt={`${person.name}`} eager /><div className="person-photo-caption"><span>Тоже хочет</span><h2>{plan.title}</h2></div></div><div className="person-details"><span className="eyebrow">Уже есть кое-что общее</span><h1>{person.name}<span>, {person.age}</span><Heart className="person-heart" /></h1><p className="person-bio">{person.bio}</p><div className="interest-chips">{person.interests.map(i => <span className={`chip ${data.profile?.interests.includes(i) ? 'common-interest' : ''}`} key={i}>{data.profile?.interests.includes(i) && <Check size={13} />}{i}</span>)}</div><div className="shared-plan"><span className="eyebrow">Ваш возможный план</span><h3>{plan.title}</h3><p><CalendarDays size={16} />{dateLabel(plan.date)} · {plan.time}</p><p><MapPin size={16} />{plan.place}</p></div>
      {sent ? <div className="waiting-panel" role="status"><span className="eyebrow">{sent.status === 'matched' ? 'Вы выбрали друг друга' : 'Первый шаг сделан'}</span><p>{sent.status === 'matched' ? 'Ваш общий план уже ждёт.' : 'Твоего «Пойдём?» пока недостаточно. Нужен ответ второго человека.'}</p><button className="button button-primary" onClick={() => { if (sent.status === 'waiting') simulateReply(sent.id); navigate(`/match/${sent.id}`) }}>Посмотреть совпадение<Heart size={17} /></button></div> : <button className="button button-primary invite-button" onClick={() => invite(plan.id, person.id)}>Пойдём?<Heart size={19} /></button>}
      <button className="button button-outline next-button" onClick={() => setSkipped([...skipped, person.id])}>Следующий<ArrowRight size={18} /></button>
    </div></div></div>
}
