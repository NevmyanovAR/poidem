import { createContext, useContext } from 'react'
import type { AuthorizationState, DemoInvite, DemoState, Plan, Profile, PublishedPlan } from '../types'
import type { CreationQuota, ResponseCapacity } from '../lib/planRules'

export interface DemoContextValue {
  data: DemoState
  plans: Plan[]
  publishedPlans: PublishedPlan[]
  fixtureMode: boolean
  authorization: AuthorizationState
  dailyQuota: CreationQuota
  responseInfo: (planId: string) => ResponseCapacity | null
  setDemoMode: (enabled: boolean) => void
  publishPlan: (id: string) => boolean
  simulateIncoming: (planId: string) => void
  respondToInvite: (id: string, accept: boolean) => void
  toast: string
  storageError: boolean
  notify: (text: string) => void
  saveProfile: (profile: Profile) => void
  selectPlan: (id: string) => void
  createPlan: (plan: Plan) => boolean
  invite: (planId: string, personId: string) => DemoInvite | undefined
  reset: () => void
}
export const DemoContext = createContext<DemoContextValue | null>(null)
export function useDemo() {
  const value = useContext(DemoContext)
  if (!value) throw new Error('DemoProvider is missing')
  return value
}
