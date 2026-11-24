import { expect, test, type Page } from '@playwright/test'

// Изолированный контракт UI. Все API-ответы здесь синтетические, в PostgreSQL
// не пишутся; серверные права/квоты проверяются pytest на отдельной БД.
const actor = '00000000-0000-4000-8000-000000000101'
const other = '00000000-0000-4000-8000-000000000202'
const tomorrow = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const initialPlan = (own = true) => ({
  id: own ? '00000000-0000-4000-8000-000000001001' : '00000000-0000-4000-8000-000000002001',
  author: { id: own ? actor : other, name: own ? 'Синтетический автор' : 'Синтетический участник' },
  title: own ? 'Собственный план' : 'План другого участника', category_code: 'art',
  description: 'Данные только браузерного теста', starts_at: `${tomorrow}T15:00:00Z`,
  time_zone: 'Europe/Moscow', place: 'Музей', publication_status: 'published', moderation_status: 'not_submitted',
  created_at: new Date().toISOString(), version: 1, image: '/images/gallery.jpeg', own,
})
type TestPlan = ReturnType<typeof initialPlan>

async function api(page: Page, options: { own?: TestPlan[]; catalog?: TestPlan[]; used?: number; unavailable?: boolean; rejectContent?: boolean } = {}) {
  const state = { own: options.own ?? [], catalog: options.catalog ?? [], used: options.used ?? 0, creations: 0, keys: [] as string[], unavailable: options.unavailable ?? false }
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value })
    const error = (message: string, status: number) => json({ error: { code: 'TEST_ERROR', message } }, status)
    if (path === '/api/v1/auth/telegram') return json({
      user: { id: actor, account_status: 'active' }, authorization: { method: 'telegram_init_data', verified_at: new Date().toISOString() }, csrf_token: 'synthetic-only',
      profile: { user_id: actor, name: 'Синтетический автор', age: 24, gender_code: 'woman', preference_code: 'any', bio: 'Тест', photo: { id: actor, url: '/images/gallery.jpeg' }, interest_ids: ['art', 'coffee', 'walks'], version: 1, moderation_status: 'not_submitted' },
    })
    if (path === '/api/v1/auth/csrf') return json({ user_id: actor, csrf_token: 'synthetic-only' })
    expect(request.headers()['x-account-context']).toBe(actor)
    if (state.unavailable) return error('Планы временно недоступны', 503)
    if (path === '/api/v1/me/quotas') return json({ maximum: 3, used: state.used, remaining: 3 - state.used, day: tomorrow, time_zone: 'Europe/Moscow' })
    if (path === '/api/v1/me/activity') {
      const archived = new URL(request.url()).searchParams.get('scope') === 'archive'
      return json({ items: state.own.filter(item => (item.publication_status === 'cancelled') === archived).map(plan => ({ key: `plan:${plan.id}`, kind: 'plan', plan_id: plan.id, archived, hidden: false, plan: { ...plan, archived }, response: null, match: null })), next_cursor: null })
    }
    if (path === '/api/v1/me/plans') return json({ items: state.own, next_cursor: null })
    if (path === '/api/v1/me/responses' || path === '/api/v1/me/matches') return json({ items: [], next_cursor: null })
    if (path === '/api/v1/plans' && method === 'GET') return json({ items: state.catalog, next_cursor: null })
    const selected = [...state.own, ...state.catalog].find(item => path.startsWith(`/api/v1/plans/${item.id}`))
    if (selected && path.endsWith('/author')) return json({ profile: { name: selected.author.name, age: 24, bio: 'Анкета только браузерного теста', interests: ['Искусство', 'Кофе', 'Прогулки'], photo: { url: '/images/gallery.jpeg' } } })
    if (selected && path.endsWith('/capacity')) return json({ count: 0, maximum: 15, remaining: 15, can_respond: !selected.own, own_response_id: null })
    if (selected && method === 'GET') return json({ plan: selected })
    if (path === '/api/v1/plans' && method === 'POST') {
      if (options.rejectContent) return json({ error: {
        code: 'PLAN_CONTENT_REJECTED', message: 'В планах нельзя предлагать наркотики, их покупку или употребление',
        fields: { description: 'В планах нельзя предлагать наркотики, их покупку или употребление' },
      } }, 422)
      if (state.used >= 3) return error('Дневной лимит достигнут', 429)
      const fields = request.postDataJSON()
      state.keys.push(request.headers()['idempotency-key'])
      state.creations++; state.used++
      const plan = { ...initialPlan(), ...fields, id: crypto.randomUUID(), publication_status: 'draft' }
      state.own.unshift(plan)
      return json({ plan }, 201)
    }
    const plan = state.own.find(item => path.startsWith(`/api/v1/plans/${item.id}`))
    if (plan && method === 'PATCH') {
      const fields = request.postDataJSON()
      if (fields.expected_version !== plan.version) return error('План уже изменился', 409)
      Object.assign(plan, fields, { version: plan.version + 1 })
      return json({ plan })
    }
    if (plan && method === 'POST' && (path.endsWith('/publish') || path.endsWith('/cancel'))) {
      plan.publication_status = path.endsWith('/publish') ? 'published' : 'cancelled'
      plan.version++
      return json({ plan })
    }
    return error('Неожиданный тестовый запрос', 404)
  })
  return state
}

async function launch(page: Page, path: string) {
  await page.goto(`${path}#tgWebAppData=synthetic-browser-contract`, { waitUntil: 'domcontentloaded' })
}

async function fillPlan(page: Page) {
  await page.getByRole('textbox', { name: 'Название плана' }).fill('Серверный план проверки')
  await page.getByRole('textbox', { name: 'Где встречаемся?' }).fill('Вход в музей')
  await page.locator('input[name=date]').fill(tomorrow)
  await page.locator('input[name=time]').fill('18:30')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
}

test('server content rejection shows its reason, keeps the form and spends no quota', async ({ page }) => {
  const state = await api(page, { rejectContent: true })
  await launch(page, '/create')
  await expect(page.getByText('3 из 3', { exact: true })).toBeVisible()
  await fillPlan(page)
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('В планах нельзя предлагать наркотики')
  await expect(page).toHaveURL(url => url.pathname === '/create')
  expect(state.creations).toBe(0)
  expect(state.used).toBe(0)
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Название плана' })).toHaveValue('Серверный план проверки')
})

test('create, restore, publish, edit and cancel use the server without localStorage', async ({ page }) => {
  const state = await api(page)
  await launch(page, '/create')
  await expect(page.getByText('3 из 3', { exact: true })).toBeVisible()
  await fillPlan(page)
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page).toHaveURL('/plans')
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible()
  await launch(page, '/plans')
  await expect(page.getByRole('heading', { name: 'Серверный план проверки' })).toBeVisible()
  expect(state.creations).toBe(1)
  expect(state.keys[0]).toMatch(/^[\da-f-]{36}$/)
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(page.getByText('Опубликован', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Изменить', exact: true }).click()
  await page.getByRole('textbox', { name: 'Название плана' }).fill('Изменённый серверный план')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Изменённый серверный план' })).toBeVisible()
  expect(state.creations).toBe(1)
  await page.getByRole('button', { name: 'Отменить план', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Отменить план', exact: true }).click()
  await page.getByRole('button', { name: 'Архив', exact: true }).click()
  await expect(page.getByText('Архив · Отменён', { exact: true })).toBeVisible()
  expect(state.used).toBe(1)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Изменённый серверный план')
})

test('catalogue shows only server offers, excludes the owner and has working detail navigation', async ({ page }) => {
  await api(page, { own: [initialPlan()], catalog: [initialPlan(), initialPlan(false)] })
  await page.addInitScript(() => localStorage.setItem('poidem:demo-mode:v1', 'true'))
  await launch(page, '/catalog')
  await expect(page.locator('.plan-card')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'План другого участника' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Собственный план' })).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.locator('.plan-card').getByRole('link', { name: 'Пойдём?', exact: false }).click()
  await expect(page.getByRole('heading', { name: /Синтетический участник/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Пойдём?', exact: true })).toBeEnabled()
  await expect(page.getByRole('link', { name: 'Все планы', exact: true })).toBeVisible()
})

test('server quota blocks the fourth creation but does not block editing', async ({ page }) => {
  const own = initialPlan()
  await api(page, { own: [own], used: 3 })
  await launch(page, '/create')
  await expect(page.getByText('0 из 3', { exact: true })).toBeVisible()
  await fillPlan(page)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeDisabled()
  await launch(page, `/create?edit=${own.id}`)
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить изменения', exact: true })).toBeEnabled()
})

test('an unavailable API is shown as an error without fictional plans or a local quota fallback', async ({ page }) => {
  const state = await api(page, { unavailable: true })
  await launch(page, '/catalog')
  await expect(page.getByText('Планы временно недоступны', { exact: true })).toBeVisible()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Пока нет опубликованных планов' })).toHaveCount(0)
  await launch(page, '/create')
  await expect(page.getByRole('button', { name: 'Повторить загрузку лимита', exact: true })).toBeVisible()
  await fillPlan(page)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeDisabled()
  state.unavailable = false
  await page.getByRole('button', { name: 'Повторить загрузку лимита', exact: true }).click()
  await expect(page.getByText('3 из 3', { exact: true })).toBeVisible()
  await expect(page.locator('.plan-review h3')).toHaveText('Серверный план проверки')
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeEnabled()
})

test('server plan cards and actions fit mobile and desktop widths', async ({ page }) => {
  test.setTimeout(90000)
  const longText = { title: 'Достопримечательности'.repeat(4).slice(0, 80), place: 'Адрес'.repeat(32) }
  await api(page, { own: [{ ...initialPlan(), ...longText }], catalog: [{ ...initialPlan(false), ...longText }] })
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/plans', '/catalog']) {
      await launch(page, path)
      await expect(page.locator(path === '/plans' ? '.my-plan' : '.plan-card')).toHaveCount(1)
      await page.evaluate(() => document.fonts.ready)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      expect(overflow, `${path} at ${width}`).toBeLessThanOrEqual(1)
    }
    if (width === 320 || width === 1366) await page.screenshot({ path: test.info().outputPath(`plans-catalog-${width}.png`), fullPage: true })
  }
})
