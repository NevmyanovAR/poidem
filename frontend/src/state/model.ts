import type { AppState } from '../types'

export const emptyState = (): AppState => ({ profile: null, ownPlans: [] })
