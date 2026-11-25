import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, MapPin, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SafetyMenu } from './SafetyMenu'
import type { PublishedPlan } from '../types'
import { ModerationStatus } from './TrustStatus'
import { meetingDateLabel } from '../lib/date'

export function Glasses({ className = '' }: { className?: string }) {
  return <img className={`brand-glasses ${className}`} src="/brand/logo_glasses.png" width={1774} height={887} alt="" aria-hidden="true" />
}

export function Brand({ to = '/home' }: { to?: string }) {
  return <Link className="brand" to={to} aria-label="Пойдём? — на главную"><img src="/brand/logo_text.png" width={2048} height={682} alt="Пойдём? — знакомства по сценарию" /></Link>
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

export function PlanCard({ plan, onSelect }: { plan: PublishedPlan; onSelect?: () => void }) {
  return <article className="plan-card">
    <div className="plan-photo-frame"><Link className="card-photo" to={`/people/${plan.id}`} onClick={onSelect} aria-label={`Выбрать план «${plan.title}»`}>
      <Photo src={plan.image} alt={plan.title} />
      <span className="photo-tag">{plan.label}</span>
      <span className="photo-arrow"><ArrowRight size={21} /></span>
    </Link>{!plan.own && <SafetyMenu label="Действия с планом" personName={plan.author.name} context={{ target_type: 'plan', context_type: 'plan', context_id: plan.id }} allowBlock />}</div>
    <div className="plan-content"><span className="eyebrow card-category">{plan.category}</span><h2><Link to={`/people/${plan.id}`} onClick={onSelect}>{plan.title}</Link></h2>
      <p className="plan-meta"><CalendarDays size={15} />{meetingDateLabel(plan)}</p>
      <p className="plan-meta"><MapPin size={15} />{plan.place}</p>
      <ModerationStatus value={plan.moderation} /><div className="card-bottom"><span className="people-caption">Автор: {plan.author.name}</span><Link className="text-link" to={`/people/${plan.id}`} onClick={onSelect}>Пойдём? <span className="action-arrow" aria-hidden="true"><ArrowRight size={16} /></span></Link></div>
    </div>
  </article>
}

export function EmptyState({ title, children, action, to }: { title: string; children: ReactNode; action: string; to: string }) {
  return <div className="empty-state"><div className="empty-art"><Glasses /></div><h2>{title}</h2><p>{children}</p><Link className="button button-primary" to={to}>{action}<ArrowRight size={18} /></Link></div>
}

export function Modal({ title, children, onClose, closeLabel = 'Понятно', className = '', decoration = true }: { title: string; children: ReactNode; onClose: () => void; closeLabel?: string; className?: string; decoration?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className={`modal ${className}`} onCancel={event => { event.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) onClose() }} aria-labelledby="modal-title"><div className="modal-content">{decoration && <Sparkles className="sky" size={30} />}<h2 id="modal-title">{title}</h2>{children}<button type="button" className="button button-primary" onClick={onClose}>{closeLabel}</button></div></dialog>
}
