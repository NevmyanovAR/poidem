import type { DemoState, Profile } from '../types'

// Keep the existing browser draft key for backwards compatibility.
export const STORAGE_KEY = 'poidem:demo:v1'
export const DEMO_STORAGE_KEY = 'poidem:simulation:v1'
export const MODE_STORAGE_KEY = 'poidem:demo-mode:v1'
export function readDemoMode(): boolean {
  try { return localStorage.getItem(MODE_STORAGE_KEY) === 'true' } catch { return false }
}
export const emptyState = (): DemoState => ({ version: 1, profile: null, ownPlans: [], selectedIds: [], invites: [] })

function validProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return ['name', 'age', 'photo', 'bio'].every(key => typeof p[key] === 'string')
    && ['woman', 'man', 'other'].includes(String(p.gender))
    && ['women', 'men', 'any'].includes(String(p.preference))
    && Array.isArray(p.interests) && p.interests.every(i => typeof i === 'string')
    && (String(p.photo).startsWith('data:image/') || String(p.photo).startsWith('/images/'))
}

export function readDemo(key = STORAGE_KEY): DemoState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return emptyState()
    const s = parsed as Record<string, unknown>
    if (s.version !== 1 || (s.profile !== null && !validProfile(s.profile))) return emptyState()
    if (!Array.isArray(s.selectedIds) || !s.selectedIds.every(id => typeof id === 'string')) return emptyState()
    if (!Array.isArray(s.ownPlans) || !s.ownPlans.every(p => p && typeof p === 'object' && ['id','title','date','time','place','description','image','label','category'].every(key => typeof p[key] === 'string') && p.own === true && p.image.startsWith('/images/') && (p.createdAt === undefined || (typeof p.createdAt === 'string' && Number.isFinite(Date.parse(p.createdAt)))) && (p.moderation === undefined || (p.moderation && ['not_submitted', 'pending', 'approved', 'rejected', 'blocked'].includes(p.moderation.status) && ['local_text', 'demo', 'server'].includes(p.moderation.source) && (p.moderation.reason === undefined || typeof p.moderation.reason === 'string'))) && (p.published === undefined || typeof p.published === 'boolean'))) return emptyState()
    if (!Array.isArray(s.invites) || !s.invites.every(i => i && typeof i === 'object' && ['id','planId','personId'].every(key => typeof i[key] === 'string') && ['waiting', 'matched', 'declined'].includes(i.status) && (i.responderId === undefined || typeof i.responderId === 'string') && (i.direction === undefined || ['incoming', 'outgoing'].includes(i.direction)))) return emptyState()
    const data = s as unknown as DemoState
    // Old simulated interests are never interpreted as real user responses.
    if (key === STORAGE_KEY) return { ...data, selectedIds: data.selectedIds.filter(id => !id.startsWith('demo-')), invites: [] }
    return data
  } catch {
    return emptyState()
  }
}
