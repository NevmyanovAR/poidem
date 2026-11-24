import { expect, test } from '@playwright/test'
import { creationQuota, planTextErrors, responseCapacity } from '../src/lib/planRules'
import type { Plan } from '../src/types'
import cases from '../../backend/tests/fixtures/content_cases.json' with { type: 'json' }
import policy from '../src/config/contentPolicy.generated.json' with { type: 'json' }
import { contentError } from '../src/lib/contentFilter'

const example = (id: string, createdAt?: string): Plan => ({ id, title: 'Кофе', category: 'Кофе и еда', date: '2026-12-01', time: '12:00', place: 'Кафе', description: '', image: '/images/gallery.jpeg', label: 'Черновик', own: true, createdAt })

test('client uses the shared server corpus, including neutral discussion and forbidden locations', () => {
  for (const sample of cases) expect(!contentError(sample.text), sample.text).toBe(sample.allowed)
})

test('every exported profanity form is recognized locally in all three plan fields', () => {
  for (const word of [...policy.russian, ...policy.english]) expect(contentError(word), word).toBeTruthy()
  for (const field of ['title', 'description', 'place'] as const) {
    expect(planTextErrors({ title: 'Кофе', description: '', place: 'Музей', [field]: 'хуй' })[field]).toBeTruthy()
  }
})

test('forbidden venue topics recognize case, punctuation, spaces and simple spellings', () => {
  for (const title of ['СТРИП-КЛУБ', 'В стрип   клубе', 'В стриптиз-клуб', 'с т р и п к л у б', 'cтpип клyб', 'Strip Club', 'stripclub', 'ЗАБРОШКИ', 'зaброшкa', 'заброшенные здания', 'в заброшенном сооружении', 'заброшенный завод', 'abandoned building']) {
    expect(Object.keys(planTextErrors({ title, description: '' })).length, title).toBeGreaterThan(0)
  }
  expect(planTextErrors({ title: 'Кофе', description: 'Пойдём в заброшку' }).description).toBeTruthy()
  expect(planTextErrors({ title: 'Пойдём в стрип', description: 'клуб' }).description).toBeTruthy()
})

test('harmless words and user input are preserved', () => {
  for (const title of ['Клубника и стрипсы', 'Клуб любителей музыки', 'Стриппер для проводов', 'Заброшенный парк', 'Шахматы и кофе', 'Незаброшенное здание', 'Заброшенные шахматы', 'Стрипклубника']) {
    expect(planTextErrors({ title, description: '' }), title).toEqual({})
  }
  const input = { title: '  СТРИП-КЛУБ  ', description: 'Мои слова остаются' }
  const copy = { ...input }
  planTextErrors(input)
  expect(input).toEqual(copy)
})

test('response capacity excludes the author and deduplicates people across entries', () => {
  const records = [
    { id: 'a', planId: 'p', personId: 'one', responderId: 'one', direction: 'incoming', status: 'waiting' },
    { id: 'b', planId: 'p', personId: 'one', responderId: 'one', direction: 'incoming', status: 'rejected' },
    { id: 'c', planId: 'p', personId: 'author', responderId: 'author', direction: 'incoming', status: 'waiting' },
    { id: 'd', planId: 'other', personId: 'two', responderId: 'two', direction: 'incoming', status: 'waiting' },
  ]
  expect(responseCapacity('p', 'author', 'one', records)).toEqual({ count: 1, maximum: 15, full: false, alreadyResponded: true })
  const records14 = Array.from({ length: 14 }, (_, i) => ({ planId: 'p', responderId: 'visitor-' + i }))
  expect(responseCapacity('p', 'author', 'new-user', records14).full).toBe(false)
  const full = responseCapacity('p', 'author', 'new-user', [...records, ...records14])
  expect(full.count).toBe(15)
  expect(full.full).toBe(true)
  expect(full.alreadyResponded).toBe(false)
})

test('rejected and closed responses release the waiting capacity', () => {
  const value = responseCapacity('p', 'owner', 'guest', [
    { planId: 'p', responderId: 'guest', status: 'rejected' },
    { planId: 'p', responderId: 'another', status: 'closed' },
    { planId: 'p', responderId: 'new', status: 'waiting' },
  ])
  expect(value.count).toBe(1)
  expect(value.alreadyResponded).toBe(false)
})

test('creation quota handles the third plan, duplicate IDs and the next local calendar day', () => {
  const now = new Date(2026, 10, 18, 23, 59, 59)
  const createdAt = new Date(2026, 10, 18, 12).toISOString()
  const plans = ['a', 'b', 'c'].map(id => example(id, createdAt))
  expect(creationQuota(plans, now).remaining).toBe(0)
  expect(creationQuota([...plans, plans[0]], now).used).toBe(3)
  expect(creationQuota(plans.slice(0, 2), now).remaining).toBe(1)
  expect(creationQuota(plans, new Date(2026, 10, 19, 0, 0, 1)).remaining).toBe(3)
  expect(creationQuota([example('legacy'), { ...example('foreign', createdAt), own: false }], now).used).toBe(0)
})
