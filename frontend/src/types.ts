export type Gender = 'woman' | 'man' | 'other'
export type Preference = 'women' | 'men' | 'any'
export type Category = 'Все планы' | 'Искусство' | 'Кофе и еда' | 'Прогулки' | 'Впечатления'

// A verified state may only come from an authenticated backend response.
export type AuthorizationState =
  | { status: 'unverified' }
  | { status: 'checking' }
  | { status: 'verified'; userId: string; verifiedAt: string }
  | { status: 'error'; message: string }

// The two moderation stages are deliberately unspecified until product clarification.
export interface ModerationState {
  status: 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'blocked'
  source: 'local_text' | 'server'
  reason?: string
}

export interface Profile {
  userId?: string
  photoId?: string
  serverVersion?: number
  name: string
  age: string
  gender: Gender | ''
  preference: Preference | ''
  photo: string
  bio: string
  interests: string[]
}

export interface Plan {
  id: string
  title: string
  category: Exclude<Category, 'Все планы'>
  date: string
  time: string
  place: string
  description: string
  image: string
  label: string
  own?: boolean
  published?: boolean
  createdAt?: string
  moderation?: ModerationState
  serverVersion?: number
  publicationStatus?: 'draft' | 'submitted' | 'published' | 'closed' | 'cancelled'
  startsAt?: string
  timeZone?: string
  updatedAt?: string
  archived?: boolean
}

export type PlanInput = Pick<Plan, 'title' | 'category' | 'date' | 'time' | 'place' | 'description'>

export interface PublicProfile {
  name: string; age: number; bio: string; interests: string[]; photo: string
}
export interface PlanResponse {
  id: string; planId: string; plan: PublishedPlan | null
  status: 'waiting' | 'accepted' | 'rejected' | 'closed'
  displayStatus: 'waiting' | 'accepted' | 'rejected' | 'closed' | 'expired' | 'cancelled' | 'unavailable'
  decidedAt: string | null
  version: number; createdAt: string; profile: PublicProfile | null; matchId: string | null
  archived?: boolean
  viewerRole: 'author' | 'responder'
  historyContext: { planTitle: string; authorName: string; responderName: string; responderAge: number; capturedAt: string; source: 'response' | 'legacy' } | null
  match: PairMatch | null
}
export interface ResponsePage { items: PlanResponse[]; nextCursor: string | null }
export interface PairMatch {
  id: string; planId: string; title: string; image: string; startsAt: string
  timeZone: string; place: string; createdAt: string
  participants: { role: 'author' | 'responder'; profile: PublicProfile | null }[]
  unreadCount: number; archived: boolean; meetingCancelled: boolean
  viewerRole: 'author' | 'responder'
}
export interface ResponseCapacity {
  count: number; maximum: number; remaining: number; canRespond: boolean; ownResponseId: string | null
}
export interface MatchContact { available: boolean; telegramUrl: string | null; reason: string | null }

export interface ChatMessage { id: string; sequence: number; sender: 'self' | 'other'; text: string; createdAt: string; clientId: string | null }
export interface ChatState { matchId: string; lastSequence: number; lastReadSequence: number; otherLastReadSequence: number; unreadCount: number; canSend: boolean; meetingCancelled: boolean; archived: boolean }
export interface MessagePage { items: ChatMessage[]; nextBefore: number | null; hasMore: boolean }
export interface ActivityItem { key: string; kind: 'plan' | 'incoming' | 'outgoing' | 'match'; planId: string; archived: boolean; hidden: boolean; plan: PublishedPlan | null; response: PlanResponse | null; match: PairMatch | null }
export interface ActivityPage { items: ActivityItem[]; nextCursor: string | null }

// Only a verified server response may supply published plans and public author data.
export interface PublishedPlan extends Plan {
  author: { id: string; name: string }
}

export interface AppState {
  profile: Profile | null
  ownPlans: Plan[]
}
