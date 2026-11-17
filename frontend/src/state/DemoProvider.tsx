import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEMO_PLANS } from '../data/demo'
import { emptyState, readDemo, STORAGE_KEY } from '../lib/storage'
import type { DemoState } from '../types'
import { DemoContext } from './context'

export function DemoProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(readDemo)
  const [toast, setToast] = useState('')
  const [storageError, setStorageError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function commit(next: DemoState) {
    setData(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setStorageError(false) }
    catch { setStorageError(true) }
  }
  function notify(message: string) {
    clearTimeout(timer.current)
    setToast(message)
    timer.current = setTimeout(() => setToast(''), 4500)
  }

  return <DemoContext.Provider value={{
    data, plans: [...DEMO_PLANS, ...data.ownPlans], toast, storageError, notify,
    saveProfile(profile) { commit({ ...data, profile }) },
    selectPlan(id) {
      if (!data.selectedIds.includes(id)) commit({ ...data, selectedIds: [...data.selectedIds, id] })
    },
    createPlan(plan) { commit({ ...data, ownPlans: [...data.ownPlans, plan] }); notify('План сохранён.') },
    invite(planId, personId) {
      const existing = data.invites.find(i => i.planId === planId && i.personId === personId)
      if (existing) return existing
      const entry = { id: crypto.randomUUID(), planId, personId, status: 'waiting' as const }
      commit({ ...data, selectedIds: [...new Set([...data.selectedIds, planId])], invites: [...data.invites, entry] })
      return entry
    },
    simulateReply(id) { commit({ ...data, invites: data.invites.map(i => i.id === id ? { ...i, status: 'matched' } : i) }) },
    reset() {
      commit(emptyState())
      notify('Данные на этом устройстве удалены.')
    },
  }}>{children}</DemoContext.Provider>
}
