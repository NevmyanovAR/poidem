import { expect, test, type Page } from '@playwright/test'
import { author, responder, launch, matchId, planId, scenario } from './connectionScenario'
import type { SurveyState, MeetingOutcome } from '../src/api/feedback'

const own = { met: true, rating: 4, comment: 'Личный тестовый комментарий', submitted: true, updated_at: '2026-11-25T10:00:00Z' }
const initial = (): SurveyState => ({ availability: 'available', can_answer: true, opens_at: '2026-11-25T09:00:00Z', closes_at: '2026-12-01T07:00:00Z', policy_version: 'D53-2h-1to5-optional-comment-edit7d', own_answer: null, other_answered: false, result: { result: 'no_data', author_answered: false, responder_answered: false } })

async function install(page: Page, viewer = author) {
  const mock = scenario(); mock.state.matched = true
  await mock.install(page, viewer)
  const state = { view: initial(), fail: false, writes: [] as unknown[] }
  await page.route(`**/api/v1/matches/${matchId}`, route => {
    const match = mock.match(viewer)
    return route.fulfill({ json: { match: { ...match, participants: match.participants.map(participant => ({ ...participant, profile: { ...participant.profile, experience: { unique_confirmed_partners: state.view.result.result === 'mutual_yes' ? 1 : 0, policy_version: 'D58-mutual-unique-partners-v1' } } })) } } })
  })
  await page.route(`**/api/v1/matches/${matchId}/survey`, route => state.fail ? route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Не удалось загрузить ответы' } } }) : route.fulfill({ json: state.view }))
  await page.route(`**/api/v1/matches/${matchId}/feedback`, route => {
    const body = route.request().postDataJSON(); state.writes.push(body)
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-only')
    expect(route.request().headers()['x-account-context']).toBe(viewer)
    state.view = { ...state.view, own_answer: { ...body, submitted: true, updated_at: own.updated_at }, result: { result: state.view.other_answered ? body.met ? 'mutual_yes' : 'conflicting' : 'insufficient', author_answered: viewer === author || state.view.other_answered, responder_answered: viewer === responder || state.view.other_answered } }
    return route.fulfill({ json: state.view })
  })
  return state
}

for (const viewer of [author, responder]) test(`meeting outcomes and own status are clear for ${viewer === author ? 'author' : 'candidate'}`, async ({ page }) => {
  test.setTimeout(60000)
  const state = await install(page, viewer)
  const panel = page.getByRole('region', { name: 'Итоги встречи' })
  let first = true
  for (const [result, text, mine, other] of [
    ['mutual_yes', 'Оба подтвердили встречу', true, true],
    ['mutual_no', 'По ответам обоих встреча не состоялась', true, true],
    ['conflicting', 'Ответы не совпали', true, true],
    ['insufficient', 'Ожидаем ответ второго участника', true, false],
    ['insufficient', 'Остался твой ответ', false, true],
    ['no_data', 'Нет данных о встрече', false, false],
  ] as const) {
    state.view = { ...initial(), own_answer: mine ? { ...own, met: result !== 'mutual_no', rating: result === 'mutual_no' ? null : 4 } : null, other_answered: other, result: { result: result as MeetingOutcome, author_answered: viewer === author ? mine : other, responder_answered: viewer === responder ? mine : other } }
    if (first) { first = false; await launch(page, `/match/${matchId}`) }
    else await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(panel.getByRole('status')).toHaveText(text)
    if (mine) await expect(panel.getByText('Твой ответ сохранён', { exact: true })).toBeVisible()
    await expect(panel).toContainText('По ответам участников, без проверки факта встречи')
    await expect(panel.getByText('Личный тестовый комментарий', { exact: true })).toHaveCount(0)
  }
})

test('answer and edit use the existing survey without Telegram delivery or private identity fields', async ({ page }) => {
  const state = await install(page)
  state.view.other_answered = true
  await launch(page, `/match/${matchId}`)
  const panel = page.getByRole('region', { name: 'Итоги встречи' })
  await panel.getByRole('button', { name: 'Да', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Да', exact: true })).toHaveCSS('background-color', 'rgb(184, 228, 255)')
  await expect(panel.getByRole('button', { name: 'Нет', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(panel.getByRole('button', { name: 'Сохранить ответ' })).toBeDisabled()
  await panel.getByLabel('Твоя оценка встречи').selectOption('5')
  await panel.getByLabel('Комментарий · необязательно').fill('Мой собственный комментарий')
  await panel.getByRole('button', { name: 'Сохранить ответ' }).click()
  await expect(panel.getByRole('status')).toHaveText('Оба подтвердили встречу')
  await expect(page.getByRole('region', { name: 'Анкета партнёра' }).getByText('Есть подтверждённые встречи', { exact: true })).toBeVisible()
  expect(state.writes).toEqual([{ met: true, rating: 5, comment: 'Мой собственный комментарий' }])
  await panel.getByRole('button', { name: 'Изменить ответ' }).click()
  await expect(panel.getByLabel('Комментарий · необязательно')).toHaveValue('Мой собственный комментарий')
  await panel.getByRole('button', { name: 'Нет', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Нет', exact: true })).toHaveCSS('background-color', 'rgb(184, 228, 255)')
  await panel.getByRole('button', { name: 'Сохранить ответ' }).click()
  await expect(panel).toContainText('Твой ответ: Нет')
  await expect(page.getByRole('region', { name: 'Анкета партнёра' }).locator('.experience-badge')).toHaveCount(0)
  expect(state.writes[1]).toEqual({ met: false, rating: null, comment: null })
})

test('expired archive keeps outcomes without answering; errors retry without fabricated result', async ({ page }) => {
  const state = await install(page)
  state.fail = true
  await launch(page, `/match/${matchId}`)
  const panel = page.getByRole('region', { name: 'Итоги встречи' })
  await expect(panel.getByRole('alert')).toContainText('Не удалось загрузить ответы')
  await expect(panel.getByText('Нет данных о встрече', { exact: true })).toHaveCount(0)
  state.fail = false
  state.view = { ...initial(), availability: 'expired', can_answer: false, own_answer: own, other_answered: true, result: { result: 'mutual_yes', author_answered: true, responder_answered: true } }
  await panel.getByRole('button', { name: 'Повторить загрузку' }).click()
  await expect(panel.getByRole('status')).toHaveText('Оба подтвердили встречу')
  await expect(panel.getByRole('button')).toHaveCount(0)
  await expect(panel).toContainText('Срок изменения ответа прошёл')
  expect(state.writes).toEqual([])
})

test('public experience badge hides totals and details fit mobile and desktop', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const state = await install(page)
  state.view.own_answer = own; state.view.other_answered = true
  state.view.result = { result: 'conflicting', author_answered: true, responder_answered: true }
  await page.route(`**/api/v1/plans/${planId}/author`, route => route.fulfill({ json: { profile: { name: 'Тестовый участник', age: 24, bio: 'Синтетическая анкета', interests: ['Искусство', 'Кофе', 'Прогулки'], photo: { url: '/images/gallery.jpeg' }, experience: { unique_confirmed_partners: 3, policy_version: 'D58-mutual-unique-partners-v1' } } } }))
  await launch(page, `/people/${planId}`)
  await expect(page.getByText('Есть подтверждённые встречи', { exact: true })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('Взаимные подтверждения · 3')
  await launch(page, `/match/${matchId}`)
  const panel = page.getByRole('region', { name: 'Итоги встречи' })
  await expect(panel.getByRole('status')).toHaveText('Ответы не совпали')
  await panel.getByRole('button', { name: 'Изменить ответ' }).click()
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 })
    await page.evaluate(() => document.fonts.ready)
    await panel.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const form = (await panel.boundingBox())!, input = (await panel.locator('textarea').boundingBox())!
    expect(input.x).toBeGreaterThanOrEqual(form.x)
    expect(input.x + input.width).toBeLessThanOrEqual(form.x + form.width + 1)
    await page.screenshot({ path: testInfo.outputPath(`meeting-${width}.png`) })
  }
  await page.getByRole('link', { name: /^Открыть чат/ }).click()
  await expect(page).toHaveURL(new RegExp(`/match/${matchId}/chat$`))
})

test('existing admin sees only scoped meeting result and no new sanctions', async ({ page }) => {
  await install(page)
  const reportId = '00000000-0000-4000-8000-000000000808'
  const report = { id: reportId, state: 'pending', target_type: 'match', reason_code: 'harassment', created_at: own.updated_at }
  await page.route('**/api/v1/admin/session', route => route.fulfill({ json: { role: 'admin' } }))
  await page.route('**/api/v1/admin/reports?**', route => route.fulfill({ json: { items: [report], next_cursor: null } }))
  await page.route(`**/api/v1/admin/reports/${reportId}`, route => route.fulfill({ json: { ...report, comment: null, evidence: { title: 'Тестовый план' }, can_hide_plan: false, decisions: [], meeting_review: { match_id: matchId, current: { result: 'mutual_yes', author_answered: true, responder_answered: true }, at_report: { result: 'conflicting', author_answered: true, responder_answered: true } } } }))
  await launch(page, '/admin')
  await page.locator('.admin-report').click()
  const review = page.getByRole('region', { name: 'Результат опроса по жалобе' })
  await expect(review).toContainText('Оба подтвердили встречу')
  await expect(review).toContainText('При подаче жалобы: Ответы не совпали')
  await expect(review).toContainText('Автор: ответил · Кандидат: ответил')
  await expect(review.locator('button,textarea')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Скрыть план', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /нарушение|неявк|штраф|бан/i })).toHaveCount(0)
})
