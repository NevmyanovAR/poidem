import { PLAN_LIMITS } from '../config/planRules'
import { contentError, normalizedContentText } from './contentFilter'
import type { Plan } from '../types'

export const normalizedPlanText = normalizedContentText

export function planTextErrors(plan: Pick<Plan, 'title' | 'description'> & Partial<Pick<Plan, 'place'>>): Partial<Record<'title' | 'description' | 'place', string>> {
  const errors: Partial<Record<'title' | 'description' | 'place', string>> = {}
  for (const field of ['title', 'description', 'place'] as const) {
    const message = contentError(plan[field] ?? '')
    if (message) errors[field] = message
  }
  if (!errors.title && !errors.description && !errors.place) {
    const message = contentError(`${plan.title} ${plan.description} ${plan.place ?? ''}`)
    if (message) for (const field of ['title', 'description', 'place'] as const) errors[field] = message
  }
  return errors
}

export function calendarDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export interface CreationQuota { used: number; remaining: number; maximum: number; day: string; timeZone?: string; ready?: boolean }
export function creationQuota(plans: readonly Plan[], now = new Date()): CreationQuota {
  const day = calendarDay(now)
  const ids = new Set(plans.filter(plan => plan.own && plan.createdAt && calendarDay(new Date(plan.createdAt)) === day).map(plan => plan.id))
  return { day, used: ids.size, remaining: Math.max(0, PLAN_LIMITS.creationsPerDay - ids.size), maximum: PLAN_LIMITS.creationsPerDay }
}

export interface ResponseCapacity { count: number; maximum: number; full: boolean; alreadyResponded: boolean }
export function responseCapacity(planId: string, authorId: string, viewerId: string, responses: readonly { planId: string; responderId: string }[]): ResponseCapacity {
  // Count distinct people; status transitions never invent a quota-release policy.
  const ids = new Set<string>()
  for (const response of responses) {
    if (response.planId !== planId) continue
    ids.add(response.responderId)
  }
  ids.delete(authorId)
  ids.delete('')
  return { count: ids.size, maximum: PLAN_LIMITS.responsesPerPlan, full: ids.size >= PLAN_LIMITS.responsesPerPlan, alreadyResponded: ids.has(viewerId) }
}
