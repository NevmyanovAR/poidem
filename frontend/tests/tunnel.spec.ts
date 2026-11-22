import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

test('real HTTPS frontend and API share one origin without a fake login', async ({ page, request }) => {
  const origins: string[] = []
  const base = test.info().project.use.baseURL!
  page.on('request', req => { if (req.url().includes('/api/v1/')) origins.push(new URL(req.url()).origin) })
  await page.goto('/profile')
  await expect(page.getByText('Telegram-авторизация пока не подтверждена', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Заполнить примером' })).toHaveCount(0)
  const reference = await request.get('/api/v1/reference-data')
  expect(reference.status()).toBe(200)
  expect((await reference.json()).business_operations_enabled).toBe(false)
  expect((await request.get('/api/v1/me')).status()).toBe(401)
  await page.evaluate(() => fetch('/api/v1/reference-data', { credentials: 'include' }).then(r => r.status))
  expect(origins.every(origin => origin === base)).toBe(true)
  await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('link', { name: 'Главная', exact: true }).click()
  await expect(page).toHaveURL('/home')
  await page.getByRole('link', { name: 'Найти свой план', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Пока нет опубликованных планов' })).toBeVisible()
})

test('private workspace files are inaccessible through the tunnel', async ({ request }) => {
  const workspace = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/')
  for (const relative of ['.env', '.git/config', '.local/tunnel-settings-before.json', 'backend/src/poidem/settings.py']) {
    const response = await request.get(`/@fs/${workspace}${relative}`)
    expect(response.status(), relative).toBe(403)
  }
  // Несуществующий внутри frontend /.env может получить SPA fallback, но не файл.
  const dotEnv = await request.get('/.env')
  if (dotEnv.status() === 200) {
    expect(dotEnv.headers()['content-type']).toContain('text/html')
    expect(await dotEnv.text()).toContain('<div id="root">')
  } else expect(dotEnv.status()).toBe(403)
})

test('real API rejects unauthenticated writes and a foreign Origin without setting cookies', async ({ request, baseURL }) => {
  const badSignature = await request.post('/api/v1/auth/telegram', {
    headers: { Origin: baseURL! }, data: { init_data: 'invalid-signature-check' },
  })
  expect(badSignature.status()).toBe(401)
  expect(badSignature.headers()['set-cookie']).toBeUndefined()
  expect(badSignature.headers()['cache-control']).toBe('no-store')
  const foreign = await request.post('/api/v1/auth/telegram', {
    headers: { Origin: 'https://foreign-origin.example' }, data: { init_data: 'invalid' },
  })
  expect(foreign.status()).toBe(403)
  expect((await request.get('/api/v1/me/profile')).status()).toBe(401)
})

// Только отрицательные проверки: подпись намеренно неверна, сервер не создаёт аккаунт.
const untrustedLaunch = 'auth_date=1&user=%7B%22id%22%3A800090%7D&query_id=synthetic%2B%2520&hash=' + '0'.repeat(64)
const launchUrl = `/profile#tgWebAppData=${encodeURIComponent(untrustedLaunch)}&tgWebAppVersion=8.0`

test('launch data reaches the real validator before the external SDK loads', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  const sent: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/v1/auth/telegram') sent.push(request.postDataJSON().init_data)
  })
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/telegram')
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
  const response = await rejected
  expect(response.status()).toBe(401)
  expect(response.headers()['set-cookie']).toBeUndefined()
  await expect(page.getByText('Не удалось подтвердить вход через Telegram', { exact: true })).toBeVisible()
  expect(sent).toEqual([untrustedLaunch]) // Одно декодирование, без пересборки строки и повтора 401.
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(raw => JSON.stringify(localStorage).includes(raw), untrustedLaunch)).toBe(false)
})

for (const failure of ['network', 'gateway'] as const) {
  test(`one ${failure} failure retries login automatically but does not bypass validation`, async ({ page }) => {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
    let attempts = 0
    await page.route('**/api/v1/auth/telegram', async route => {
      attempts++
      if (attempts === 1) {
        if (failure === 'network') await route.abort('connectionreset')
        else await route.fulfill({ status: 502, contentType: 'text/html', body: '<!doctype html><title>Bad gateway</title>' })
      } else await route.continue()
    })
    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/telegram' && response.status() === 401)
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
    await rejected
    await expect(page.getByText('Не удалось подтвердить вход через Telegram', { exact: true })).toBeVisible()
    expect(attempts).toBe(2)
    await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
  })
}

test('persistent connection failure stops after one automatic retry', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  let attempts = 0
  await page.route('**/api/v1/auth/telegram', route => { attempts++; return route.abort('connectionreset') })
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Не удалось связаться с сервером. Попробуй ещё раз', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить вход', exact: true })).toBeVisible()
  expect(attempts).toBe(2)
})

test('an obsolete launch is not retried after the Telegram account changes', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  let releaseFirst!: () => void
  let firstSeen!: () => void
  const released = new Promise<void>(resolve => { releaseFirst = resolve })
  const seen = new Promise<void>(resolve => { firstSeen = resolve })
  const launches: string[] = []
  await page.route('**/api/v1/auth/telegram', async route => {
    launches.push(route.request().postDataJSON().init_data)
    if (launches.length === 1) {
      firstSeen(); await released; await route.abort('connectionreset')
    } else await route.continue()
  })
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
  await seen
  const nextLaunch = untrustedLaunch.replace('800090', '800091')
  await page.evaluate(url => {
    history.replaceState(null, '', url)
    window.dispatchEvent(new Event('poidem:telegram-ready'))
  }, `/profile#tgWebAppData=${encodeURIComponent(nextLaunch)}`)
  releaseFirst()
  await expect(page.getByText('Не удалось подтвердить вход через Telegram', { exact: true })).toBeVisible()
  expect(launches).toEqual([untrustedLaunch, nextLaunch])
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
})

// Изолированные отрицательные проверки контракта клиента: ответы подменены
// только в тестовом браузере, настоящая успешная авторизация не имитируется на API.
test.describe('isolated client cookie contract', () => {
  const accountId = '00000000-0000-4000-8000-000000000001'
  const envelope = {
    user: { id: accountId, account_status: 'active' },
    authorization: { method: 'telegram_init_data', verified_at: '2026-01-01T00:00:00Z' },
    csrf_token: 'synthetic-test-only', profile: null,
  }
  for (const failure of ['missing', 'other-account'] as const) {
    test(`a ${failure} cookie prevents authorization without a retry`, async ({ page }) => {
      await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
      let logins = 0, checks = 0
      await page.route('**/api/v1/auth/telegram', route => {
        logins++; return route.fulfill({ json: envelope })
      })
      await page.route('**/api/v1/auth/csrf', route => {
        checks++
        return failure === 'missing'
          ? route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'Нет сессии' } } })
          : route.fulfill({ json: { user_id: '00000000-0000-4000-8000-000000000002', csrf_token: 'synthetic-test-only' } })
      })
      await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(failure === 'missing'
        ? 'Не удалось сохранить сессию. Открой Mini App заново'
        : 'Сессия другого аккаунта. Открой Mini App заново', { exact: true })).toBeVisible()
      expect({ logins, checks }).toEqual({ logins: 1, checks: 1 })
      await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
    })
  }

  test('login and cookie check share a single retry budget', async ({ page }) => {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
    let logins = 0, checks = 0
    await page.route('**/api/v1/auth/telegram', route => {
      logins++
      return logins === 1 ? route.fulfill({ status: 502, json: {} }) : route.fulfill({ json: envelope })
    })
    await page.route('**/api/v1/auth/csrf', route => {
      checks++; return route.fulfill({ status: 502, json: {} })
    })
    await page.goto(launchUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Не удалось выполнить запрос', { exact: true })).toBeVisible()
    expect({ logins, checks }).toEqual({ logins: 2, checks: 1 })
    await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
  })
})
