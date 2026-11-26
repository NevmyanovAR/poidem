import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, ChevronRight, Shield, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { ApiError } from '../api/client'
import type { BlockedUser } from '../api/safety'
import { Modal } from '../components/ui'
import { useAppData } from '../state/context'
import { ProfilePage } from './Profile'

// Черновик, выбранный File, ошибки и шаг живут только в прежнем компоненте формы.
// Переходы в настройки/блокировки/admin не размонтируют его и не пишут в хранилище.
export function ProfileSettingsFrame() {
  const { pathname } = useLocation()
  const { data, authorization } = useAppData()
  const identity = authorization.status === 'verified' ? authorization.userId : 'unverified'
  return <><div hidden={pathname !== '/profile'}><ProfilePage key={`${identity}:${data.profile?.serverVersion ?? 0}`} /></div><Outlet /></>
}

export function SettingsPage() {
  const { authorization } = useAppData()
  const identity = authorization.status === 'verified' ? authorization.userId : authorization.status
  return <SettingsContent key={identity} />
}

function SettingsContent() {
  const { authorization, safety, deleteAccount, busy, toast } = useAppData()
  const navigate = useNavigate()
  const [role, setRole] = useState<'checking' | 'admin' | 'user' | 'error'>('checking')
  const [retry, setRetry] = useState(0), [showDelete, setShowDelete] = useState(false), [deleteFailed, setDeleteFailed] = useState(false)
  const userId = authorization.status === 'verified' ? authorization.userId : ''
  useEffect(() => {
    if (!userId) return
    let live = true, turn = 0
    async function check() {
      const request = ++turn
      try { await safety.adminSession(); if (live && request === turn) setRole('admin') }
      catch (error) { if (live && request === turn) setRole(error instanceof ApiError && error.status === 403 ? 'user' : 'error') }
    }
    const visible = () => { if (document.visibilityState === 'visible') void check() }
    void check(); document.addEventListener('visibilitychange', visible)
    return () => { live = false; document.removeEventListener('visibilitychange', visible) }
  }, [userId, safety, retry])
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'ShallWeGoo_bot'
  const notificationUrl = `https://t.me/${bot}?start=notifications`
  return <section className="settings-page">
    <Link className="back-link" to="/profile"><ArrowLeft size={16} />К анкете</Link><h1>Настройки</h1>
    <div className="settings-rows">
      <Link className="settings-row" to="/settings/blocked"><Shield size={21} /><span><strong>Безопасность</strong><small>Заблокированные пользователи</small></span><ChevronRight size={18} /></Link>
      <a className="settings-row" href={notificationUrl} target="_blank" rel="noopener noreferrer" onClick={event => { const app = window.Telegram?.WebApp; if (app?.openTelegramLink) { event.preventDefault(); app.openTelegramLink(notificationUrl) } }}><Bell size={21} /><span><strong>Уведомления</strong><small>Уведомления от бота</small></span><ChevronRight size={18} /></a>
      {userId && role === 'admin' && <Link className="settings-row" to="/admin"><ShieldCheck size={21} /><span><strong>Управление приложением</strong><small>Кабинет сотрудника</small></span><ChevronRight size={18} /></Link>}
    </div>
    {userId && role === 'checking' && <p className="small-note" role="status">Загружаем настройки…</p>}
    {userId && role === 'error' && <p className="field-error" role="alert">Часть настроек недоступна <button type="button" className="text-link" onClick={() => { setRole('checking'); setRetry(value => value + 1) }}>Повторить</button></p>}
    {userId ? <div className="settings-danger"><button type="button" className="settings-row" disabled={busy} onClick={() => { setDeleteFailed(false); setShowDelete(true) }}><Trash2 size={20} /><span><strong>Удалить аккаунт</strong></span><ChevronRight size={18} /></button></div> : <p className="small-note">Для настроек аккаунта войди через Telegram</p>}
    {showDelete && <Modal title="Удалить аккаунт?" closeLabel="Отмена" className="safety-dialog" decoration={false} onClose={() => { if (!busy) setShowDelete(false) }}><p>Аккаунт «Пойдём?», анкета, фотографии и все сессии будут удалены с сервера</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => { setDeleteFailed(false); if (await deleteAccount()) { setShowDelete(false); navigate('/') } else setDeleteFailed(true) }}>{busy ? 'Удаляем…' : 'Удалить аккаунт'}</button>{deleteFailed && <p role="alert" className="field-error">{toast || 'Не удалось удалить аккаунт. Попробуй ещё раз'}</p>}</Modal>}
  </section>
}

export function BlockedPage() {
  const { authorization } = useAppData()
  if (authorization.status === 'checking') return <p role="status">Загружаем настройки…</p>
  if (authorization.status !== 'verified') return <section className="settings-page"><Link className="back-link" to="/settings"><ArrowLeft size={16} />Настройки</Link><h1>Заблокированные</h1><p>Войди через Telegram, чтобы открыть список</p><Link className="text-link" to="/profile">К анкете</Link></section>
  return <BlockedList key={authorization.userId} />
}

function BlockedList() {
  const { safety, notify, refreshConnections, refreshPlans } = useAppData()
  const [items, setItems] = useState<BlockedUser[]>([]), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [chosen, setChosen] = useState<BlockedUser | null>(null), [busy, setBusy] = useState(false), [actionError, setActionError] = useState('')
  useEffect(() => { let live = true; void safety.blocks().then(page => { if (live) { setItems(page.items); setError('') } }).catch(error => { if (live) setError(error instanceof Error ? error.message : 'Не удалось загрузить список') }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [safety, retry])
  return <section className="settings-page blocked-page"><Link className="back-link" to="/settings"><ArrowLeft size={16} />Настройки</Link><h1>Заблокированные</h1><p className="small-note settings-description">Блокировка действует только внутри «Пойдём?»</p>
    {loading && <p role="status">Загружаем список…</p>}{error && <p role="alert" className="field-error">{error} <button type="button" className="text-link" onClick={() => { setError(''); setLoading(true); setRetry(value => value + 1) }}>Повторить</button></p>}
    {!loading && !error && !items.length && <div className="settings-empty"><Shield size={28} /><p>Заблокированных пользователей нет</p></div>}
    <div className="blocked-list">{items.map(person => <article className="blocked-person" key={person.id}><BlockedPhoto key={person.photo_url} person={person} /><div className="blocked-person-info"><h2>{person.name}{person.age != null ? `, ${person.age}` : ''}</h2>{person.context && <p className="blocked-context">План «{person.context}»</p>}{person.context_saved_later && <p className="small-note">Сведения сохранены позже отклика</p>}<p className="blocked-code">Код {person.display_code || 'недоступен'}</p>{person.created_at && <time className="small-note" dateTime={person.created_at}>Блокировка · {new Date(person.created_at).toLocaleDateString('ru-RU')}</time>}</div><button type="button" className="text-link blocked-unblock" disabled={busy} onClick={() => { setActionError(''); setChosen(person) }}>Разблокировать</button></article>)}</div>
    {chosen && <Modal title={`Разблокировать ${chosen.name}?`} className="safety-dialog" decoration={false} closeLabel="Отмена" onClose={() => { if (!busy) setChosen(null) }}><p className="blocked-code">Код {chosen.display_code || 'недоступен'}</p>{chosen.context && <p>План «{chosen.context}»</p>}<p>Вы снова сможете общаться внутри «Пойдём?», если нет других ограничений</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => {
      if (busy) return; setBusy(true); setActionError('')
      try { await safety.unblock(chosen.id); setItems(current => current.filter(person => person.id !== chosen.id)); setChosen(null); notify('Участник разблокирован'); void refreshPlans(); void refreshConnections() }
      catch (error) { setActionError(error instanceof Error ? error.message : 'Не удалось разблокировать') }
      finally { setBusy(false) }
    }}>{busy ? 'Сохраняем…' : 'Разблокировать'}</button>{actionError && <p className="field-error" role="alert">{actionError}</p>}</Modal>}
  </section>
}

function BlockedPhoto({ person }: { person: BlockedUser }) {
  const [failed, setFailed] = useState(false)
  return <div className="blocked-avatar">{person.photo_url && !failed ? <img src={person.photo_url} alt={person.name} onError={() => setFailed(true)} /> : <UserRound size={23} aria-label="Фото недоступно" />}</div>
}
