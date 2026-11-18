export type Gender = 'woman' | 'man' | 'other'
export type Preference = 'women' | 'men' | 'any'
export type Category = 'Все планы' | 'Искусство' | 'Кофе и еда' | 'Прогулки' | 'Впечатления'

// A verified state may only come from a future authenticated backend response.
export type AuthorizationState =
  | { status: 'unverified' }
  | { status: 'checking' }
  | { status: 'verified'; telegramUserId: string; verifiedAt: string }
  | { status: 'error'; message: string }

// The two moderation stages are deliberately unspecified until product clarification.
export interface ModerationState {
  status: 'not_submitted' | 'pending' | 'approved' | 'rejected' | 'blocked'
  source: 'local_text' | 'demo' | 'server'
  reason?: string
}

export type ReliabilityState = { kind: 'unavailable' } | {
  kind: 'demo'
  label: string
  confirmedMeetings: number
  cancellations: number
  confirmedNoShows: number
  participations: number
}

export interface Profile {
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
}

// Only a verified server response may supply published plans and public author data.
export interface PublishedPlan extends Plan {
  author: { id: string; name: string }
  isDemo?: boolean
}

export interface DemoPerson {
  id: string
  name: string
  age: number
  gender: Gender
  preference: Preference
  photo: string
  bio: string
  interests: string[]
  scenarios: string[]
}

export interface DemoInvite {
  id: string
  planId: string
  personId: string
  status: 'waiting' | 'matched' | 'declined'
  direction?: 'outgoing' | 'incoming'
  responderId?: string
}

export interface DemoState {
  version: 1
  profile: Profile | null
  ownPlans: Plan[]
  selectedIds: string[]
  invites: DemoInvite[]
}
