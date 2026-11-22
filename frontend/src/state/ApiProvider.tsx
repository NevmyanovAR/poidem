import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { getTelegramInitData } from '../lib/telegram'
import { creationQuota } from '../lib/planRules'
import { emptyState } from './model'
import { clearLegacyData } from '../lib/legacyStorage'
import type { AuthorizationState, AppState, Profile } from '../types'
import { AppContext } from './context'

export function ApiProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ApiClient())
  const [data, setData] = useState<AppState>(emptyState)
  const [authorization, setAuthorization] = useState<AuthorizationState>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const active = useRef(false)
  const closing = useRef(false)
  const autoAuthDisabled = useRef(false)
  const lastLaunch = useRef('')
  const authEpoch = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function notify(text: string) {
    clearTimeout(timer.current); setToast(text)
    timer.current = setTimeout(() => setToast(''), 4500)
  }
  function report(error: unknown) {
    if (!active.current || closing.current) return
    if (error instanceof ApiError && error.status === 401) {
      setData(emptyState()); setAuthorization({ status: 'unverified' })
    }
    notify(error instanceof Error ? error.message : 'Не удалось выполнить запрос')
  }
  async function authenticate(force = false) {
    if (closing.current) return
    const raw = getTelegramInitData()
    if (!raw && !force) { setAuthorization({ status: 'unverified' }); return }
    if (raw && raw === lastLaunch.current && client.hasSession && !force) return
    lastLaunch.current = raw
    const epoch = ++authEpoch.current
    setData(emptyState())
    setAuthorization({ status: 'checking' })
    try {
      const result = await client.authenticate(() => raw)
      if (!active.current || closing.current || epoch !== authEpoch.current) return
      setData(current => ({ ...current, profile: result ? client.profile(result.profile) : null }))
      setAuthorization(result
        ? { status: 'verified', userId: result.user.id, verifiedAt: result.authorization.verified_at }
        : { status: 'unverified' })
    } catch (error) {
      if (!active.current || closing.current || epoch !== authEpoch.current) return
      setData(emptyState())
      setAuthorization({ status: 'error', message: error instanceof Error ? error.message : 'Вход недоступен' })
    }
  }
  useEffect(() => {
    clearLegacyData()
    active.current = true
    queueMicrotask(() => { if (active.current && !closing.current) void authenticate() })
    const ready = () => { if (getTelegramInitData() && !closing.current && !autoAuthDisabled.current) void authenticate() }
    window.addEventListener('poidem:telegram-ready', ready)
    return () => {
      active.current = false; clearTimeout(timer.current)
      window.removeEventListener('poidem:telegram-ready', ready)
    }
    // authenticate замкнут на один client; данные не берутся из localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  return <AppContext.Provider value={{
    data, plans: data.ownPlans, publishedPlans: [],
    authorization, busy, dailyQuota: creationQuota(data.ownPlans),
    toast, notify, async retryAuthorization() { autoAuthDisabled.current = false; await authenticate(true) },
    async saveProfile(profile: Profile, file?: File | null) {
      if (authorization.status !== 'verified' || busy || closing.current) { notify('Сначала войди через Telegram'); return false }
      setBusy(true)
      const epoch = authEpoch.current
      try {
        const saved = await client.saveProfile(profile, file)
        if (!active.current || closing.current || epoch !== authEpoch.current) return false
        setData(current => ({ ...current, profile: saved })); notify('Анкета сохранена')
        return true
      } catch (error) { if (epoch === authEpoch.current) report(error); return false }
      finally { if (active.current) setBusy(false) }
    },
    async deleteAccount() {
      if (busy || closing.current) return false
      const epoch = authEpoch.current
      const expectedUserId = authorization.status === 'verified' ? authorization.userId : null
      closing.current = true; setBusy(true)
      try {
        await client.idle()
        if (!expectedUserId || epoch !== authEpoch.current || client.userId !== expectedUserId) {
          notify('Аккаунт сменился. Открой анкету заново'); return false
        }
        const result = await client.deleteAccount(expectedUserId)
        if (!active.current) return false
        setData(emptyState()); setAuthorization({ status: 'unverified' })
        autoAuthDisabled.current = true
        clearLegacyData(true)
        notify(result.media_cleanup_pending ? 'Аккаунт удалён. Очистка файлов будет повторена сервером' : 'Аккаунт и фотографии удалены')
        return true
      } catch (error) { closing.current = false; report(error); return false }
      finally { closing.current = false; if (active.current) setBusy(false) }
    },
    createPlan(plan) {
      // До API планов — только временный непубликуемый черновик, без localStorage.
      setData(current => ({ ...current, ownPlans: [...current.ownPlans, { ...plan, published: false }] }))
      notify('Черновик сохранён до перезагрузки. Публикация пока не подключена'); return true
    },
    reset() {
      clearLegacyData(true)
      notify('Черновики очищены. Серверный аккаунт сохранён')
      setData(current => ({ ...emptyState(), profile: current.profile }))
    },
  }}>{children}</AppContext.Provider>
}
