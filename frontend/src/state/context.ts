import { createContext, useContext } from 'react'
import type { ApiClient } from '../api/client'
import type { AuthorizationState, AppState, Plan, PlanInput, Profile, PublishedPlan, PublicProfile, PairMatch, PlanResponse, ResponseCapacity, MatchContact, ActivityPage, ChatState, ChatMessage, MessagePage, ResponsePage } from '../types'
import type { CreationQuota } from '../lib/planRules'
import type { DialogPage, NavigationSummary } from '../types'

export interface AppContextValue {
  verification: Pick<ApiClient, 'verificationStatus' | 'verificationChallenge' | 'verificationSubmit' | 'verificationWithdraw' | 'verificationQueue' | 'verificationDetail' | 'verificationDecision' | 'mediaUrl'>
  places: Pick<ApiClient, 'searchPlaces' | 'resolvePlace' | 'proposePlace' | 'cataloguePlaces' | 'cataloguePlace' | 'editCataloguePlace' | 'decideCataloguePlace' | 'importCatalogue' | 'placeChecks' | 'decidePlaceCheck'>
  admin: Pick<ApiClient, 'adminAnalytics' | 'adminExport' | 'adminUsers' | 'adminUser' | 'adminPlans' | 'adminPlan' | 'adminSystem' | 'adminTeam' | 'adminRole' | 'adminAudit' | 'adminNotifications' | 'adminIdeas' | 'adminCreateIdea' | 'adminEditIdea' | 'adminIdeaCommand' | 'adminIdeaPhoto' | 'mediaUrl'>
  editorial: Pick<ApiClient, 'ideas' | 'idea' | 'mediaUrl'>
  trackPlanView: (id: string) => Promise<{ recorded: boolean }>
  navigationSummary: NavigationSummary | null
  refreshNavigation: () => Promise<void>
  activityRevision: number
  loadDialogs: (cursor?: string) => Promise<DialogPage>
  meeting: Pick<ApiClient, 'survey' | 'saveFeedback' | 'reliability' | 'impressions' | 'saveImpressions' | 'withdrawImpressions'>
  safety: Pick<ApiClient, 'report' | 'block' | 'blocks' | 'unblock' | 'adminSession' | 'adminReports' | 'adminReport' | 'adminDecision' | 'reportPhotoUrl'>
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
  loadActivity: (scope: 'active' | 'archive', includeHidden: boolean, cursor?: string, planId?: string, view?: 'all' | 'own') => Promise<ActivityPage>
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
