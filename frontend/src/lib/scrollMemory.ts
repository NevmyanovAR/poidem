import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// Только положение/объём списка в памяти процесса, без анкет/фото/сообщений/storage.
const positions = new Map<string, number>()
const sizes = new Map<string, number>()
let account = ''
export function listSize(key: string) { return sizes.get(key) ?? 20 }
export function saveListSize(key: string, value: number) { sizes.set(key, value) }

export function useScreenScroll(user: string) {
  const { pathname, search } = useLocation()
  const route = pathname + search
  const current = useRef(route), restoring = useRef(false)
  useLayoutEffect(() => {
    if (account !== user) { positions.clear(); sizes.clear(); account = user }
    current.current = route
    const target = positions.get(route) ?? 0
    restoring.current = target > 0
    const apply = () => {
      if (document.querySelector('.photo-lightbox[open]')) return
      window.scrollTo({ top: target, behavior: 'instant' })
      if (Math.abs(window.scrollY - target) < 2) restoring.current = false
    }
    const observer = new ResizeObserver(() => { if (restoring.current) apply() })
    const main = document.querySelector('main')
    if (main) observer.observe(main)
    apply()
    main?.focus({ preventScroll: true })
    const timer = window.setTimeout(() => { restoring.current = false; observer.disconnect() }, 10000)
    return () => { window.clearTimeout(timer); observer.disconnect() }
  }, [route, user])
  useEffect(() => {
    const save = () => {
      if (!restoring.current && !document.querySelector('.photo-lightbox[open]')) positions.set(current.current, window.scrollY)
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [])
}
