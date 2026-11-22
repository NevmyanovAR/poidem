import { createContext, useContext } from 'react'
import type { AuthorizationState, AppState, Plan, Profile, PublishedPlan } from '../types'
import type { CreationQuota } from '../lib/planRules'

export interface AppContextValue {
  data: AppState
  plans: Plan[]
  publishedPlans: PublishedPlan[]
  authorization: AuthorizationState
  dailyQuota: CreationQuota
  toast: string
  notify: (text: string) => void
  saveProfile: (profile: Profile, file?: File | null) => Promise<boolean>
  busy: boolean
  deleteAccount: () => Promise<boolean>
  retryAuthorization: () => Promise<void>
  createPlan: (plan: Plan) => boolean
  reset: () => void
}
export const AppContext = createContext<AppContextValue | null>(null)
export function useAppData() {
  const value = useContext(AppContext)
  if (!value) throw new Error('ApiProvider is missing')
  return value
}
