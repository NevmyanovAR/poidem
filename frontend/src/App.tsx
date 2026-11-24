import { useEffect, useState } from 'react'
import { NavLink, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ArrowUpRight, Compass, Heart, Home as HomeIcon, Plus, UserRound, X } from 'lucide-react'
import { Brand, Modal } from './components/ui'
import { useAppData } from './state/context'
import { useTelegram } from './lib/telegram'
import { Welcome } from './pages/Welcome'
import { Home } from './pages/Home'
import { ProfilePage } from './pages/Profile'
import { Catalog } from './pages/Catalog'
import { People } from './pages/People'
import { CreatePlan } from './pages/CreatePlan'
import { MyPlans } from './pages/MyPlans'
import { Inspiration } from './pages/Inspiration'
import { Match } from './pages/Match'
import { Chat } from './pages/Chat'
import { EmptyState } from './components/ui'

const links = [{ to: '/home', text: 'Главная', icon: HomeIcon }, { to: '/catalog', text: 'Найти план', icon: Compass }, { to: '/plans', text: 'Мои планы', icon: Heart }, { to: '/inspiration', text: 'Вдохновение', icon: ArrowUpRight }]

export default function App() {
  const { pathname, search } = useLocation()
  const { data, toast, reset } = useAppData()
  const [showReset, setShowReset] = useState(false)
  useTelegram()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
  }, [pathname])
  const isWelcome = pathname === '/'

  return <>
    <a className="skip-link" href="#main">К содержимому</a>
    {!isWelcome && <header className="site-header"><div className="header-inner"><Brand />
      <nav aria-label="Основная навигация" className="desktop-nav">{links.map(link => <NavLink key={link.to} to={link.to}>{link.text}</NavLink>)}</nav>
      <Link className="profile-link" to="/profile" aria-label="Моя анкета">{data.profile ? <img src={data.profile.photo} alt="" /> : <UserRound size={19} />}<span>{data.profile?.name ?? 'Моя анкета'}</span></Link>
    </div></header>}
    <main id="main" tabIndex={-1} className={isWelcome ? 'welcome-main' : 'main-container'}><Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/profile" element={<ProfilePage key={`${data.profile?.userId ?? 'new'}:${data.profile?.serverVersion ?? 0}`} />} />
      <Route path="/home" element={<Home />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/people/:planId" element={<People key={pathname} />} />
      <Route path="/create" element={<CreatePlan key={pathname + search} />} />
      <Route path="/plans" element={<MyPlans />} />
      <Route path="/inspiration" element={<Inspiration />} />
      <Route path="/match/:inviteId" element={<Match />} />
      <Route path="/match/:inviteId/chat" element={<Chat />} />
      <Route path="/start" element={<Navigate to="/" replace />} />
      <Route path="*" element={<EmptyState title="Кажется, мы свернули не туда" action="На главную" to="/home">Такой страницы нет. Но хороший план обязательно найдётся</EmptyState>} />
    </Routes></main>
    {!isWelcome && <><footer className="site-footer"><Brand /><span>Сначала — что делать. Потом — с кем</span><button className="quiet-button" onClick={() => setShowReset(true)}>Очистить данные</button></footer>
      <nav className="mobile-nav" aria-label="Мобильная навигация">{links.map(({ to, text, icon: Icon }) => <NavLink key={to} to={to}><Icon size={21} /><span>{text}</span></NavLink>)}<NavLink to="/create" className="mobile-create" aria-label="Создать свой план"><Plus size={23} /></NavLink></nav></>}
    <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    {showReset && <Modal title="Очистить данные?" onClose={() => setShowReset(false)}><p>Данные на этом устройстве будут очищены. Серверные анкета и планы сохранятся; удалить аккаунт можно в «Моей анкете», если нет связанных записей</p><button className="button button-outline" onClick={() => { reset(); setShowReset(false) }}>Очистить <X size={16} /></button></Modal>}
  </>
}
