import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, MapPin } from 'lucide-react'
import { CATEGORIES } from '../data/catalogs'
import { INSPIRATION } from '../data/editorial'
import { dateLabel, isFuture, localDate } from '../lib/date'
import { CreationLimit } from '../components/PlanLimits'
import { planTextErrors } from '../lib/planRules'
import { PageHeading, Photo } from '../components/ui'
import { useAppData } from '../state/context'
import type { Plan } from '../types'

type Fields = Pick<Plan, 'title' | 'category' | 'date' | 'time' | 'place' | 'description'>
type Errors = Partial<Record<keyof Fields, string>>
const images = { 'Искусство': '/images/gallery.jpeg', 'Кофе и еда': '/images/dinner.jpeg', 'Прогулки': '/images/museum.jpeg', 'Впечатления': '/images/art.jpeg' }

export function CreatePlan() {
  const [params] = useSearchParams()
  const idea = INSPIRATION.find(i => i.id === params.get('idea'))
  const [form, setForm] = useState<Fields>(() => ({ title: idea?.planTitle ?? '', category: idea?.category ?? 'Кофе и еда', date: '', time: '', place: idea?.place ?? '', description: '' }))
  const [errors, setErrors] = useState<Errors>({})
  const [review, setReview] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const { createPlan, dailyQuota } = useAppData()
  const navigate = useNavigate()
  function update<K extends keyof Fields>(key: K, value: Fields[K]) { setForm({ ...form, [key]: value }); setErrors({ ...errors, [key]: undefined }); setSubmitError('') }
  function validate(): Errors {
    const next: Errors = {}
    if (!form.title.trim() || form.title.trim().length > 80) next.title = 'Придумай название до 80 символов'
    if (!form.place.trim() || form.place.trim().length > 160) next.place = 'Укажи место или адрес до 160 символов'
    if (!form.date) next.date = 'Выбери дату'
    if (!form.time) next.time = 'Выбери время'
    if (form.date && form.time && !isFuture(form.date, form.time)) next.date = 'Встреча должна быть в будущем. Проверь дату и время'
    if (form.description.length > 300) next.description = 'Описание должно быть не длиннее 300 символов'
    return { ...next, ...planTextErrors(form) }
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length) { setReview(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return }
    if (!review) { setReview(true); window.scrollTo(0, 0); return }
    const saved = createPlan({ ...form, title: form.title.trim(), place: form.place.trim(), description: form.description.trim(), id: `local-${crypto.randomUUID()}`, image: idea?.image ?? images[form.category], label: 'Черновик', own: true })
    if (!saved) { setSubmitError('Не удалось сохранить план: проверь содержание и доступный лимит'); return }
    navigate('/plans')
  }
  const error = (key: keyof Fields) => errors[key] ? <span className="field-error" role="alert" id={`error-${key}`}>{errors[key]}</span> : null
  return <div className="form-page"><div className="form-intro"><PageHeading eyebrow="Хорошие идеи объединяют" title={review ? 'Представь' : 'Твой план'} italic={review ? 'Вы уже там' : 'Ваша история'}>Необязательно придумывать что-то грандиозное. Иногда достаточно позвать на кофе</PageHeading><CreationLimit value={dailyQuota} /><Photo className="create-mood-image" src={idea?.image ?? images[form.category]} alt="Настроение будущей встречи" /></div><form className="form-panel" noValidate onSubmit={submit}><span className="eyebrow">{review ? '02 / Предпросмотр' : '01 / Детали встречи'}</span>{submitError && <p className="field-error" role="alert">{submitError}</p>}<h2>{review ? 'Так будет выглядеть твой план' : 'Что хочется сделать?'}</h2>{review ? <div className="plan-review"><h3>{form.title}</h3><span className="chip selected">{form.category}</span><p><CalendarDays size={17} />{dateLabel(form.date)} · {form.time}</p><p><MapPin size={17} />{form.place}</p>{form.description && <p className="review-description">{form.description}</p>}<span className="small-note">Время на твоём устройстве · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span><div className="review-note">Черновик появится в «Моих планах» до перезагрузки страницы. Публикация на сервер пока не подключена</div></div> : <div className="fields"><label className="field">Название плана<input name="title" placeholder="Например, кофе и прогулка без маршрута" maxLength={80} value={form.title} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'error-title' : undefined} onChange={e => update('title', e.target.value)} />{error('title')}</label><label className="field">Настроение<select name="category" value={form.category} onChange={e => update('category', e.target.value as Plan['category'])}>{CATEGORIES.filter(c => c !== 'Все планы').map(c => <option key={c}>{c}</option>)}</select></label><div className="field-row"><label className="field">Когда?<input name="date" type="date" min={localDate()} value={form.date} aria-invalid={!!errors.date} aria-describedby={errors.date ? 'error-date' : undefined} onChange={e => update('date', e.target.value)} />{error('date')}</label><label className="field">Во сколько?<input name="time" type="time" value={form.time} aria-invalid={!!errors.time} aria-describedby={errors.time ? 'error-time' : undefined} onChange={e => update('time', e.target.value)} />{error('time')}</label></div><p className="small-note time-note">Время устройства: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p><label className="field">Где встречаемся?<input name="place" value={form.place} maxLength={160} placeholder="Место, город или точный адрес" aria-invalid={!!errors.place} aria-describedby={errors.place ? 'error-place' : undefined} onChange={e => update('place', e.target.value)} />{error('place')}</label><label className="field">Немного деталей <span className="optional">необязательно</span><textarea name="description" rows={3} value={form.description} maxLength={300} placeholder="Что сделает этот вечер особенным?" onChange={e => update('description', e.target.value)} />{error('description')}</label></div>}<div className="form-actions">{review && <button className="button button-outline" type="button" onClick={() => setReview(false)}><ArrowLeft size={16} />Изменить</button>}<button className="button button-primary" type="submit" disabled={review && dailyQuota.remaining === 0}>{review ? 'Сохранить план' : 'Посмотреть план'}<ArrowRight size={18} /></button></div></form></div>
}
