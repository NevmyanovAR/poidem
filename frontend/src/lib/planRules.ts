import { PLAN_LIMITS, PLAN_TEXT_RULES } from '../config/planRules'
import type { DemoInvite, Plan } from '../types'

const lookalikes: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н' }

export function normalizedPlanText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/[\p{P}\p{Z}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    .replace(/[\p{L}\p{N}]+/gu, word => /[а-я]/u.test(word) ? [...word].map(letter => lookalikes[letter] ?? letter).join('') : word)
}

export function planTextErrors(plan: Pick<Plan, 'title' | 'description'>): Partial<Record<'title' | 'description', string>> {
  const errors: Partial<Record<'title' | 'description', string>> = {}
  for (const field of ['title', 'description'] as const) {
    const normalized = normalizedPlanText(plan[field])
    const rule = PLAN_TEXT_RULES.find(rule => rule.patterns.some(pattern => pattern.test(normalized)))
    if (rule) errors[field] = rule.message
  }
  if (!errors.title && !errors.description) {
    const combined = normalizedPlanText(`${plan.title} ${plan.description}`)
    const rule = PLAN_TEXT_RULES.find(rule => rule.patterns.some(pattern => pattern.test(combined)))
    if (rule) errors.description = rule.message
  }
  return errors
}

export function calendarDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export interface CreationQuota { used: number; remaining: number; maximum: number; day: string }
export function creationQuota(plans: readonly Plan[], now = new Date()): CreationQuota {
  const day = calendarDay(now)
  const ids = new Set(plans.filter(plan => plan.own && plan.createdAt && calendarDay(new Date(plan.createdAt)) === day).map(plan => plan.id))
  return { day, used: ids.size, remaining: Math.max(0, PLAN_LIMITS.creationsPerDay - ids.size), maximum: PLAN_LIMITS.creationsPerDay }
}

export interface ResponseCapacity { count: number; maximum: number; full: boolean; alreadyResponded: boolean }
export function responseCapacity(planId: string, authorId: string, viewerId: string, invites: readonly DemoInvite[], seededIds: readonly string[] = []): ResponseCapacity {
  // Count distinct people; status transitions never invent a quota-release policy.
  const ids = new Set(seededIds)
  for (const invite of invites) {
    if (invite.planId !== planId) continue
    ids.add(invite.responderId ?? (invite.direction === 'incoming' ? invite.personId : viewerId))
  }
  ids.delete(authorId)
  ids.delete('')
  return { count: ids.size, maximum: PLAN_LIMITS.responsesPerPlan, full: ids.size >= PLAN_LIMITS.responsesPerPlan, alreadyResponded: ids.has(viewerId) }
}
