import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createHmac } from 'node:crypto'

// Синтетические launch data только для изолированного serve_test_api.py.
const TEST_TOKEN = '42:unit-test-only-not-a-real-bot'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAfElEQVR4nNXOQREAMAjAsK7+PTMRPLhGQd7QJnESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ES53Vg6wNShQF/fRSLfgAAAABJRU5ErkJggg==', 'base64')

function initData(id: number, secondsAgo = 0) {
  const values: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000) - secondsAgo), user: JSON.stringify({ id, first_name: 'Тест' }), query_id: 'browser-test' }
  const secret = createHmac('sha256', 'WebAppData').update(TEST_TOKEN).digest()
  const hash = createHmac('sha256', secret).update(Object.keys(values).sort().map(key => `${key}=${values[key]}`).join('\n')).digest('hex')
  return new URLSearchParams({ ...values, hash }).toString()
}

async function telegram(page: Page, id: number, secondsAgo = 0) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ body: '' }))
  await page.addInitScript(raw => {
    Object.assign(window, { Telegram: { WebApp: {
      initData: raw, platform: 'android', viewportStableHeight: 844,
      ready() {}, expand() {}, isVersionAtLeast() { return false }, onEvent() {}, offEvent() {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
    } } })
  }, initData(id, secondsAgo))
}

async function register(page: Page, name: string) {
  await page.goto('/profile')
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Заполнить примером' })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Твоё имя' }).fill(name)
  await page.getByRole('spinbutton', { name: 'Возраст' }).fill('24')
  await page.locator('select[name=gender]').selectOption('woman')
  await page.locator('select[name=preference]').selectOption('any')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('textbox', { name: 'Пара слов о себе' }).fill('Синтетическая анкета браузерной проверки')
  for (const interest of ['Искусство', 'Кофе', 'Кино']) await page.getByRole('button', { name: interest, exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить анкету', exact: true }).click()
  await expect(page).toHaveURL('/home')
  await expect(page.getByText(`${name}, какой у тебя план?`, { exact: true })).toBeVisible()
}

test('automatic Telegram login saves, restores and edits a real isolated profile without localStorage', async ({ page, context }) => {
  await telegram(page, 800001)
  await register(page, 'Проверка API А')
  const stored = await page.evaluate(() => JSON.stringify(localStorage))
  expect(stored).not.toContain('Проверка API А')
  expect(stored).not.toContain('csrf')
  expect(stored).not.toContain('data:image')
  const cookies = await context.cookies()
  expect(cookies.find(cookie => cookie.name === 'poidem_session')?.httpOnly).toBe(true)
  expect(await page.evaluate(() => document.cookie)).not.toContain('poidem_session')
  await page.reload()
  await expect(page.getByText('Проверка API А, какой у тебя план?', { exact: true })).toBeVisible()
  await page.goto('/profile')
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('Проверка API А')
  await page.getByRole('textbox', { name: 'Твоё имя' }).fill('Изменённая анкета А')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveAttribute('src', /\/api\/v1\/media\/photos\//)
  await page.getByRole('button', { name: 'Сохранить анкету', exact: true }).click()
  await expect(page.getByText('Изменённая анкета А, какой у тебя план?', { exact: true })).toBeVisible()
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  await expect(page).toHaveURL('/')
  expect((await context.request.get('/api/v1/me')).status()).toBe(401)
})

test('two browser contexts cannot read each other and local reset preserves the server profile', async ({ browser }) => {
  const first = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    const a = await first.newPage(), b = await second.newPage()
    await telegram(a, 800002); await telegram(b, 800003)
    await register(a, 'Аккаунт А'); await register(b, 'Аккаунт Б')
    const ownA = (await (await first.request.get('/api/v1/me')).json()).profile
    expect((await second.request.get(ownA.photo.url)).status()).toBe(404)
    await a.goto('/profile')
    await a.getByRole('button', { name: 'Очистить данные', exact: true }).click()
    await a.getByRole('dialog').getByRole('button', { name: 'Очистить', exact: true }).click()
    await a.reload()
    await expect(a.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('Аккаунт А')
    expect((await first.request.get('/api/v1/me')).status()).toBe(200)
    await expect(a.getByRole('switch')).toHaveCount(0)
    await b.reload()
    await expect(b.getByText('Аккаунт Б, какой у тебя план?', { exact: true })).toBeVisible()
  } finally { await first.close(); await second.close() }
})

test('current signed Telegram context wins over a previous account cookie', async ({ page }) => {
  await telegram(page, 800004)
  await register(page, 'Прежний аккаунт')
  const current = initData(800005)
  await page.evaluate(raw => { window.Telegram!.WebApp!.initData = raw; window.dispatchEvent(new Event('poidem:telegram-ready')) }, current)
  await page.getByRole('link', { name: 'Моя анкета' }).click()
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('')
})

test('expired signed launch is rejected and browser without SDK has no fake authorization', async ({ page, browser }) => {
  await telegram(page, 800006, 301)
  await page.goto('/profile')
  await expect(page.getByText('Вход устарел. Закрой и заново открой Mini App в Telegram', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Заполнить примером' })).toHaveCount(0)
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' })
  try {
    const ordinary = await context.newPage()
    await ordinary.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ body: '' }))
    await ordinary.goto('/profile')
    await expect(ordinary.getByText('Telegram-авторизация пока не подтверждена', { exact: true })).toBeVisible()
    await expect(ordinary.getByRole('switch')).toHaveCount(0)
    await expect(ordinary.getByRole('button', { name: 'Заполнить примером' })).toHaveCount(0)
  } finally { await context.close() }
})

test('a delayed response from account A cannot show its profile during account B login', async ({ page }) => {
  await telegram(page, 800007)
  await register(page, 'Анкета прежнего запуска')
  let releaseA!: () => void, releaseB!: () => void, arrivedB!: () => void
  const a = new Promise<void>(resolve => { releaseA = resolve })
  const b = new Promise<void>(resolve => { releaseB = resolve })
  const startedB = new Promise<void>(resolve => { arrivedB = resolve })
  await page.route('**/api/v1/auth/telegram', async route => {
    const raw = route.request().postDataJSON().init_data as string
    const id = JSON.parse(new URLSearchParams(raw).get('user')!).id
    if (id === 800007) await a
    else { arrivedB(); await b }
    await route.continue()
  })
  const initial = page.waitForRequest(request => request.url().endsWith('/auth/telegram'))
  await page.goto('/profile', { waitUntil: 'domcontentloaded' })
  await initial
  await page.evaluate(raw => { window.Telegram!.WebApp!.initData = raw; window.dispatchEvent(new Event('poidem:telegram-ready')) }, initData(800008))
  releaseA()
  await startedB
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('')
  await expect(page.getByText('Проверяем данные авторизации', { exact: true })).toBeVisible()
  releaseB()
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('')
})

test('a late save from A cannot overwrite the UI or authorization of B', async ({ page }) => {
  await telegram(page, 800009)
  await register(page, 'Автор изменения А')
  await page.goto('/profile')
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('Автор изменения А')
  await page.getByRole('textbox', { name: 'Твоё имя' }).fill('Позднее имя А')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  let release!: () => void, finished!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const saved = new Promise<void>(resolve => { finished = resolve })
  await page.route('**/api/v1/me/profile', async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    const response = await route.fetch()
    finished(); await wait
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Сохранить анкету', exact: true }).click()
  await saved
  await page.evaluate(raw => { window.Telegram!.WebApp!.initData = raw; window.dispatchEvent(new Event('poidem:telegram-ready')) }, initData(800010))
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('')
  await expect(page).toHaveURL('/profile')
  expect((await (await page.context().request.get('/api/v1/me')).json()).profile).toBeNull()
})
