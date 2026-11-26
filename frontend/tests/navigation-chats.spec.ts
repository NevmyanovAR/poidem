import { expect, test } from '@playwright/test'
import { author, responder, matchId, planId, scenario, launch } from './connectionScenario'

test('five sections and one safe-area floating create action on each main screen', async ({ page }, info) => {
  test.setTimeout(180000)
  const mock = scenario()
  await mock.install(page, author)
  await launch(page, '/home')
  await page.evaluate(() => document.fonts.ready)
  for (const width of [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 844 })
    for (const path of ['/home', '/catalog', '/plans', '/inspiration', '/chats']) {
      const nav = page.locator(width <= 680 ? '.mobile-nav' : '.desktop-nav')
      await nav.locator(`a[href^="${path}"]`).click()
      await expect(nav.locator('a')).toHaveCount(5)
      await expect(nav).toContainText('Вдохновение')
      await expect(nav).toContainText('Чаты')
      const plus = page.getByRole('link', { name: 'Создать свой план', exact: true })
      await expect(plus).toHaveCount(1); await expect(plus).toBeVisible()
      await expect.poll(async () => {
        const fab = await plus.boundingBox(), bar = await nav.boundingBox()
        return !!fab && !!bar && (width > 680 || fab.y + fab.height + 10 <= bar.y)
      }).toBe(true)
      const position = await plus.boundingBox()
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      expect((await plus.boundingBox())?.y).toBeCloseTo(position!.y, 0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      if (width === 390 && path === '/home') {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: info.outputPath('navigation-mobile.png') })
      }
      await plus.click()
      await expect(page).toHaveURL('/create')
      await expect(page.locator('.create-fab')).toHaveCount(0)
    }
  }
})

test('a real match projection opens existing chat, clears unread and retains meeting context', async ({ page }, info) => {
  const mock = scenario({ matched: true })
  mock.state.messages.push({ id: crypto.randomUUID(), sequence: 1, senderId: author, text: 'До встречи у входа', created_at: new Date().toISOString(), client_id: crypto.randomUUID() })
  await mock.install(page, responder)
  await launch(page, '/chats')
  await expect(page.locator('.dialog-card')).toHaveCount(1)
  await expect(page.locator('.dialog-card')).toContainText('Тестовый автор')
  await expect(page.locator('.dialog-card')).toContainText('До встречи у входа')
  await expect(page.locator('.mobile-nav .nav-count')).toHaveText('1')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: info.outputPath('chats-mobile.png') })
  await page.locator('.dialog-open').click()
  await expect(page).toHaveURL(`/match/${matchId}/chat`)
  await expect(page.locator('.chat-message')).toHaveCount(1)
  await expect(page.locator('.create-fab')).toHaveCount(0)
  await expect(page.locator('.mobile-nav .nav-count')).toHaveCount(0)
  await page.getByRole('link', { name: 'О встрече', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Написать в Telegram' })).toBeVisible()
  await page.getByRole('link', { name: 'К чатам', exact: true }).click()
  await expect(page).toHaveURL('/chats')
  await expect(page.locator('.dialog-card .count-badge')).toHaveCount(0)
})

test('empty chats, first match, unavailable portrait and safe message preview', async ({ page }) => {
  const mock = scenario({ long: true })
  await mock.install(page, responder)
  await launch(page, '/chats')
  await expect(page.getByText('Переписки появятся после первого мэтча')).toBeVisible()
  mock.state.matched = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.dialog-preview')).toContainText('Начните общение')
  await page.route('**/images/gallery.jpeg', route => route.abort())
  mock.state.messages.push({ id: crypto.randomUUID(), sequence: 1, senderId: author, text: '<img src=x onerror=alert(1)>', created_at: new Date().toISOString(), client_id: crypto.randomUUID() })
  await page.reload()
  await expect(page.locator('.dialog-photo svg')).toBeVisible()
  await expect(page.locator('.dialog-preview')).toContainText('<img src=x onerror=alert(1)>')
  await expect(page.locator('.dialog-preview img')).toHaveCount(0)
  for (const width of [320, 360, 390, 430, 1366]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  }
})

test('own server order stays separate from history and restores incoming/outgoing filters', async ({ page }, info) => {
  test.setTimeout(60000)
  const mock = scenario()
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await mock.install(page, author)
  let nextPageCalls = 0
  await page.route('**/api/v1/me/activity?**', route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('view')).toBe('own')
    const make = (id: number, title: string, status: string, pending: number, history = false) => {
      const plan = { ...mock.plan(author), id: `${planId.slice(0, -1)}${id}`, title, publication_status: status }
      return { key: `plan:${plan.id}`, kind: 'plan', plan_id: plan.id, plan, response: null, match: null, archived: false, hidden: false, history, pending_response_count: pending, match_id: null }
    }
    if (url.searchParams.has('cursor')) nextPageCalls++
    return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [make(4, 'Закрытая история', 'closed', 0, true)] : [make(1, 'Ждёт решения', 'published', 1), make(2, 'Ближайший вечер', 'published', 0), make(3, 'Черновая идея', 'draft', 0)], next_cursor: url.searchParams.has('cursor') ? null : 'synthetic-own-page-2' } })
  })
  await launch(page, '/plans?tab=own')
  const tabs = page.getByRole('navigation', { name: 'Разделы моих планов' })
  await expect(tabs.getByRole('button')).toHaveText(['Мои идеи', 'Отклики', 'Архив'])
  await expect(page.locator('.heading-with-action a')).toHaveCount(0)
  await expect(page.locator('.my-plans-list').first().locator('.my-plan h2')).toHaveText(['Ждёт решения', 'Ближайший вечер', 'Черновая идея'])
  await expect(page.locator('.my-plan').first()).toContainText('Посмотреть отклики (1)')
  expect(nextPageCalls).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.own-plan-history')).toBeVisible()
  await expect(page.getByText('Закрытая история', { exact: true })).not.toBeVisible()
  await page.locator('.own-plan-history summary').click()
  await expect(page.getByText('Закрытая история', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready })
  await page.screenshot({ path: info.outputPath('own-plans-mobile.png'), fullPage: true })
  await page.locator('.my-plan').first().getByRole('link', { name: /Посмотреть отклики/ }).click()
  await expect(page.getByRole('heading', { name: 'Полученные отклики', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'К моим идеям' }).click()
  await expect(page).toHaveURL('/plans?tab=own')
})

test('outgoing details and global navigation remember the selected plans section', async ({ page }) => {
  const mock = scenario()
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await mock.install(page, responder)
  await launch(page, '/plans?tab=outgoing')
  await page.getByRole('link', { name: 'Посмотреть пару', exact: true }).click()
  await page.locator('.plan-detail-toolbar').getByRole('link', { name: 'Мои планы', exact: true }).click()
  await expect(page).toHaveURL('/plans?tab=outgoing')
  await page.locator('.mobile-nav').getByRole('link', { name: 'Вдохновение', exact: true }).click()
  await page.locator('.mobile-nav').getByRole('link', { name: 'Мои планы', exact: true }).click()
  await expect(page).toHaveURL('/plans?tab=outgoing')
})

test('Telegram safe areas, native back and modal keep one unobstructed create action', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { back: null as (() => void) | null }
    Object.assign(window, { __navTelegram: state, Telegram: { WebApp: {
      platform: 'ios', initData: 'synthetic-browser-contract', viewportStableHeight: 844,
      safeAreaInset: { top: 20, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 12, bottom: 0, left: 0, right: 0 },
      ready() {}, expand() {}, isVersionAtLeast: () => true, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, onEvent() {}, offEvent() {},
      BackButton: { show() {}, hide() {}, onClick(fn: () => void) { state.back = fn }, offClick() { state.back = null } },
    } } })
  })
  const mock = scenario()
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await mock.install(page, author)
  await launch(page, '/plans?tab=own')
  await expect(page.locator('.mobile-nav a[href^="/plans"] .nav-count')).toHaveText('1')
  await expect(page.locator('.record-own .record-primary')).toHaveText('Посмотреть отклики (1)')
  const fab = await page.locator('.create-fab').boundingBox(), nav = await page.locator('.mobile-nav').boundingBox()
  expect(fab!.y + fab!.height).toBeLessThan(nav!.y - 10)
  await expect(page.getByLabel('Действия со своим планом')).toHaveCount(0)
  await page.getByRole('link', { name: /Посмотреть отклики/ }).click()
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click()
  await expect(page.getByText('Вы отклонили отклик', { exact: true })).toBeVisible()
  await expect(page.locator('.mobile-nav .nav-count')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __navTelegram: { back: () => void } }).__navTelegram.back())
  await expect(page).toHaveURL('/plans?tab=own')
  await expect(page.locator('.record-own .plan-status')).toHaveText('Опубликован')
})

test('an expired navigation session clears private dialogs and badges instead of leaving stale data', async ({ page }) => {
  const mock = scenario({ matched: true })
  await mock.install(page, responder)
  let expired = false
  await page.route('**/api/v1/me/navigation', route => expired ? route.fulfill({ status: 401, json: { error: { code: 'SESSION_EXPIRED', message: 'Войди заново' } } }) : route.fallback())
  await launch(page, '/chats')
  await expect(page.locator('.dialog-card')).toHaveCount(1)
  expired = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть чаты' })).toBeVisible()
  await expect(page.locator('.dialog-card, .nav-count')).toHaveCount(0)
  await expect(page.locator('.profile-link')).toContainText('Моя анкета')
})

test('entering received replies fetches a new response without waiting for the polling interval', async ({ page }) => {
  const mock = scenario()
  await mock.install(page, author)
  await launch(page, '/plans?tab=own')
  await expect(page.locator('.record-own')).toHaveCount(1)
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByRole('link', { name: 'Посмотреть отклики (1)', exact: true }).click()
  await expect(page.locator('.record-incoming')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Принять', exact: true })).toBeVisible()
})
