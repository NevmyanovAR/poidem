import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, MapPin, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Plan } from '../types'
import { dateLabel } from '../lib/date'
import { DEMO_PEOPLE } from '../data/demo'

export function Glasses({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 160 120" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M31 39c-6 22 20 36 31 13l-31-13Zm1 0 31 13M43 63l-9 22m-10-4 20 8M98 51c8 23 36 15 31-9L98 51Zm0 0 31-9m-12 23 7 22m-9 4 19-7M66 23c-7-14 7-20 13-8 6-13 20-5 13 5L79 34 66 23ZM48 20l-7-8m15 2-3-10m58 23 10-5m-11-8 5-9M16 45l-8-2m132 17 10 4"/><path d="m25 89-8 17m118-17 9 16M26 34l6-5 33 14-2 7m35-4 1-7 28-9 6 7"/></g></svg>
}

export function Brand({ to = '/home' }: { to?: string }) {
  return <Link className="brand" to={to} aria-label="Пойдём? — на главную">пойдём<span>?</span></Link>
}

export function Photo({ src, alt, className = '', eager = false }: { src: string; alt: string; className?: string; eager?: boolean }) {
  return <img src={src} alt={alt} className={className} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={event => { const img = event.currentTarget; if (!img.dataset.fallback) { img.dataset.fallback = 'true'; img.src = '/fallback.svg' } }} />
}

export function PageHeading({ eyebrow, title, italic, children, back }: { eyebrow: string; title: string; italic?: string; children?: ReactNode; back?: string }) {
  return <div className="page-heading">
    {back && <Link className="back-link" to={back}><ArrowLeft size={16} /> Назад</Link>}
    <span className="eyebrow">{eyebrow}</span>
    <h1>{title} {italic && <em>{italic}</em>}</h1>
    {children && <div className="heading-description">{children}</div>}
  </div>
}

export function PlanCard({ plan, onSelect }: { plan: Plan; onSelect?: () => void }) {
  const count = DEMO_PEOPLE.filter(p => p.scenarios.includes(plan.id)).length
  return <article className="plan-card">
    <Link className="card-photo" to={`/people/${plan.id}`} onClick={onSelect} aria-label={`Выбрать план «${plan.title}»`}>
      <Photo src={plan.image} alt={plan.title} />
      <span className="photo-tag">{plan.label}</span>
      <span className="photo-arrow"><ArrowRight size={21} /></span>
    </Link>
    <div className="plan-content"><span className="eyebrow card-category">{plan.category}</span><h2><Link to={`/people/${plan.id}`} onClick={onSelect}>{plan.title}</Link></h2>
      <p className="plan-meta"><CalendarDays size={15} />{dateLabel(plan.date)} <span>·</span> {plan.time}</p>
      <p className="plan-meta"><MapPin size={15} />{plan.place}</p>
      <div className="card-bottom"><span className="people-caption">{plan.own ? 'Твой план' : `${count} ${count === 1 ? 'анкета' : 'анкеты'} в подборке`}</span><Link className="text-link" to={`/people/${plan.id}`} onClick={onSelect}>Пойдём? <ArrowRight size={16} /></Link></div>
    </div>
  </article>
}

export function EmptyState({ title, children, action, to }: { title: string; children: ReactNode; action: string; to: string }) {
  return <div className="empty-state"><div className="empty-art"><Glasses /></div><h2>{title}</h2><p>{children}</p><Link className="button button-primary" to={to}>{action}<ArrowRight size={18} /></Link></div>
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }} aria-labelledby="modal-title"><div className="modal-content"><Sparkles className="sky" size={30} /><h2 id="modal-title">{title}</h2>{children}<button className="button button-primary" onClick={onClose}>Понятно</button></div></dialog>
}
