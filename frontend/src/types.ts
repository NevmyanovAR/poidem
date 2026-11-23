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
}

export type PlanInput = Pick<Plan, 'title' | 'category' | 'date' | 'time' | 'place' | 'description'>

// Only a verified server response may supply published plans and public author data.
export interface PublishedPlan extends Plan {
  author: { id: string; name: string }
}

export interface AppState {
  profile: Profile | null
  ownPlans: Plan[]
}
