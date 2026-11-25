import { createContext, useContext } from 'react'
import type { AuthorizationState, AppState, Plan, PlanInput, Profile, PublishedPlan, PublicProfile, PairMatch, PlanResponse, ResponseCapacity, MatchContact, ActivityPage, ChatState, ChatMessage, MessagePage, ResponsePage } from '../types'
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
  createPlan: (plan: PlanInput, key: string) => Promise<boolean>
  editPlan: (plan: Plan, fields: PlanInput) => Promise<boolean>
  publishPlan: (plan: Plan) => Promise<boolean>
  cancelPlan: (plan: Plan) => Promise<boolean>
  refreshPlans: () => Promise<void>
  plansLoading: boolean
  plansError: string
  planError: string
  reset: () => void
  incomingResponses: PlanResponse[]
  outgoingResponses: PlanResponse[]
  matches: PairMatch[]
  connectionsLoading: boolean
  connectionsError: string
  refreshConnections: () => Promise<void>
  loadPlan: (id: string) => Promise<PublishedPlan>
  loadAuthor: (id: string) => Promise<PublicProfile>
  loadCapacity: (id: string) => Promise<ResponseCapacity>
  loadMatch: (id: string) => Promise<PairMatch>
  loadContact: (id: string) => Promise<MatchContact>
  loadPlanResponses: (id: string, cursor?: string) => Promise<ResponsePage>
  loadActivity: (scope: 'active' | 'archive', includeHidden: boolean, cursor?: string, planId?: string) => Promise<ActivityPage>
  hideArchive: (planId: string, hidden: boolean) => Promise<void>
  loadChat: (id: string) => Promise<ChatState>
  loadMessages: (id: string, direction?: { before?: number; after?: number }) => Promise<MessagePage>
  sendMessage: (id: string, text: string, clientId: string) => Promise<ChatMessage>
  readChat: (id: string, sequence: number) => Promise<ChatState>
  respond: (plan: Plan, key: string) => Promise<PlanResponse | null>
  decide: (response: PlanResponse, decision: 'accept' | 'decline') => Promise<PlanResponse | null>
}
export const AppContext = createContext<AppContextValue | null>(null)
export function useAppData() {
  const value = useContext(AppContext)
  if (!value) throw new Error('ApiProvider is missing')
  return value
}
