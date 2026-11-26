import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ArrowUpRight, Compass, Heart, Home as HomeIcon, Plus, MessageCircle, UserRound, Settings as SettingsIcon } from 'lucide-react'
import { Brand } from './components/ui'
import { useAppData } from './state/context'
import { useTelegram } from './lib/telegram'
import { Welcome } from './pages/Welcome'
import { Home } from './pages/Home'
import { ProfileSettingsFrame, SettingsPage, BlockedPage } from './pages/Settings'
import { Catalog } from './pages/Catalog'
import { People } from './pages/People'
import { CreatePlan } from './pages/CreatePlan'
import { MyPlans } from './pages/MyPlans'
import { Inspiration } from './pages/Inspiration'
import { Match } from './pages/Match'
import { Chat } from './pages/Chat'
import { Chats } from './pages/Chats'
import { Admin } from './pages/Admin'
import { EmptyState } from './components/ui'
import { useScreenScroll } from './lib/scrollMemory'

const links = [{ to: '/home', text: 'Главная', icon: HomeIcon }, { to: '/catalog', text: 'Найти', icon: Compass }, { to: '/plans', text: 'Мои планы', icon: Heart }, { to: '/inspiration', text: 'Вдохновение', icon: ArrowUpRight }, { to: '/chats', text: 'Чаты', icon: MessageCircle }]

export default function App() {
  const { pathname, search } = useLocation()
  const { data, toast, navigationSummary, authorization } = useAppData()
  useScreenScroll(authorization.status === 'verified' ? authorization.userId : '')
  const mobileNav = useRef<HTMLElement>(null)
  const [lastPlans, setLastPlans] = useState('/plans')
  useEffect(() => { if (pathname === '/plans') queueMicrotask(() => setLastPlans(`/plans${search}`)) }, [pathname, search])
  useLayoutEffect(() => {
    const nav = mobileNav.current
    if (!nav) return
    const root = document.documentElement
    const measure = () => {
      // Safari округляет дробные CSS-значения при сериализации; целый px
      // предотвращает цикл наблюдателя и оставляет безопасный запас <1 px.
      const height = `${Math.ceil(nav.getBoundingClientRect().height)}px`
      if (root.style.getPropertyValue('--bottom-nav-height') !== height) root.style.setProperty('--bottom-nav-height', height)
    }
    const observer = new ResizeObserver(measure)
    // SDK может обновить safe area после первого layout, раньше callback ResizeObserver.
    const safeArea = new MutationObserver(measure)
    safeArea.observe(root, { attributes: true, attributeFilter: ['style'] })
    observer.observe(nav); measure()
    return () => { observer.disconnect(); safeArea.disconnect(); root.style.removeProperty('--bottom-nav-height') }
  }, [pathname])
  const badge = (to: string) => {
    const count = to === '/plans' ? navigationSummary?.pendingResponses : to === '/chats' ? navigationSummary?.unreadMessages : 0
    return count ? <span className="count-badge nav-count" aria-label={`${to === '/plans' ? 'Новых откликов' : 'Непрочитанных сообщений'}: ${count}`}>{count > 99 ? '99+' : count}</span> : null
  }
  useTelegram()
  const isWelcome = pathname === '/'
  const isAdmin = pathname === '/admin'
  const isPlanDetails = pathname.startsWith('/people/')
  const isMain = links.some(link => link.to === pathname)

  return <>
    <a className={`skip-link${isAdmin ? ' admin-skip-link' : ''}`} href="#main">К содержимому</a>
    {!isWelcome && !isAdmin && <header className="site-header"><div className="header-inner"><Brand />
      <nav aria-label="Основная навигация" className="desktop-nav">{links.map(link => <NavLink key={link.to} to={link.to === '/plans' ? lastPlans : link.to}>{link.text}{badge(link.to)}</NavLink>)}</nav>
      <div className={`header-account ${pathname === '/profile' ? 'has-settings' : ''}`}><Link className="profile-link" to="/profile" aria-label="Моя анкета">{data.profile ? <img src={data.profile.photo} alt="" /> : <UserRound size={19} />}<span>{data.profile?.name ?? 'Моя анкета'}</span></Link>{pathname === '/profile' && <Link to="/settings" className="settings-link" aria-label="Настройки"><SettingsIcon size={21} /></Link>}</div>
    </div></header>}
    <main id="main" tabIndex={-1} className={isWelcome ? 'welcome-main' : isAdmin ? 'admin-main' : `main-container${isPlanDetails ? ' plan-detail-main' : ''}${isMain ? ' main-with-create' : ''}`}><Routes>
      <Route path="/" element={<Welcome />} />
      <Route element={<ProfileSettingsFrame />}>
        <Route path="/profile" element={null} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/blocked" element={<BlockedPage />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="/home" element={<Home />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/people/:planId" element={<People key={pathname} />} />
      <Route path="/create" element={<CreatePlan key={pathname + search} />} />
      <Route path="/plans" element={<MyPlans />} />
      <Route path="/inspiration" element={<Inspiration />} />
      <Route path="/chats" element={<Chats />} />
      <Route path="/match/:inviteId" element={<Match />} />
      <Route path="/match/:inviteId/chat" element={<Chat />} />
      <Route path="/start" element={<Navigate to="/" replace />} />
      <Route path="*" element={<EmptyState title="Кажется, мы свернули не туда" action="На главную" to="/home">Такой страницы нет. Но хороший план обязательно найдётся</EmptyState>} />
    </Routes></main>
    {!isWelcome && !isAdmin && <>{!isPlanDetails && <footer className="site-footer"><Brand /><span>Сначала — что делать. Потом — с кем</span></footer>}
      <nav className="mobile-nav" ref={mobileNav} aria-label="Мобильная навигация">{links.map(({ to, text, icon: Icon }) => <NavLink key={to} to={to === '/plans' ? lastPlans : to}><span className="nav-icon"><Icon size={21} />{badge(to)}</span><span>{text}</span></NavLink>)}</nav>
      {isMain && <Link className="create-fab" to="/create" aria-label="Создать свой план"><Plus size={25} /></Link>}</>}
    <div className={`toast ${toast ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast}</div>

  </>
}
