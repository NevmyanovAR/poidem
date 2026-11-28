import { expect, test, type Page } from '@playwright/test'
import { responder, launch, matchId, planId, scenario } from './connectionScenario'
import type { ImpressionState } from '../src/api/feedback'

async function install(page: Page) {
  const mock = scenario(); mock.state.matched = true
  await mock.install(page, responder)
  const state = { mutual: true, status: 'pending', version: 1, photo: false, experience: 0, pleasant: false, own: [] as string[], impressionWrites: [] as unknown[], checkWrites: [] as unknown[] }
  const check = () => ({ id: planId, plan_id: planId, plan_title: 'План с длинным названием для проверки интерфейса', author_name: 'Синтетический автор', name: 'Кафе с длинным названием', address: 'Тестовый город, улица Примерная, 1. Вход А', legacy_place: '', status: state.status, revision: 1, version: state.version, reason: null, checked_at: null, publication_status: 'published' })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    const json = (value: unknown) => route.fulfill({ json: value })
    const experience = { unique_confirmed_partners: state.experience, pleasant_communication: state.pleasant, policy_version: 'D58-mutual-unique-partners-v1' }
    const impression = (): ImpressionState => ({ eligible: state.mutual, own_options: state.own, submitted: state.own.length > 0, consent_version: 'positive-impressions-v1' })
    if (path === '/api/v1/admin/session') return json({ role: 'moderator', permissions: ['moderation'] })
    if (path === '/api/v1/admin/place-checks') { const filter = new URL(route.request().url()).searchParams.get('state'); const items = !filter || filter === state.status ? [check()] : []; return json({ items, total: items.length, next_offset: null }) }
    if (path.endsWith('/decision') && path.includes('/place-checks/')) { const body = route.request().postDataJSON(); state.checkWrites.push(body); state.status = body.decision; state.version++; return json(check()) }
    if (path === `/api/v1/plans/${planId}`) return json({ plan: { ...mock.plan(responder), place: `${check().name} · ${check().address}`, place_name: check().name, place_address: check().address, place_check_status: state.status } })
    if (path === `/api/v1/plans/${planId}/author`) return json({ profile: { name: 'Александра Константиновна', age: 31, bio: 'Краткое описание', interests: ['Кино','Кофе','Музыка'], photo: { url: '/images/gallery.jpeg' }, photo_verified: state.photo, experience } })
    if (path === '/api/v1/me/reliability') return json(experience)
    if (path === `/api/v1/matches/${matchId}`) { const value = mock.match(responder); return json({ match: { ...value, participants: value.participants.map(participant => ({ ...participant, profile: { ...participant.profile, photo_verified: state.photo, experience } })) } }) }
    if (path.endsWith('/survey')) return json({ availability: 'available', can_answer: true, own_answer: { met: true, rating: 4, comment: 'Приватный ответ', submitted: true, updated_at: new Date().toISOString() }, other_answered: true, result: { result: state.mutual ? 'mutual_yes' : 'conflicting', author_answered: true, responder_answered: true }, opens_at: null, closes_at: null, policy_version: 'D53-2h-1to5-optional-comment-edit7d' })
    if (path.endsWith('/impressions')) {
      if (method === 'PUT') { const payload = route.request().postDataJSON(); state.impressionWrites.push(payload); state.own = payload.options }
      if (method === 'DELETE') state.own = []
      return json(impression())
    }
    return route.fallback()
  })
  return state
}

test('place checking is neutral and separate from three independent positive badges', async ({ page }) => {
  const state = await install(page)
  await launch(page, `/people/${planId}`)
  await expect(page.getByText('Место пока не проверено', { exact: true })).toBeVisible()
  await expect(page.getByText('Есть подтверждённые встречи', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Фото подтверждено', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Приятное общение', { exact: true })).toHaveCount(0)
  state.photo = true; state.experience = 8; state.pleasant = true; state.status = 'confirmed'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Фото подтверждено' })).toBeVisible()
  await page.getByText('Есть подтверждённые встречи', { exact: true }).click()
  await expect(page.getByText('Участники хотя бы одной встречи подтвердили, что встретились')).toBeVisible()
  await page.getByText('Приятное общение', { exact: true }).click()
  await page.getByText('Место проверено', { exact: true }).click()
  await expect(page.getByText('Модератор сверил название и адрес места. Это не гарантия его безопасности или доступности')).toBeVisible()
  await expect(page.locator('main')).not.toContainText('· 8')
  await page.screenshot({ path: test.info().outputPath('plan-reputation-place.png'), fullPage: true })
  state.status = 'unconfirmed'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Место не подтверждено', { exact: true })).toBeVisible()
})

test('optional moderation requires evidence and reason then confirms the exact revision', async ({ page }) => {
  const state = await install(page)
  await launch(page, '/admin?section=places')
  await page.getByRole('button', { name: 'Проверить сведения' }).click()
  await expect(page.getByRole('button', { name: 'Подтвердить место', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Основание решения' }).fill('Сверены название и адрес по источникам')
  await page.getByRole('checkbox', { name: 'Название и адрес сверены по доступным источникам' }).check()
  await page.screenshot({ path: test.info().outputPath('place-check-moderation.png'), fullPage: true })
  await page.getByRole('button', { name: 'Подтвердить место', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить решение', exact: true }).click()
  await expect(page.getByText('Нет мест с этим статусом')).toBeVisible()
  expect(state.checkWrites).toEqual([{ expected_revision: 1, expected_version: 1, decision: 'confirmed', reason: 'Сверены название и адрес по источникам', evidence_confirmed: true }])
  await page.getByRole('combobox', { name: 'Статус проверки' }).selectOption('confirmed')
  await expect(page.getByRole('button', { name: 'Проверить сведения' })).toBeVisible()
})

test('voluntary impressions explain publication, can be skipped edited and withdrawn independently', async ({ page }) => {
  const state = await install(page)
  await launch(page, `/match/${matchId}`)
  await page.getByRole('button', { name: 'Поделиться впечатлением', exact: true }).click()
  await expect(page.getByText(/Положительные ответы влияют на публичную отметку/)).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click()
  expect(state.impressionWrites).toEqual([])
  await page.getByRole('button', { name: 'Поделиться впечатлением', exact: true }).click()
  await page.getByRole('button', { name: 'Приятно общаться', exact: true }).click()
  await page.getByRole('button', { name: 'Комфортная встреча', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить впечатления' })).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Согласен, что положительный ответ влияет на публичную отметку' }).check()
  await page.screenshot({ path: test.info().outputPath('positive-impressions.png'), fullPage: true })
  await page.getByRole('button', { name: 'Сохранить впечатления' }).click()
  await expect(page.getByText('Впечатления сохранены')).toBeVisible()
  expect(state.own).toEqual(['pleasant','comfortable'])
  await page.getByRole('button', { name: 'Изменить впечатления' }).click()
  await page.getByRole('button', { name: 'Приятно общаться', exact: true }).click()
  await page.getByRole('button', { name: 'Интересный собеседник', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Сохранить впечатления' }).click()
  await expect.poll(() => state.own).toEqual(['comfortable','interesting'])
  await page.getByRole('button', { name: 'Отозвать впечатления' }).click()
  await expect(page.getByText('Впечатления сохранены')).toHaveCount(0)
  expect(state.own).toEqual([])
})

test('free place review and reputation fit mobile and desktop', async ({ page, isMobile }) => {
  test.setTimeout(180000)
  const state = await install(page); state.photo = true; state.experience = 100; state.pleasant = true; state.status = 'confirmed'
  for (const width of isMobile ? [320,360,390,430] : [320,360,390,430,1366,1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of [`/people/${planId}`, '/admin?section=places', `/match/${matchId}`]) {
      await launch(page, path)
      await expect(page.locator('main')).toBeVisible()
      if (path.includes('admin')) { await page.getByRole('combobox', { name: 'Статус проверки' }).selectOption('confirmed'); await page.getByRole('button', { name: 'Проверить сведения' }).click() }
      if (path.includes('/match/')) { await page.getByRole('button', { name: 'Поделиться впечатлением', exact: true }).click(); await page.getByRole('button', { name: 'Сохранить впечатления' }).scrollIntoViewIfNeeded() }
      expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)
      if (width === 390 || width === 1366) await page.screenshot({ path: test.info().outputPath(`stage11v-${path.includes('admin') ? 'admin' : path.includes('/match/') ? 'impressions' : 'plan'}-${width}.png`), fullPage: !path.includes('/match/') })
    }
  }
})


test('a changed meeting result during an impression save never leaves the form stuck busy', async ({ page }) => {
  const state = await install(page)
  let started = false, first = true, release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/v1/matches/${matchId}/impressions`, async route => {
    if (route.request().method() === 'PUT' && first) {
      first = false; started = true; await gate
      return route.fulfill({ status: 409, json: { error: { code: 'IMPRESSION_UNAVAILABLE', message: 'Встреча больше не подтверждена взаимно' } } })
    }
    return route.fallback()
  })
  await launch(page, `/match/${matchId}`)
  await page.getByRole('button', { name: 'Поделиться впечатлением', exact: true }).click()
  await page.getByRole('button', { name: 'Приятно общаться', exact: true }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Сохранить впечатления' }).click()
  await expect.poll(() => started).toBe(true)
  state.mutual = false
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Ответы не совпали', { exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: 'Сохранить впечатления' })).toHaveCount(0)
  state.mutual = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('button', { name: 'Приятно общаться', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('checkbox')).toBeChecked()
  await expect(page.getByRole('button', { name: 'Сохранить впечатления' })).toBeEnabled()
  await page.getByRole('button', { name: 'Сохранить впечатления' }).click()
  await expect(page.getByText('Впечатления сохранены')).toBeVisible()
})
