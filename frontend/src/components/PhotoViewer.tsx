import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UserRound, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAppData } from '../state/context'

interface Entry { src: string; alt: string; trigger: HTMLElement; token: string; route: string; user: string; tracked: boolean; closing: boolean }
const ViewerContext = createContext<{ open: (src: string, alt: string, trigger: HTMLElement) => void; release: (trigger: HTMLElement) => void } | null>(null)

export function PhotoViewerProvider({ children }: { children: ReactNode }) {
  const { authorization } = useAppData()
  const user = authorization.status === 'verified' ? authorization.userId : ''
  const location = useLocation()
  const active = useRef<Entry | null>(null)
  const [entry, setEntry] = useState<Entry | null>(null)
  const close = useCallback(() => {
    const current = active.current
    if (!current || current.closing) return
    current.closing = true
    if (current.tracked && current.route === window.location.pathname + window.location.search) window.history.back()
    else { active.current = null; setEntry(null) }
  }, [])
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      const current = active.current
      if (!current) return
      // Резервная запись истории имеет тот же URL и состояние Router, без фото/данных.
      // На возврате из overlay Router не должен размонтировать исходный экран.
      if (current.route === window.location.pathname + window.location.search) event.stopImmediatePropagation()
      active.current = null; setEntry(null)
    }
    const telegramBack = (event: Event) => { if (active.current) { event.preventDefault(); close() } }
    window.addEventListener('popstate', pop, true)
    window.addEventListener('poidem:overlay-back', telegramBack)
    return () => { window.removeEventListener('popstate', pop, true); window.removeEventListener('poidem:overlay-back', telegramBack) }
  }, [close])
  useEffect(() => {
    const current = active.current
    if (current && (current.user !== user || current.route !== location.pathname + location.search)) {
      active.current = null; queueMicrotask(() => setEntry(null))
    }
  }, [user, location.pathname, location.search])
  const open = useCallback((src: string, alt: string, trigger: HTMLElement) => {
    if (!user || !src || active.current) return
    const next: Entry = { src, alt, trigger, token: crypto.randomUUID(), route: window.location.pathname + window.location.search, user, tracked: false, closing: false }
    try { window.history.pushState({ ...window.history.state, poidemPhoto: next.token }, ''); next.tracked = true } catch { /* Закрытие остаётся доступным при запрете History API */ }
    active.current = next; setEntry(next)
  }, [user])
  const release = useCallback((trigger: HTMLElement) => { if (active.current?.trigger === trigger) close() }, [close])
  return <ViewerContext.Provider value={{ open, release }}>{children}{entry && entry.user === user && <Lightbox key={entry.token} entry={entry} close={close} />}</ViewerContext.Provider>
}

function Lightbox({ entry, close }: { entry: Entry; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => {
    const body = document.body, root = document.documentElement, y = window.scrollY
    const saved = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: root.style.overflow }
    body.style.position = 'fixed'; body.style.top = `${-y}px`; body.style.width = '100%'; root.style.overflow = 'hidden'
    const node = dialog.current
    node?.showModal()
    return () => {
      node?.close(); body.style.position = saved.position; body.style.top = saved.top; body.style.width = saved.width; root.style.overflow = saved.overflow
      window.scrollTo({ top: y, behavior: 'instant' })
      if (entry.trigger.isConnected) entry.trigger.focus({ preventScroll: true })
    }
  }, [entry])
  return <dialog ref={dialog} className="photo-lightbox" aria-label={`Фотография: ${entry.alt}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <button className="photo-lightbox-close" type="button" aria-label="Закрыть фотографию" onClick={close}><X size={25} /></button>
    {failed ? <p className="photo-lightbox-error" role="alert">Фотография сейчас недоступна</p> : <img src={entry.src} alt={entry.alt} onError={() => setFailed(true)} />}
  </dialog>
}

// Только уже разрешённый контекстный URL. Без /fallback.svg и произвольных подмен.
export function ProfilePhoto({ src, name, className = '', eager = false }: { src: string; name: string; className?: string; eager?: boolean }) {
  const viewer = useContext(ViewerContext)
  const trigger = useRef<HTMLButtonElement>(null)
  const [failed, setFailed] = useState(!src), [loaded, setLoaded] = useState(false)
  const release = viewer?.release
  useEffect(() => { const node = trigger.current; return () => { if (node) release?.(node) } }, [release])
  return <button ref={trigger} type="button" className={`profile-photo-trigger ${className}`} disabled={failed || !loaded} aria-label={`Открыть фотографию ${name}`} onClick={event => viewer?.open(src, name, event.currentTarget)}>
    {failed ? <span className="person-photo-placeholder" role="img" aria-label="Фотография недоступна"><UserRound size={42} aria-hidden="true" /><span>Фото пока недоступно</span></span> : <img src={src} alt={`Фотография ${name}`} loading={eager ? 'eager' : 'lazy'} onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false) }} />}
  </button>
}
