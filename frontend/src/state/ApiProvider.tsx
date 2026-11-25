import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { getTelegramInitData } from '../lib/telegram'
import type { CreationQuota } from '../lib/planRules'
import { emptyState } from './model'
import { clearLegacyData } from '../lib/legacyStorage'
import type { AuthorizationState, AppState, Profile, PublishedPlan, PlanResponse, PairMatch } from '../types'
import { AppContext } from './context'
import type { AppContextValue } from './context'

const unavailableQuota = (): CreationQuota => ({ maximum: 3, used: 0, remaining: 0, day: '', timeZone: 'Europe/Moscow', ready: false })

export function ApiProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ApiClient())
  const [data, setData] = useState<AppState>(emptyState)
  const [authorization, setAuthorization] = useState<AuthorizationState>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [publishedPlans, setPublishedPlans] = useState<PublishedPlan[]>([])
  const [dailyQuota, setDailyQuota] = useState<CreationQuota>(unavailableQuota)
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState('')
  const [planError, setPlanError] = useState('')
  const [incomingResponses, setIncomingResponses] = useState<PlanResponse[]>([])
  const [outgoingResponses, setOutgoingResponses] = useState<PlanResponse[]>([])
  const [matches, setMatches] = useState<PairMatch[]>([])
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsError, setConnectionsError] = useState('')
  const active = useRef(false)
  const closing = useRef(false)
  const autoAuthDisabled = useRef(false)
  const lastLaunch = useRef('')
  const authEpoch = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refreshFlight = useRef<{ epoch: number; task: Promise<void> } | null>(null)
  const connectionFlight = useRef<{ epoch: number; task: Promise<void> } | null>(null)
  const refreshConnections = useCallback((epoch = authEpoch.current): Promise<void> => {
    if (!client.hasSession || closing.current) return Promise.resolve()
    if (connectionFlight.current?.epoch === epoch) return connectionFlight.current.task
    const task = (async () => {
      setConnectionsLoading(true); setConnectionsError('')
      try {
        const [incoming, outgoing, pairs] = await Promise.all([client.responses('incoming'), client.responses('outgoing'), client.matches()])
        if (!active.current || closing.current || epoch !== authEpoch.current) return
        setIncomingResponses(incoming); setOutgoingResponses(outgoing); setMatches(pairs)
      } catch (error) {
        if (!active.current || closing.current || epoch !== authEpoch.current) return
        setConnectionsError(error instanceof Error ? error.message : 'Не удалось загрузить отклики')
        if (error instanceof ApiError && (error.status === 401 || error.code === 'AUTH_CONTEXT_CHANGED')) {
          setIncomingResponses([]); setOutgoingResponses([]); setMatches([])
          setAuthorization({ status: 'unverified' })
        }
      } finally { if (active.current && epoch === authEpoch.current) setConnectionsLoading(false) }
    })()
    connectionFlight.current = { epoch, task }
    const clear = () => { if (connectionFlight.current?.task === task) connectionFlight.current = null }
    void task.then(clear, clear)
    return task
  }, [client])
  const refreshPlans = useCallback((epoch = authEpoch.current): Promise<void> => {
    if (!client.hasSession || closing.current) return Promise.resolve()
    if (refreshFlight.current?.epoch === epoch) return refreshFlight.current.task
    const task = (async () => {
      setPlansLoading(true); setPlansError('')
      try {
        const [own, catalogue, quota] = await Promise.all([client.plans(true), client.plans(false), client.quota()])
        if (!active.current || closing.current || epoch !== authEpoch.current) return
        setData(current => ({ ...current, ownPlans: own }))
        setPublishedPlans(catalogue.filter(plan => !plan.own && plan.author.id !== client.userId && plan.publicationStatus === 'published' && ['not_submitted', 'approved'].includes(plan.moderation?.status ?? '')))
        setDailyQuota(quota)
      } catch (error) {
        if (!active.current || closing.current || epoch !== authEpoch.current) return
        setPlansError(error instanceof Error ? error.message : 'Не удалось загрузить планы')
        setPublishedPlans([])
        setDailyQuota(unavailableQuota())
        if (error instanceof ApiError && error.status === 401) {
          setData(emptyState()); setPublishedPlans([]); setAuthorization({ status: 'unverified' })
        }
      } finally { if (active.current && epoch === authEpoch.current) setPlansLoading(false) }
    })()
    refreshFlight.current = { epoch, task }
    const clear = () => { if (refreshFlight.current?.task === task) refreshFlight.current = null }
    void task.then(clear, clear)
    return task
  }, [client])
  function notify(text: string) {
    clearTimeout(timer.current); setToast(text)
    timer.current = setTimeout(() => setToast(''), 4500)
  }
  function report(error: unknown) {
    if (!active.current || closing.current) return
    if (error instanceof ApiError && error.status === 401) {
      setData(emptyState()); setPublishedPlans([]); setDailyQuota(unavailableQuota()); setAuthorization({ status: 'unverified' })
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
    setIncomingResponses([]); setOutgoingResponses([]); setMatches([]); setConnectionsError('')
    setPublishedPlans([]); setDailyQuota(unavailableQuota()); setPlansError(''); setPlanError('')
    setAuthorization({ status: 'checking' })
    try {
      const result = await client.authenticate(() => raw)
      if (!active.current || closing.current || epoch !== authEpoch.current) return
      setData(current => ({ ...current, profile: result ? client.profile(result.profile) : null }))
      setAuthorization(result
        ? { status: 'verified', userId: result.user.id, verifiedAt: result.authorization.verified_at }
        : { status: 'unverified' })
      if (result) { void refreshPlans(epoch); void refreshConnections(epoch) }
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
  }, [client, refreshPlans, refreshConnections])

  const readConnection = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    const epoch = authEpoch.current
    if (authorization.status !== 'verified' || closing.current) throw new ApiError('AUTH_REQUIRED', 'Сначала войди через Telegram')
    let result: T
    try { result = await operation() }
    catch (error) {
      if (epoch === authEpoch.current && error instanceof ApiError && (error.status === 401 || error.code === 'AUTH_CONTEXT_CHANGED')) {
        setData(emptyState()); setPublishedPlans([]); setIncomingResponses([]); setOutgoingResponses([]); setMatches([])
        setDailyQuota(unavailableQuota()); setAuthorization({ status: 'unverified' })
      }
      throw error
    }
    if (!active.current || closing.current || epoch !== authEpoch.current) throw new ApiError('AUTH_CONTEXT_CHANGED', 'Аккаунт сменился')
    return result
  }, [authorization.status])
  const safety = useMemo<AppContextValue['safety']>(() => ({
    report: (...args) => readConnection(() => client.report(...args)),
    block: (...args) => readConnection(() => client.block(...args)),
    blocks: () => readConnection(() => client.blocks()),
    unblock: id => readConnection(() => client.unblock(id)),
    adminSession: () => readConnection(() => client.adminSession()),
    adminReports: (...args) => readConnection(() => client.adminReports(...args)),
    adminReport: id => readConnection(() => client.adminReport(id)),
    adminDecision: (...args) => readConnection(() => client.adminDecision(...args)),
    reportPhotoUrl: id => client.reportPhotoUrl(id),
  }), [client, readConnection])
  const loadPlan = useCallback((id: string) => readConnection(() => client.plan(id)), [client, readConnection])
  const loadAuthor = useCallback((id: string) => readConnection(() => client.planAuthor(id)), [client, readConnection])
  const loadCapacity = useCallback((id: string) => readConnection(() => client.capacity(id)), [client, readConnection])
  const loadMatch = useCallback((id: string) => readConnection(() => client.match(id)), [client, readConnection])
  const loadContact = useCallback((id: string) => readConnection(() => client.contact(id)), [client, readConnection])
  const loadPlanResponses = useCallback((id: string, cursor?: string) => readConnection(() => client.planResponses(id, cursor)), [client, readConnection])
  const loadActivity = useCallback((scope: 'active' | 'archive', includeHidden: boolean, cursor?: string, planId?: string) => readConnection(() => client.activity(scope, includeHidden, cursor, planId)), [client, readConnection])
  const hideArchive = useCallback((planId: string, hidden: boolean) => readConnection(() => client.archiveVisibility(planId, hidden)), [client, readConnection])
  const loadChat = useCallback((id: string) => readConnection(() => client.chat(id)), [client, readConnection])
  const loadMessages = useCallback((id: string, direction?: { before?: number; after?: number }) => readConnection(() => client.messages(id, direction)), [client, readConnection])
  const sendMessage = useCallback((id: string, text: string, key: string) => readConnection(() => client.sendMessage(id, text, key)), [client, readConnection])
  const readChat = useCallback((id: string, sequence: number) => readConnection(() => client.readChat(id, sequence)), [client, readConnection])
  async function writeConnection(operation: () => Promise<PlanResponse>): Promise<PlanResponse | null> {
    if (authorization.status !== 'verified' || busy || closing.current) return null
    const epoch = authEpoch.current
    setBusy(true); setConnectionsError('')
    try {
      const result = await operation()
      if (!active.current || closing.current || epoch !== authEpoch.current) return null
      if (refreshFlight.current?.epoch === epoch) await refreshFlight.current.task
      if (connectionFlight.current?.epoch === epoch) await connectionFlight.current.task
      await Promise.all([refreshPlans(epoch), refreshConnections(epoch)])
      return active.current && !closing.current && epoch === authEpoch.current ? result : null
    } catch (error) {
      if (active.current && !closing.current && epoch === authEpoch.current) {
        const message = error instanceof Error ? error.message : 'Не удалось сохранить отклик'
        report(error)
        if (error instanceof ApiError && error.status === 409) await Promise.all([refreshPlans(epoch), refreshConnections(epoch)])
        setConnectionsError(message)
      }
      return null
    } finally { if (active.current && epoch === authEpoch.current) setBusy(false) }
  }

  async function writePlan(operation: () => Promise<PublishedPlan>, message: string): Promise<boolean> {
    if (authorization.status !== 'verified' || busy || closing.current) {
      setPlanError('Сначала войди через Telegram и сохрани анкету'); return false
    }
    const epoch = authEpoch.current
    setBusy(true); setPlanError('')
    try {
      const saved = await operation()
      if (!active.current || closing.current || epoch !== authEpoch.current) return false
      setData(current => ({ ...current, ownPlans: [saved, ...current.ownPlans.filter(plan => plan.id !== saved.id)] }))
      setDailyQuota(unavailableQuota())
      if (refreshFlight.current?.epoch === epoch) await refreshFlight.current.task
      await refreshPlans(epoch)
      if (epoch !== authEpoch.current || closing.current || !active.current) return false
      notify(message); return true
    } catch (error) {
      if (epoch === authEpoch.current && active.current && !closing.current) {
        setPlanError(error instanceof Error ? error.message : 'Не удалось сохранить план')
        report(error)
        if (refreshFlight.current?.epoch === epoch) await refreshFlight.current.task
        await refreshPlans(epoch)
      }
      return false
    } finally { if (active.current) setBusy(false) }
  }

  return <AppContext.Provider value={{
    safety,
    data, plans: data.ownPlans, publishedPlans,
    authorization, busy, dailyQuota, plansLoading, plansError, planError,
    incomingResponses, outgoingResponses, matches, connectionsLoading, connectionsError, refreshConnections,
    loadPlan, loadAuthor, loadCapacity, loadMatch, loadContact,
    loadPlanResponses,
    loadActivity, hideArchive, loadChat, loadMessages, sendMessage, readChat,
    respond: (plan, key) => writeConnection(() => client.sendResponse(plan, key)),
    decide: (response, decision) => writeConnection(() => client.decideResponse(response, decision)),
    refreshPlans,
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
        setData(emptyState()); setPublishedPlans([]); setDailyQuota(unavailableQuota()); setAuthorization({ status: 'unverified' })
        setIncomingResponses([]); setOutgoingResponses([]); setMatches([]); setConnectionsError('')
        autoAuthDisabled.current = true
        clearLegacyData(true)
        notify(result.media_cleanup_pending ? 'Аккаунт удалён. Очистка файлов будет повторена сервером' : 'Аккаунт и фотографии удалены')
        return true
      } catch (error) { closing.current = false; report(error); return false }
      finally { closing.current = false; if (active.current) setBusy(false) }
    },
    createPlan: (plan, key) => writePlan(() => client.createPlan(plan, key), 'План сохранён на сервере'),
    editPlan: (plan, fields) => writePlan(() => client.editPlan(plan, fields), 'Изменения сохранены'),
    publishPlan: plan => writePlan(() => client.planCommand(plan, 'publish'), 'План опубликован'),
    cancelPlan: plan => writePlan(() => client.planCommand(plan, 'cancel'), 'План отменён'),
    reset() {
      clearLegacyData(true)
      notify('Данные на устройстве очищены. Серверные анкета и планы сохранены')
    },
  }}>{children}</AppContext.Provider>
}
