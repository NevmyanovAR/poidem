import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CalendarDays, Heart, MapPin, Send } from 'lucide-react'
import { DEMO_PEOPLE, DEMO_PROFILE } from '../data/demo'
import { EmptyState, Glasses, Modal, Photo } from '../components/ui'
import { useDemo } from '../state/context'
import { dateLabel } from '../lib/date'

export function Match() {
  const { inviteId } = useParams()
  const { data, plans } = useDemo()
  const [contactOpen, setContactOpen] = useState(false)
  const invite = data.invites.find(i => i.id === inviteId && i.status === 'matched')
  const person = DEMO_PEOPLE.find(p => p.id === invite?.personId)
  const plan = plans.find(p => p.id === invite?.planId)
  if (!invite || !person || !plan) return <EmptyState title="Для встречи нужны двое" action="К моим планам" to="/plans">Совпадение не найдено. Вернись к своим планам.</EmptyState>
  return <div className="match-page"><div className="match-heading"><span className="eyebrow">Одно настроение. Два человека.</span><h1>Кажется, вам<br /><em>по пути.</em></h1><Glasses /></div><div className="match-portraits"><div className="match-portrait first"><Photo src={data.profile?.photo ?? DEMO_PROFILE.photo} alt="Твоя фотография" /><span>{data.profile?.name ?? 'Ты'}</span></div><div className="match-heart"><Heart size={29} fill="currentColor" /></div><div className="match-portrait second"><Photo src={person.photo} alt={`${person.name}`} /><span>{person.name}</span></div></div><p className="match-description">Вы оба сказали «Пойдём?»<br />Осталось договориться о маленьких деталях.</p><div className="match-plan"><Photo src={plan.image} alt="" /><div><span className="eyebrow">Ваш общий план</span><h2>{plan.title}</h2><p><CalendarDays size={15} />{dateLabel(plan.date)} · {plan.time}</p><p><MapPin size={15} />{plan.place}</p></div></div><button className="button button-primary match-contact" onClick={() => setContactOpen(true)}>Перейти к общению<Send size={18} /></button><Link className="text-link center-link" to="/plans">К моим планам<ArrowRight size={16} /></Link>{contactOpen && <Modal title="Общение пока недоступно" onClose={() => setContactOpen(false)}><p>Перейти к разговору в Telegram сейчас нельзя. Можно вернуться к вашим планам.</p></Modal>}</div>
}
