import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEMO_PEOPLE, DEMO_PUBLISHED_PLANS, DEMO_RESPONSE_IDS } from '../data/demo'
import { DEMO_STORAGE_KEY, emptyState, MODE_STORAGE_KEY, readDemo, readDemoMode, STORAGE_KEY } from '../lib/storage'
import { isProfileReady } from '../lib/profile'
import { calendarDay, creationQuota, planTextErrors, responseCapacity } from '../lib/planRules'
import type { DemoState, Plan, PublishedPlan } from '../types'
import { DemoContext } from './context'

const SELF = 'demo-self'

export function DemoProvider({ children }: { children: ReactNode }) {
  const [normalData, setNormalData] = useState(() => readDemo())
  const [demoData, setDemoData] = useState(() => readDemo(DEMO_STORAGE_KEY))
  const normalRef = useRef(normalData)
  const demoRef = useRef(demoData)
  const [fixtureMode, setFixtureMode] = useState(readDemoMode)
  const [toast, setToast] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [day, setDay] = useState(() => calendarDay(new Date()))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const next = new Date()
    next.setHours(24, 0, 0, 0)
    const midnight = setTimeout(() => setDay(calendarDay(new Date())), next.getTime() - Date.now() + 25)
    return () => clearTimeout(midnight)
  }, [day])
  const data = fixtureMode ? demoData : normalData
  const current = () => fixtureMode ? demoRef.current : normalRef.current
  const publishedPlans: PublishedPlan[] = fixtureMode ? [
    ...DEMO_PUBLISHED_PLANS,
    ...(isProfileReady(data.profile) ? data.ownPlans.filter(plan => plan.published).map(plan => ({
      ...plan, author: { id: SELF, name: data.profile!.name }, isDemo: true,
    })) : []),
  ] : []
  const plans = [...publishedPlans.filter(plan => !plan.own), ...data.ownPlans]

  function persist(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); setStorageError(false) }
    catch { setStorageError(true) }
  }
  function commit(next: DemoState) {
    if (fixtureMode) { demoRef.current = next; setDemoData(next) }
    else { normalRef.current = next; setNormalData(next) }
    persist(fixtureMode ? DEMO_STORAGE_KEY : STORAGE_KEY, next)
  }
  function notify(message: string) {
    clearTimeout(timer.current)
    setToast(message)
    timer.current = setTimeout(() => setToast(''), 4500)
  }
  function contentAllowed(plan: Plan): boolean {
    const errors = planTextErrors(plan)
    const reason = errors.title ?? errors.description
    if (reason) { notify(reason); return false }
    if (plan.moderation && ['pending', 'rejected', 'blocked'].includes(plan.moderation.status)) {
      notify(plan.moderation.status === 'pending' ? 'План находится на проверке' : 'Этот план нельзя опубликовать')
      return false
    }
    return true
  }
  function responseInfo(planId: string) {
    if (!fixtureMode) return null
    const own = current().ownPlans.find(plan => plan.id === planId)
    const plan = own?.published ? { ...own, author: { id: SELF } } : DEMO_PUBLISHED_PLANS.find(plan => plan.id === planId)
    return plan ? responseCapacity(planId, plan.author.id, SELF, current().invites, DEMO_RESPONSE_IDS[planId]) : null
  }

  return <DemoContext.Provider value={{
    data, plans, publishedPlans, fixtureMode, authorization: { status: 'unverified' },
    dailyQuota: creationQuota(data.ownPlans), responseInfo, toast, storageError, notify,
    setDemoMode(enabled) {
      setFixtureMode(enabled)
      persist(MODE_STORAGE_KEY, enabled)
      setToast('')
    },
    saveProfile(profile) { commit({ ...current(), profile }) },
    selectPlan(id) {
      const state = current()
      if (plans.some(plan => plan.id === id) && !state.selectedIds.includes(id)) {
        commit({ ...state, selectedIds: [...state.selectedIds, id] })
      }
    },
    createPlan(plan) {
      const state = current()
      if (!contentAllowed(plan)) return false
      if (creationQuota(state.ownPlans).remaining === 0) { notify('Дневной лимит создания планов достигнут'); return false }
      if (state.ownPlans.some(existing => existing.id === plan.id)) return false
      const published = fixtureMode && isProfileReady(state.profile)
      commit({ ...state, ownPlans: [...state.ownPlans, { ...plan, own: true, createdAt: new Date().toISOString(), published, moderation: { status: 'not_submitted', source: 'local_text' } }] })
      notify(published ? 'План опубликован только в деморежиме' : 'Черновик сохранён на этом устройстве')
      return true
    },
    publishPlan(id) {
      const state = current()
      if (!fixtureMode || !isProfileReady(state.profile)) return false
      const plan = state.ownPlans.find(plan => plan.id === id)
      if (!plan || !contentAllowed(plan)) return false
      // Publishing an existing draft does not create an additional plan.
      commit({ ...state, ownPlans: state.ownPlans.map(plan => plan.id === id ? { ...plan, published: true } : plan) })
      notify('План опубликован только в деморежиме')
      return true
    },
    invite(planId, personId) {
      const state = current()
      const plan = DEMO_PUBLISHED_PLANS.find(plan => plan.id === planId && plan.author.id === personId)
      if (!fixtureMode || !isProfileReady(state.profile) || !plan || plan.author.id === SELF) return undefined
      const existing = state.invites.find(i => i.planId === planId && (i.responderId ?? (i.direction === 'outgoing' ? SELF : i.personId)) === SELF)
      if (existing) return existing
      const capacity = responseInfo(planId)
      if (!capacity || capacity.full || capacity.alreadyResponded) { notify('Лимит откликов достигнут'); return undefined }
      const entry = { id: crypto.randomUUID(), planId, personId, responderId: SELF, status: 'waiting' as const, direction: 'outgoing' as const }
      commit({ ...state, selectedIds: [...new Set([...state.selectedIds, planId])], invites: [...state.invites, entry] })
      return entry
    },
    simulateIncoming(planId) {
      const state = current()
      if (!fixtureMode || !isProfileReady(state.profile) || !state.ownPlans.some(plan => plan.id === planId && plan.published)) return
      if (state.invites.some(i => i.planId === planId && i.direction === 'incoming')) return
      if (responseInfo(planId)?.full) { notify('Лимит откликов достигнут'); return }
      const entry = { id: crypto.randomUUID(), planId, personId: DEMO_PEOPLE[0].id, responderId: DEMO_PEOPLE[0].id, status: 'waiting' as const, direction: 'incoming' as const }
      commit({ ...state, invites: [...state.invites, entry] })
    },
    respondToInvite(id, accept) {
      const state = current()
      if (!fixtureMode || !isProfileReady(state.profile)) return
      commit({ ...state, invites: state.invites.map(i => {
        const plan = publishedPlans.find(plan => plan.id === i.planId)
        const validContext = plan && (i.direction === 'incoming' ? plan.own : !plan.own && plan.author.id === i.personId)
        return i.id === id && i.status === 'waiting' && validContext ? { ...i, status: accept ? 'matched' : 'declined' } : i
      }) })
    },
    reset() {
      const normal = emptyState(), demo = emptyState()
      normalRef.current = normal; demoRef.current = demo
      setNormalData(normal); setDemoData(demo); setFixtureMode(false)
      persist(STORAGE_KEY, normal); persist(DEMO_STORAGE_KEY, demo); persist(MODE_STORAGE_KEY, false)
      notify('Данные на этом устройстве удалены')
    },
  }}>{children}</DemoContext.Provider>
}
