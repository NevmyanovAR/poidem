import type { PairMatch, Plan, PlanResponse, PublicProfile } from '../types'

export type RecordAction = 'write' | 'details' | 'status' | 'incoming' | 'edit' | 'publish' | 'cancel' | 'accept' | 'decline' | 'view'
type Record = { kind: 'match'; value: PairMatch } | { kind: 'plan'; value: Plan } | { kind: 'response'; value: PlanResponse }

// Доступность для UI по серверному статусу/роли; API независимо проверяет права.
export function recordActions(record: Record): RecordAction[] {
  if (record.kind === 'match') return ['write', 'details']
  if (record.kind === 'plan') {
    const plan = record.value
    if (!plan.own || plan.archived) return []
    const actions: RecordAction[] = ['status', 'incoming']
    actions.push(...(plan.allowedActions ?? []))
    return actions
  }
  const response = record.value
  if (response.status === 'accepted' && response.match) return ['write', 'details']
  if (!isActiveResponse(response)) return []
  if (response.viewerRole === 'author') return response.profile ? ['accept', 'decline'] : ['decline']
  return response.viewerRole === 'responder' ? ['view'] : []
}

export function isActiveResponse(response: PlanResponse): boolean {
  return response.status === 'waiting' && response.displayStatus === 'waiting' && !response.archived && response.plan?.publicationStatus === 'published'
}

export function responseEventTime(response: PlanResponse): number {
  const stamp = response.displayStatus === 'expired' ? response.plan?.startsAt : response.decidedAt
  return Date.parse(stamp ?? response.createdAt)
}

export function matchPartner(pair: PairMatch): PublicProfile | null {
  if (pair.viewerRole !== 'author' && pair.viewerRole !== 'responder') return null
  return pair.participants.find(participant => participant.role !== pair.viewerRole)?.profile ?? null
}
