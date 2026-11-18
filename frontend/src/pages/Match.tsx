import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CalendarDays, Heart, MapPin, Send } from 'lucide-react'
import { DEMO_PEOPLE } from '../data/demo'
import { EmptyState, Glasses, Modal, Photo } from '../components/ui'
import { useDemo } from '../state/context'
import { isProfileReady } from '../lib/profile'
import { dateLabel } from '../lib/date'

export function Match() {
  const { inviteId } = useParams()
  const { data, plans, fixtureMode } = useDemo()
  const [contactOpen, setContactOpen] = useState(false)
  const invite = fixtureMode ? data.invites.find(i => i.id === inviteId && i.status === 'matched') : undefined
  const person = DEMO_PEOPLE.find(p => p.id === invite?.personId)
  const plan = plans.find(p => p.id === invite?.planId)
  if (!invite || !person || !plan || !isProfileReady(data.profile)) return <EmptyState title="Для встречи нужны двое" action="К моим планам" to="/plans">Совпадение не найдено. Вернись к своим планам</EmptyState>
  return <div className="match-page"><div className="match-heading"><span className="eyebrow">Демонстрационное совпадение · два человека</span><h1>Кажется, вам<br /><em>по пути</em></h1><Glasses /></div><div className="match-portraits"><div className="match-portrait first"><Photo src={data.profile.photo} alt="Твоя фотография" /><span>{data.profile.name}</span></div><div className="match-heart"><Heart size={29} fill="currentColor" /></div><div className="match-portrait second"><Photo src={person.photo} alt={`${person.name}`} /><span>{person.name}</span></div></div><p className="match-description">Вы оба сказали «Пойдём?»<br />Осталось договориться о маленьких деталях</p><div className="match-plan"><Photo src={plan.image} alt="" /><div><span className="eyebrow">Ваш общий план</span><h2>{plan.title}</h2><p><CalendarDays size={15} />{dateLabel(plan.date)} · {plan.time}</p><p><MapPin size={15} />{plan.place}</p></div></div><button className="button button-primary match-contact" onClick={() => setContactOpen(true)}>Перейти к общению<Send size={18} /></button><Link className="text-link center-link" to="/plans">К моим планам<ArrowRight size={16} /></Link>{contactOpen && <Modal title="Общение пока недоступно" onClose={() => setContactOpen(false)}><p>У вымышленных персонажей нет Telegram-контактов. Демонстрационные мэтчи не отправляют уведомления</p></Modal>}</div>
}
