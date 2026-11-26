import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { author, responder, planId, matchId, publicProfile, scenario, launch } from './connectionScenario'

// Синтетические ответы остаются только в браузерном тесте, не в приложении/БД.
const portrait = readFileSync(new URL('../public/images/portrait-sasha.jpeg', import.meta.url))
const protectedPhoto = `/api/v1/plans/${planId}/author/photo`
const foreground = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))
async function screenshot(page: Page, info: TestInfo, name: string) {
  const directory = `../.local/stage10-screenshots/${info.project.name || 'chrome'}`
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: `${directory}/${name}.png` })
}
async function authorPhoto(page: Page, unavailable = false) {
  let accesses = 0
  await page.route(`**/api/v1/plans/${planId}/author`, route => route.fulfill({ json: { profile: { ...publicProfile(author), photo: { url: protectedPhoto } } } }))
  await page.route(`**${protectedPhoto}`, route => {
    accesses++
    return unavailable ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/jpeg', body: portrait })
  })
  return () => accesses
}

test('own cards use server permissions, one status and a direct counted response action', async ({ page }, info) => {
  const mock = scenario()
  await mock.install(page, author)
  await launch(page, '/plans?tab=own')
  const card = page.locator('.record-own')
  await expect(card.locator('.plan-status')).toHaveText('Опубликован')
  await expect(card.getByRole('link', { name: /отклики/ })).toHaveCount(0)
  await page.getByLabel('Действия со своим планом').click()
  await expect(page.getByRole('link', { name: 'Изменить', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отменить план', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.record-menu')).not.toHaveAttribute('open', '')
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 }, { id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await foreground(page)
  await expect(card.getByRole('link', { name: 'Посмотреть отклики (2)', exact: true })).toBeVisible()
  await expect(card.locator('.plan-status')).toHaveCount(1)
  await expect(page.getByLabel('Действия со своим планом')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await screenshot(page, info, 'own-plans')
  await card.getByRole('link', { name: 'Посмотреть отклики (2)', exact: true }).click()
  await expect(page).toHaveURL(`/plans?tab=incoming&plan=${planId}`)
  await expect(page.locator('.record-incoming')).toHaveCount(2)
})

test('incoming compact portrait and full profile preserve decisions and nested photo viewing', async ({ page }, info) => {
  const mock = scenario()
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await mock.install(page, author)
  const photo = `/api/v1/responses/${mock.state.attempts[0].id}/profile/photo`
  await page.route('**/api/v1/me/responses?**', route => {
    if (!route.request().url().includes('direction=incoming')) return route.fallback()
    const response = mock.response(mock.state.attempts[0], author)
    if (response.profile) response.profile.photo.url = photo
    return route.fulfill({ json: { items: [response], next_cursor: null } })
  })
  await page.route(`**${photo}`, route => route.fulfill({ contentType: 'image/jpeg', body: portrait }))
  await launch(page, `/plans?tab=incoming&plan=${planId}`)
  const card = page.locator('.record-incoming')
  await expect(card.locator('.profile-photo-trigger')).toBeEnabled()
  await expect(card.locator('.interest-tags')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Принять', exact: true })).toBeEnabled()
  await page.locator('.incoming-heading').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.incoming-heading')!.getBoundingClientRect().top + scrollY - 20))
  await screenshot(page, info, 'incoming-responses')
  await card.getByRole('button', { name: 'Посмотреть анкету', exact: true }).click()
  const profile = page.locator('.candidate-profile-dialog')
  await expect(profile.locator('.interest-tags .chip')).toHaveCount(3)
  await profile.getByRole('button', { name: /Открыть фотографию/ }).click()
  await expect(page.locator('.photo-lightbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.photo-lightbox')).toHaveCount(0)
  await expect(profile).toBeVisible()
  await profile.getByRole('button', { name: 'Закрыть анкету', exact: true }).click()
  await card.getByRole('button', { name: 'Отклонить', exact: true }).click()
  await expect(page.getByText('Вы отклонили отклик', { exact: true })).toBeVisible()
  await expect(card).toHaveCount(0)
})

test('protected author photo closes by Escape, backdrop, button and browser Back without remount or scroll loss', async ({ page }, info) => {
  const mock = scenario()
  await mock.install(page, responder)
  await authorPhoto(page)
  let views = 0
  page.on('request', req => { if (req.url().endsWith('/view')) views++ })
  await launch(page, `/people/${planId}`)
  await expect(page.locator('.person-photo button')).toBeEnabled()
  await page.evaluate(() => { document.querySelector<HTMLDetailsElement>('.person-more')!.open = true; window.scrollTo(0, 45) })
  const before = await page.evaluate(() => scrollY), url = page.url()
  const main = await page.locator('main').elementHandle()
  for (const exit of ['button', 'escape', 'backdrop', 'back']) {
    await page.locator('.person-photo button').click()
    const viewer = page.locator('.photo-lightbox')
    await expect(viewer).toBeVisible()
    await expect(viewer.locator('img')).toHaveAttribute('src', new RegExp(`${protectedPhoto}$`))
    expect(page.url()).toBe(url)
    expect(await viewer.locator('img').evaluate(img => getComputedStyle(img).objectFit)).toBe('contain')
    await expect(page.locator('.create-fab')).toHaveCount(0)
    if (exit === 'button') { await screenshot(page, info, 'photo-viewer'); await page.getByLabel('Закрыть фотографию').click() }
    if (exit === 'escape') await page.keyboard.press('Escape')
    if (exit === 'backdrop') await viewer.click({ position: { x: 5, y: 80 } })
    if (exit === 'back') await page.goBack()
    await expect(viewer).toHaveCount(0)
    expect(page.url()).toBe(url)
    expect(await main!.evaluate(node => node.isConnected)).toBe(true)
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(before)
  }
  expect(views).toBe(1)
})

test('unavailable private photo has a neutral placeholder and never opens another image', async ({ page }) => {
  await scenario().install(page, responder)
  const accesses = await authorPhoto(page, true)
  await launch(page, `/people/${planId}`)
  await expect(page.getByRole('img', { name: 'Фотография недоступна' })).toBeVisible()
  await expect(page.locator('.person-photo button')).toBeDisabled()
  await expect(page.locator('.person-photo img, .photo-lightbox')).toHaveCount(0)
  expect(accesses()).toBeGreaterThan(0)
})

test('a full-screen image load failure shows no fallback and remains closable', async ({ page }) => {
  await scenario().install(page, responder)
  let revoked = false
  await authorPhoto(page)
  await page.route(`**${protectedPhoto}*`, route => revoked ? route.fulfill({ status: 404 }) : route.fallback())
  await launch(page, `/people/${planId}`)
  await expect(page.locator('.person-photo button')).toBeEnabled()
  revoked = true
  await page.locator('.person-photo button').click()
  // Уже загруженный портрет браузер вправе взять из памяти. Принудительно
  // воспроизводим отдельный неуспешный запрос только внутри тестового overlay.
  await page.locator('.photo-lightbox img').evaluate(img => { (img as HTMLImageElement).src += '?synthetic-load-failure=1' })
  await expect(page.getByText('Фотография сейчас недоступна', { exact: true })).toBeVisible()
  await expect(page.locator('.photo-lightbox img')).toHaveCount(0)
  await page.getByLabel('Закрыть фотографию').click()
  await expect(page.locator('.photo-lightbox')).toHaveCount(0)
})

test('compact dialogs keep different matches with the same partner, self preview and empty chat', async ({ page }, info) => {
  const mock = scenario({ matched: true })
  await mock.install(page, responder)
  const secondId = '00000000-0000-4000-8000-000000002002'
  const dialogMatch = (id: string, title: string, unread: number) => {
    const match = { ...mock.match(responder), id, title, unread_count: unread }
    match.participants[0].profile.photo.url = `/api/v1/matches/${id}/photo/author`
    return match
  }
  await page.route('**/api/v1/matches/*/photo/author', route => route.fulfill({ contentType: 'image/jpeg', body: portrait }))
  await page.route('**/api/v1/me/chats*', route => route.fulfill({ json: { items: [
    { match: dialogMatch(matchId, 'Кофе у галереи', 2), last_activity_at: new Date().toISOString(), last_message: { text: 'Буду у входа', sender: 'self', created_at: new Date().toISOString() } },
    { match: dialogMatch(secondId, 'Вечерняя прогулка', 0), last_activity_at: new Date(Date.now() - 3600000).toISOString(), last_message: null },
  ], next_cursor: null } }))
  await launch(page, '/chats')
  await expect(page.locator('.dialog-card')).toHaveCount(2)
  await expect(page.locator('.dialog-plan')).toHaveText(['Кофе у галереи', 'Вечерняя прогулка'])
  await expect(page.locator('.dialog-preview p')).toHaveText(['Вы: Буду у входа', 'Начните общение'])
  await expect(page.locator('.dialog-open').nth(0)).toHaveAttribute('href', `/match/${matchId}/chat`)
  await expect(page.locator('.dialog-open').nth(1)).toHaveAttribute('href', `/match/${secondId}/chat`)
  await screenshot(page, info, 'chats')
  const box = await page.locator('.dialog-card').first().boundingBox()
  expect(box!.height).toBeLessThan(165)
  await page.locator('.dialog-open').first().click()
  await expect(page).toHaveURL(`/match/${matchId}/chat`)
})

test('list foreground refresh is serialized, keeps visible cards and offers Retry only after failure', async ({ page }) => {
  await scenario({ matched: true }).install(page, responder)
  await launch(page, '/chats')
  await expect(page.locator('.dialog-card')).toHaveCount(1)
  let active = 0, maximum = 0, requests = 0, fail = true
  await page.route('**/api/v1/me/chats*', async route => {
    active++; maximum = Math.max(maximum, active); requests++
    await new Promise(resolve => setTimeout(resolve, 250))
    active--
    return fail ? route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'Переписки временно недоступны' } } }) : route.fallback()
  })
  const node = await page.locator('.dialog-card').elementHandle()
  await page.evaluate(() => { for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('focus')) })
  await expect(page.getByRole('alert')).toContainText('Переписки временно недоступны')
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeEnabled()
  expect(await node!.evaluate(item => item.isConnected)).toBe(true)
  expect(maximum).toBe(1)
  expect(requests).toBeLessThanOrEqual(2)
  fail = false
  await page.getByRole('button', { name: 'Повторить загрузку' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Обновить|Повторить загрузку/ })).toHaveCount(0)
})

test('returning from a dialog restores the list scroll and keeps the final card above navigation at the bottom', async ({ page }) => {
  const mock = scenario({ matched: true })
  await mock.install(page, responder)
  await page.route('**/api/v1/me/chats*', route => route.fulfill({ json: { items: Array.from({ length: 12 }, (_, i) => ({ match: { ...mock.match(responder), id: i === 0 ? matchId : crypto.randomUUID(), title: `План ${i + 1}` }, last_activity_at: new Date().toISOString(), last_message: null })), next_cursor: null } }))
  await launch(page, '/chats')
  await expect(page.locator('.dialog-card')).toHaveCount(12)
  await page.evaluate(() => window.scrollTo(0, 180))
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(180)
  await page.locator('.dialog-open').first().click()
  await page.getByRole('link', { name: 'К чатам', exact: true }).click()
  await expect(page.locator('.dialog-card')).toHaveCount(12)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(180)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const card = await page.locator('.dialog-card').last().boundingBox(), fab = await page.locator('.create-fab').boundingBox()
  expect(card!.y + card!.height + 5).toBeLessThan(fab!.y)
})

test('Telegram Back closes the overlay before navigating and honours safe areas', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { back: null as (() => void) | null }
    Object.assign(window, { __photoTelegram: state, Telegram: { WebApp: {
      platform: 'ios', initData: 'synthetic-browser-contract', viewportStableHeight: 844,
      safeAreaInset: { top: 20, bottom: 34, left: 0, right: 0 }, contentSafeAreaInset: { top: 12, bottom: 0, left: 0, right: 0 },
      ready() {}, expand() {}, isVersionAtLeast: () => true, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, onEvent() {}, offEvent() {},
      BackButton: { show() {}, hide() {}, onClick(fn: () => void) { state.back = fn }, offClick() { state.back = null } },
    } } })
  })
  await scenario().install(page, responder)
  await authorPhoto(page)
  await launch(page, `/people/${planId}`)
  await page.locator('.person-photo button').click()
  await expect(page.locator('.photo-lightbox')).toBeVisible()
  const close = await page.getByLabel('Закрыть фотографию').boundingBox()
  expect(close!.y).toBeGreaterThanOrEqual(32)
  await page.evaluate(() => (window as unknown as { __photoTelegram: { back: () => void } }).__photoTelegram.back())
  await expect(page.locator('.photo-lightbox')).toHaveCount(0)
  await expect(page).toHaveURL(url => url.pathname === `/people/${planId}`)
  await page.evaluate(() => (window as unknown as { __photoTelegram: { back: () => void } }).__photoTelegram.back())
  await expect(page).toHaveURL('/catalog')
})

test('returning from an own plan restores previously loaded pages and scroll without storage', async ({ page }) => {
  const mock = scenario()
  await mock.install(page, author)
  const plans = Array.from({ length: 25 }, (_, i) => ({ ...mock.plan(author), id: crypto.randomUUID(), title: `Собственная идея ${i + 1}` }))
  let secondPages = 0
  await page.route('**/api/v1/me/activity?**', route => {
    const second = new URL(route.request().url()).searchParams.has('cursor')
    if (second) secondPages++
    return route.fulfill({ json: { items: (second ? plans.slice(20) : plans.slice(0, 20)).map(plan => ({ key: `plan:${plan.id}`, kind: 'plan', plan_id: plan.id, plan, response: null, match: null, hidden: false, archived: false, history: false, pending_response_count: 0, match_id: null })), next_cursor: second ? null : 'synthetic-page-two' } })
  })
  await page.route('**/api/v1/plans/*', route => {
    const plan = plans.find(item => route.request().url().endsWith('/' + item.id))
    return plan ? route.fulfill({ json: { plan } }) : route.fallback()
  })
  await launch(page, '/plans?tab=own')
  await expect(page.locator('.record-own')).toHaveCount(20)
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click()
  await expect(page.locator('.record-own')).toHaveCount(25)
  const details = page.locator('.record-own').last().getByRole('link', { name: 'Посмотреть план', exact: true })
  await details.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => scrollY)
  expect(before).toBeGreaterThan(300)
  await details.click()
  await expect(page.locator('.person-plan h2')).toHaveText('Собственная идея 25')
  await page.goBack()
  await expect(page).toHaveURL(url => url.pathname === '/plans' && url.search === '?tab=own')
  await expect(page.locator('.record-own')).toHaveCount(25)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0)
  expect(secondPages).toBeGreaterThanOrEqual(2)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Собственная идея')
})

test('updated cards and dialog layout fit mobile widths and desktop', async ({ page }, info) => {
  test.setTimeout(90000)
  const mock = scenario({ long: true })
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await mock.install(page, author)
  const mobile = info.project.name !== '' && info.project.name !== 'chrome'
  for (const width of mobile ? [320, 360, 390, 430] : [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 844 })
    for (const path of ['/plans?tab=own', '/plans?tab=incoming', '/chats']) {
      await launch(page, path)
      await expect(page.locator(path.includes('incoming') ? '.record-incoming' : path.includes('own') ? '.record-own' : '.dialogs-page')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    }
  }
})

test('an obsolete response cannot replace a newer foreground refresh with stale dialog text', async ({ page }) => {
  const mock = scenario({ matched: true })
  await mock.install(page, responder)
  await launch(page, '/chats')
  await expect(page.locator('.dialog-preview p')).toHaveText('Начните общение')
  let requests = 0, release: (() => void) | undefined
  await page.route('**/api/v1/me/chats*', async route => {
    const turn = ++requests
    if (turn === 1) await new Promise<void>(resolve => { release = resolve })
    else await new Promise(resolve => setTimeout(resolve, 150))
    return route.fulfill({ json: { items: [{ match: mock.match(responder), last_activity_at: new Date().toISOString(), last_message: { text: turn === 1 ? 'Устаревший ответ' : 'Актуальная переписка', sender: 'other', created_at: new Date().toISOString() } }], next_cursor: null } })
  })
  await page.evaluate(() => {
    const seen: string[] = []
    Object.assign(window, { __stage10Previews: seen })
    new MutationObserver(() => seen.push(document.querySelector('.dialog-preview p')?.textContent ?? '')).observe(document.querySelector('.dialogs-list')!, { childList: true, subtree: true, characterData: true })
  })
  await foreground(page)
  await expect.poll(() => !!release).toBe(true)
  await foreground(page)
  release!()
  await expect(page.locator('.dialog-preview p')).toHaveText('Актуальная переписка')
  expect(await page.evaluate(() => (window as unknown as { __stage10Previews: string[] }).__stage10Previews)).not.toContain('Устаревший ответ')
})

for (const unavailable of [false, true]) test(`existing match partner portrait keeps its crop and protected context (${unavailable ? 'unavailable' : 'available'})`, async ({ page }) => {
  const mock = scenario({ matched: true })
  await mock.install(page, responder)
  const photo = `/api/v1/matches/${matchId}/photo/author`
  const match = mock.match(responder)
  match.participants[0].profile.photo.url = photo
  await page.route(`**/api/v1/matches/${matchId}`, route => route.fulfill({ json: { match } }))
  await page.route(`**${photo}`, route => unavailable ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/jpeg', body: portrait }))
  await launch(page, `/match/${matchId}`)
  const portraitArea = page.locator('.match-portrait.first')
  await expect(portraitArea.locator(':scope > span')).toHaveText('Тестовый автор')
  if (unavailable) {
    await expect(portraitArea.getByRole('img', { name: 'Фотография недоступна' })).toBeVisible()
    await expect(portraitArea.locator('button')).toBeDisabled()
    expect(await portraitArea.locator('.person-photo-placeholder').evaluate(el => getComputedStyle(el).position)).toBe('static')
  } else {
    await expect(portraitArea.locator('button')).toBeEnabled()
    await expect(portraitArea.locator('img')).toHaveCSS('object-position', '50% 30%')
    await portraitArea.locator('button').click()
    await expect(page.locator('.photo-lightbox img')).toHaveAttribute('src', new RegExp(`${photo}$`))
    await page.getByLabel('Закрыть фотографию').click()
    await expect(page.locator('.match-page')).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'Открыть чат', exact: true })).toHaveAttribute('href', `/match/${matchId}/chat`)
})
