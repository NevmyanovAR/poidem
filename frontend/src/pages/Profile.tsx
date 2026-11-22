import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { INTERESTS } from '../data/catalogs'
import { AuthorizationStatus } from '../components/TrustStatus'
import { Modal, PageHeading, Photo } from '../components/ui'
import { useAppData } from '../state/context'
import type { Profile } from '../types'

const BLANK: Profile = { name: '', age: '', gender: '', preference: '', photo: '', bio: '', interests: [] }
type Errors = Partial<Record<keyof Profile, string>>

export function ProfilePage() {
  const { data, saveProfile, authorization, busy, deleteAccount, retryAuthorization } = useAppData()
  const [form, setForm] = useState<Profile>(() => data.profile ? { ...data.profile, interests: [...data.profile.interests] } : { ...BLANK, interests: [] })
  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<Errors>({})
  const [uploadError, setUploadError] = useState('')
  const [reading, setReading] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm(current => ({ ...current, [key]: value }))
    setErrors(current => ({ ...current, [key]: undefined }))
  }
  function validate(firstStep: boolean): Errors {
    const next: Errors = {}
    if (!form.name.trim() || form.name.trim().length > 40) next.name = 'Укажи имя: от 1 до 40 символов'
    const age = Number(form.age)
    if (!/^\d+$/.test(form.age) || !Number.isSafeInteger(age) || age < 18) next.age = 'Знакомиться здесь можно только с 18 лет'
    if (!form.gender) next.gender = 'Выбери вариант'
    if (!form.preference) next.preference = 'Выбери, кого хочешь видеть'
    if (!firstStep) {
      if (!form.photo) next.photo = 'Добавь фотографию'
      if (!form.bio.trim() || form.bio.trim().length > 300) next.bio = 'Напиши пару слов о себе: до 300 символов'
      if (form.interests.length !== 3) next.interests = 'Выбери ровно три интереса'
    }
    return next
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = validate(step === 1)
    setErrors(next)
    if (Object.keys(next).length) { requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return }
    if (step === 1) { setStep(2); window.scrollTo(0, 0); return }
    if (await saveProfile({ ...form, name: form.name.trim(), bio: form.bio.trim() }, pendingFile)) navigate('/home')
  }
  function upload(file: File | undefined) {
    if (!file) return
    setUploadError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setUploadError('Подойдёт JPG, PNG или WebP'); return }
    if (file.size > 3 * 1024 * 1024) { setUploadError('Выбери фото размером до 3 МБ'); return }
    setReading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const image = new Image()
      image.onload = () => { update('photo', result); setPendingFile(file); setReading(false) }
      image.onerror = () => { setUploadError('Не удалось прочитать изображение. Попробуй другое фото'); setReading(false) }
      image.src = result
    }
    reader.onerror = () => { setUploadError('Не удалось открыть файл. Попробуй ещё раз'); setReading(false) }
    reader.readAsDataURL(file)
  }
  const error = (key: keyof Profile) => errors[key] ? <span className="field-error" id={`error-${key}`} role="alert">{errors[key]}</span> : null

  return <div className="form-page profile-page"><div className="form-intro"><PageHeading eyebrow="Давай познакомимся" title={data.profile ? 'Твоя анкета' : 'Немного о тебе'}>Всего пара деталей, чтобы найти человека, с которым совпадёт настроение</PageHeading><div className="profile-authorization"><AuthorizationStatus value={authorization} />{authorization.status === 'error' && <button type="button" className="text-link" disabled={busy} onClick={() => void retryAuthorization()}>Повторить вход</button>}{authorization.status === 'unverified' && <a className="text-link" href={`https://t.me/${import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'ShallWeGoo_bot'}?startapp`} target="_blank" rel="noreferrer">Открыть в Telegram</a>}</div><div className="profile-editorial"><Photo src="/images/chess.jpeg" alt="Вечер за шахматами — иллюстрация" /><p>Самое интересное<br /><em>не помещается в анкету</em></p></div></div>
    <form onSubmit={submit} className="form-panel" noValidate><div className="form-progress"><span className={step === 1 ? 'current' : 'complete'}>01 <span>Знакомство</span></span><span className={step === 2 ? 'current' : ''}>02 <span>Твои интересы</span></span></div><div className="form-panel-title"><h2>{step === 1 ? 'Как тебя представить?' : 'Что тебя вдохновляет?'}</h2></div>
      {step === 1 ? <div className="fields"><label className="field">Твоё имя<input autoComplete="given-name" name="name" value={form.name} maxLength={40} placeholder="Как тебя зовут?" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'error-name' : undefined} onChange={e => update('name', e.target.value)} />{error('name')}</label><label className="field">Возраст<input name="age" inputMode="numeric" type="number" min="18" step="1" placeholder="18+" value={form.age} aria-invalid={!!errors.age} aria-describedby={errors.age ? 'error-age' : undefined} onChange={e => update('age', e.target.value)} />{error('age')}</label><label className="field">Твой пол<select name="gender" value={form.gender} aria-invalid={!!errors.gender} aria-describedby={errors.gender ? 'error-gender' : undefined} onChange={e => update('gender', e.target.value as Profile['gender'])}><option value="">Выбрать</option><option value="woman">Женский</option><option value="man">Мужской</option><option value="other">Другой</option></select>{error('gender')}</label><label className="field">Кого хочешь видеть в подборке?<select name="preference" value={form.preference} aria-invalid={!!errors.preference} aria-describedby={errors.preference ? 'error-preference' : undefined} onChange={e => update('preference', e.target.value as Profile['preference'])}><option value="">Выбрать</option><option value="women">Девушек</option><option value="men">Парней</option><option value="any">Всех</option></select>{error('preference')}</label></div> : <div className="fields"><div className="photo-field"><button type="button" className="photo-upload" onClick={() => fileRef.current?.click()} aria-label="Выбрать фотографию" aria-invalid={!!errors.photo} aria-describedby={errors.photo ? 'error-photo' : undefined}>{form.photo ? <Photo src={form.photo} alt="Предпросмотр твоей фотографии" /> : <ImagePlus size={28} />}<span><Camera size={14} /></span></button><div><strong>Одна фотография. Твоя</strong><p>JPG, PNG или WebP, до 3 МБ<br />Фото доступно только твоему аккаунту</p><button className="text-link" type="button" onClick={() => fileRef.current?.click()}>{reading ? 'Читаем фото…' : form.photo ? 'Выбрать другое фото' : 'Добавить фотографию'}</button></div><input className="sr-only" ref={fileRef} tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => upload(e.target.files?.[0])} /></div>{error('photo')}{uploadError && <p className="field-error" role="alert">{uploadError}</p>}<label className="field">Пара слов о себе<textarea name="bio" rows={3} maxLength={300} value={form.bio} aria-invalid={!!errors.bio} aria-describedby={errors.bio ? 'error-bio' : undefined} placeholder="Люблю кофе, странные фильмы и спонтанные планы…" onChange={e => update('bio', e.target.value)} /><span className="field-counter">{form.bio.length} / 300</span>{error('bio')}</label><fieldset className="interest-field"><legend>Три твоих интереса <span>{form.interests.length} / 3</span></legend><div className="interest-chips">{INTERESTS.map(interest => <button type="button" key={interest} className={`chip ${form.interests.includes(interest) ? 'selected' : ''}`} aria-pressed={form.interests.includes(interest)} aria-invalid={!!errors.interests} onClick={() => { if (form.interests.includes(interest)) update('interests', form.interests.filter(i => i !== interest)); else if (form.interests.length < 3) update('interests', [...form.interests, interest]); else { setErrors(current => ({ ...current, interests: 'Уже выбрано три. Убери один интерес, чтобы выбрать другой' })) } }}>{form.interests.includes(interest) && <Check size={13} />}{interest}</button>)}</div>{error('interests')}</fieldset></div>}
      <div className="form-actions">{step === 2 && <button type="button" className="button button-outline" onClick={() => { setStep(1); setErrors({}) }}><ArrowLeft size={17} />Назад</button>}<button className="button button-primary" type="submit" disabled={reading || busy || (step === 2 && authorization.status !== 'verified')}>{busy ? 'Сохраняем…' : step === 1 ? 'Продолжить' : 'Сохранить анкету'}<ArrowRight size={18} /></button></div><p className="form-disclaimer">Только для совершеннолетних</p>{authorization.status !== 'verified' && <p className="small-note">Для сохранения анкеты нужен вход через Telegram</p>}{authorization.status === 'verified' && <button type="button" className="quiet-button" disabled={busy} onClick={() => setShowDelete(true)}>Удалить аккаунт</button>}
    </form>{showDelete && <Modal title="Удалить аккаунт?" onClose={() => setShowDelete(false)}><p>Аккаунт «Пойдём?», анкета, фотографии и все сессии будут удалены с сервера</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => { if (await deleteAccount()) { setShowDelete(false); navigate('/') } }}>{busy ? 'Удаляем…' : 'Удалить аккаунт'}</button></Modal>}</div>
}
