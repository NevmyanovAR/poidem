import { createContext, useContext } from 'react'
import type { DemoInvite, DemoState, Plan, Profile } from '../types'

export interface DemoContextValue {
  data: DemoState
  plans: Plan[]
  toast: string
  storageError: boolean
  notify: (text: string) => void
  saveProfile: (profile: Profile) => void
  selectPlan: (id: string) => void
  createPlan: (plan: Plan) => void
  invite: (planId: string, personId: string) => DemoInvite
  simulateReply: (id: string) => void
  reset: () => void
}
export const DemoContext = createContext<DemoContextValue | null>(null)
export function useDemo() {
  const value = useContext(DemoContext)
  if (!value) throw new Error('DemoProvider is missing')
  return value
}
