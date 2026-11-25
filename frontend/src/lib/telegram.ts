import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface Insets { top: number; bottom: number; left: number; right: number }
interface TelegramWebApp {
  openTelegramLink?: (url: string) => void
  initData?: string
  platform: string
  viewportStableHeight: number
  safeAreaInset?: Insets
  contentSafeAreaInset?: Insets
  ready: () => void
  expand: () => void
  isVersionAtLeast: (version: string) => boolean
  setHeaderColor: (color: string) => void
  setBackgroundColor: (color: string) => void
  setBottomBarColor: (color: string) => void
  onEvent: (event: string, handler: () => void) => void
  offEvent: (event: string, handler: () => void) => void
  BackButton: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void }
}
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

export function getTelegramInitData(): string {
  const raw = window.Telegram?.WebApp?.initData
  if (typeof raw === 'string') return raw
  // Официальный SDK берёт initData из этого же параметра запуска.
  // Не ждём его загрузки по сети; строка не пересобирается и проверяется API.
  // Не сохраняем её в storage и не используем клиентские поля как авторизацию.
  const hash = window.location.hash.slice(1)
  const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
  return params.getAll('tgWebAppData').length === 1 ? params.get('tgWebAppData') ?? '' : ''
}

function observeTelegram(setup: (app: TelegramWebApp) => (() => void) | void) {
  let cleanup: (() => void) | void
  const ready = () => {
    cleanup?.()
    const app = window.Telegram?.WebApp
    if (app && app.platform !== 'unknown') cleanup = setup(app)
  }
  ready()
  window.addEventListener('poidem:telegram-ready', ready)
  return () => { window.removeEventListener('poidem:telegram-ready', ready); cleanup?.() }
}

export function useTelegram() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // A delayed or unavailable external SDK must not block the browser interface.
  // The presence of this bridge is never treated as authentication.
  useEffect(() => observeTelegram(app => {
    app.ready()
    app.expand()
    const burgundy = getComputedStyle(document.documentElement).getPropertyValue('--brand-burgundy').trim()
    if (app.isVersionAtLeast('6.1')) app.setBackgroundColor(burgundy)
    if (app.isVersionAtLeast('6.9')) app.setHeaderColor(burgundy)
    if (app.isVersionAtLeast('7.10')) app.setBottomBarColor(burgundy)
    const update = () => {
      const root = document.documentElement
      if (app.viewportStableHeight > 0) root.style.setProperty('--app-height', `${app.viewportStableHeight}px`)
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const inset = (app.safeAreaInset?.[side] ?? 0) + (app.contentSafeAreaInset?.[side] ?? 0)
        root.style.setProperty(`--app-safe-${side}`, `${inset}px`)
      }
    }
    update()
    const events = ['viewportChanged', ...(app.isVersionAtLeast('8.0') ? ['safeAreaChanged', 'contentSafeAreaChanged'] : [])]
    events.forEach(event => app.onEvent(event, update))
    return () => events.forEach(event => app.offEvent(event, update))
  }), [])

  useEffect(() => observeTelegram(app => {
    if (!app.isVersionAtLeast('6.1')) return
    const back = () => navigate(pathname === '/settings' ? '/profile' : pathname === '/settings/blocked' || pathname === '/admin' ? '/settings' : pathname.startsWith('/people/') ? '/catalog' : pathname === '/profile' ? '/' : '/home')
    if (pathname === '/' || pathname === '/home') app.BackButton.hide()
    else app.BackButton.show()
    app.BackButton.onClick(back)
    return () => { app.BackButton.offClick(back); app.BackButton.hide() }
  }), [pathname, navigate])
}
