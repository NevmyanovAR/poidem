export type Gender = 'woman' | 'man' | 'other'
export type Preference = 'women' | 'men' | 'any'
export type Category = 'Все планы' | 'Искусство' | 'Кофе и еда' | 'Прогулки' | 'Впечатления'

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
  status: 'waiting' | 'matched'
}

export interface DemoState {
  version: 1
  profile: Profile | null
  ownPlans: Plan[]
  selectedIds: string[]
  invites: DemoInvite[]
}
