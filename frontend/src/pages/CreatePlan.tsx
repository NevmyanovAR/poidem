import { useCallback, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, MapPin } from 'lucide-react'
import { CATEGORIES } from '../data/catalogs'
import type { EditorialIdea } from '../api/admin'
import { useResource } from '../components/admin/common'
import { CATEGORY_CODES } from '../data/catalogs'
import { meetingDateLabel, isFuture, localDate } from '../lib/date'
import { CreationLimit } from '../components/PlanLimits'
import { planTextErrors } from '../lib/planRules'
import { EmptyState, PageHeading, Photo } from '../components/ui'
import { useAppData } from '../state/context'
import type { Plan } from '../types'

type Fields = Pick<Plan, 'title' | 'category' | 'date' | 'time' | 'place' | 'description'>
type Errors = Partial<Record<keyof Fields, string>>
const images = { 'Искусство': '/images/gallery.jpeg', 'Кофе и еда': '/images/dinner.jpeg', 'Прогулки': '/images/museum.jpeg', 'Впечатления': '/images/art.jpeg' }

export function CreatePlan() {
  const [params] = useSearchParams()
  const { plans, plansLoading, authorization, editorial } = useAppData()
  const ideaId = params.get('idea')
  const loadIdea = useCallback(() => ideaId ? editorial.idea(ideaId) : Promise.resolve(null), [editorial, ideaId])
  const ideaResource = useResource(ideaId ?? '', loadIdea)
  const editingId = params.get('edit')
  const editingPlan = plans.find(plan => plan.id === editingId)
  if (editingId && !editingPlan) {
    if (plansLoading || authorization.status === 'checking') return <p role="status">Загружаем план…</p>
    return <EmptyState title="Этот план недоступен" action="К моим планам" to="/plans">Открой собственный план из списка</EmptyState>
  }
  if (ideaId && !editingId && !ideaResource.data) {
    return <div className="form-page"><div>{ideaResource.error ? <><p role="alert">{ideaResource.error}</p><button className="text-link" onClick={ideaResource.refresh}>Повторить загрузку идеи</button></> : <p role="status">Загружаем идею…</p>}<Link className="text-link" to="/inspiration">К вдохновению</Link></div></div>
  }
  return <PlanEditor idea={ideaResource.data ?? undefined} key={`${editingPlan?.id ?? ideaId ?? 'new'}:${editingPlan?.serverVersion ?? 0}`} editingPlan={editingPlan} />
}

function PlanEditor({ editingPlan, idea }: { editingPlan?: Plan; idea?: EditorialIdea }) {
  const [form, setForm] = useState<Fields>(() => {
    if (editingPlan?.startsAt) {
      const value = new Date(editingPlan.startsAt)
      return { ...editingPlan, date: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`, time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}` }
    }
    return { title: idea?.plan_title ?? '', category: (Object.entries(CATEGORY_CODES).find(([, code]) => code === idea?.category_code)?.[0] as Plan['category']) ?? 'Кофе и еда', date: '', time: '', place: idea?.place ?? '', description: '' }
  })
  const [validationErrors, setErrors] = useState<Errors>({})
  const textErrors = useMemo(() => planTextErrors(form), [form])
  const errors: Errors = { ...validationErrors, ...textErrors }
  const [review, setReview] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const { createPlan, editPlan, dailyQuota, authorization, data, busy, planError, plansError, plansLoading, refreshPlans, editorial } = useAppData()
  const requestKey = useRef(crypto.randomUUID())
  const navigate = useNavigate()
  function update<K extends keyof Fields>(key: K, value: Fields[K]) { setForm({ ...form, [key]: value }); setErrors({ ...validationErrors, [key]: undefined }); setSubmitError(''); requestKey.current = crypto.randomUUID() }
  function validate(): Errors {
    const next: Errors = {}
    if (!form.title.trim() || form.title.trim().length > 80) next.title = 'Придумай название до 80 символов'
    if (!form.place.trim() || form.place.trim().length > 160) next.place = 'Укажи место или адрес до 160 символов'
    if (!form.date) next.date = 'Выбери дату'
    if (!form.time) next.time = 'Выбери время'
    if (form.date && form.time && !isFuture(form.date, form.time)) next.date = 'Встреча должна быть в будущем. Проверь дату и время'
    if (form.description.length > 300) next.description = 'Описание должно быть не длиннее 300 символов'
    return next
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    const validation = validate()
    const next = { ...validation, ...textErrors }
    setErrors(validation)
    if (Object.keys(next).length) { setReview(false); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return }
    if (!review) { setReview(true); window.scrollTo(0, 0); return }
    if (authorization.status !== 'verified' || !data.profile) { setSubmitError('Для сохранения плана войди через Telegram и заполни анкету'); return }
    const fields = { title: form.title, category: form.category, date: form.date, time: form.time, place: form.place, description: form.description }
    const saved = editingPlan ? await editPlan(editingPlan, fields) : await createPlan(fields, requestKey.current)
    if (!saved) { setSubmitError('Не удалось сохранить план: проверь содержание и доступный лимит'); return }
    navigate('/plans')
  }
  const error = (key: keyof Fields) => errors[key] ? <span className="field-error" role="alert" id={`error-${key}`}>{errors[key]}</span> : null
  return <div className="form-page"><div className="form-intro"><PageHeading eyebrow="Хорошие идеи объединяют" title={review ? 'Представь' : 'Твой план'} italic={review ? 'Вы уже там' : 'Ваша история'}>Необязательно придумывать что-то грандиозное. Иногда достаточно позвать на кофе</PageHeading><CreationLimit value={dailyQuota} />{plansError && <><p role="alert" className="field-error">{plansError}</p><button type="button" className="text-link" disabled={plansLoading} onClick={() => void refreshPlans()}>Повторить загрузку лимита</button></>}<Photo className="create-mood-image" src={idea?.image ? editorial.mediaUrl(idea.image) : images[form.category]} alt="Настроение будущей встречи" /></div><form className="form-panel" noValidate onSubmit={submit}><span className="eyebrow">{review ? '02 / Предпросмотр' : '01 / Детали встречи'}</span>{submitError && <p className="field-error" role="alert">{planError || submitError}</p>}<h2>{review ? 'Так будет выглядеть твой план' : 'Что хочется сделать?'}</h2>{review ? <div className="plan-review"><h3>{form.title}</h3><span className="chip selected">{form.category}</span><p><CalendarDays size={17} />{meetingDateLabel(form)}</p><p><MapPin size={17} />{form.place}</p>{form.description && <p className="review-description">{form.description}</p>}<span className="small-note">Время на твоём устройстве</span><div className="review-note">{editingPlan?.published ? 'Изменения будут видны в каталоге после сохранения' : editingPlan ? 'Изменения сохранятся на сервере' : 'План сохранится на сервере. Опубликовать его можно в «Моих планах»'}</div></div> : <div className="fields"><label className="field">Название плана<input name="title" disabled={busy} placeholder="Например, кофе и прогулка без маршрута" maxLength={80} value={form.title} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'error-title' : undefined} onChange={e => update('title', e.target.value)} />{error('title')}</label><label className="field">Настроение<select name="category" disabled={busy} value={form.category} onChange={e => update('category', e.target.value as Plan['category'])}>{CATEGORIES.filter(c => c !== 'Все планы').map(c => <option key={c}>{c}</option>)}</select></label><div className="field-row"><label className="field">Когда?<input name="date" disabled={busy} type="date" min={localDate()} value={form.date} aria-invalid={!!errors.date} aria-describedby={errors.date ? 'error-date' : undefined} onChange={e => update('date', e.target.value)} />{error('date')}</label><label className="field">Во сколько?<input name="time" disabled={busy} type="time" value={form.time} aria-invalid={!!errors.time} aria-describedby={errors.time ? 'error-time' : undefined} onChange={e => update('time', e.target.value)} />{error('time')}</label></div><p className="small-note time-note">Дата и время по часовому поясу устройства</p><label className="field">Где встречаемся?<input name="place" disabled={busy} value={form.place} maxLength={160} placeholder="Место, город или точный адрес" aria-invalid={!!errors.place} aria-describedby={errors.place ? 'error-place' : undefined} onChange={e => update('place', e.target.value)} />{error('place')}</label><label className="field">Немного деталей <span className="optional">необязательно</span><textarea name="description" disabled={busy} rows={3} aria-invalid={!!errors.description} aria-describedby={errors.description ? "error-description" : undefined} value={form.description} maxLength={300} placeholder="Что сделает этот вечер особенным?" onChange={e => update('description', e.target.value)} />{error('description')}</label></div>}<div className="form-actions">{review && <button className="button button-outline" type="button" disabled={busy} onClick={() => setReview(false)}><ArrowLeft size={16} />Изменить</button>}<button className="button button-primary" type="submit" disabled={busy || Object.keys(textErrors).length > 0 || (review && !editingPlan && (!dailyQuota.ready || dailyQuota.remaining === 0))}>{busy ? 'Сохраняем…' : review ? editingPlan ? 'Сохранить изменения' : 'Сохранить план' : 'Посмотреть план'}<ArrowRight size={18} /></button></div></form></div>
}
