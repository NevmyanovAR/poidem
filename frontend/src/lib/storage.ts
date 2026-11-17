import type { DemoState, Profile } from '../types'

export const STORAGE_KEY = 'poidem:demo:v1'
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

export function readDemo(): DemoState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return emptyState()
    const s = parsed as Record<string, unknown>
    if (s.version !== 1 || (s.profile !== null && !validProfile(s.profile))) return emptyState()
    if (!Array.isArray(s.selectedIds) || !s.selectedIds.every(id => typeof id === 'string')) return emptyState()
    if (!Array.isArray(s.ownPlans) || !s.ownPlans.every(p => p && typeof p === 'object' && ['id','title','date','time','place','description','image','label','category'].every(key => typeof p[key] === 'string') && p.own === true && p.image.startsWith('/images/'))) return emptyState()
    if (!Array.isArray(s.invites) || !s.invites.every(i => i && typeof i === 'object' && ['id','planId','personId'].every(key => typeof i[key] === 'string') && ['waiting', 'matched'].includes(i.status))) return emptyState()
    return s as unknown as DemoState
  } catch {
    return emptyState()
  }
}
