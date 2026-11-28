import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { launch, planId, responder, scenario } from './connectionScenario'

const firstId = '00000000-0000-4000-8000-000000000801'
const secondId = '00000000-0000-4000-8000-000000000802'
const people = () => [
  { id: firstId, name: 'Саша', age: 24, display_code: 'ABCD-EFGH-JKLM', context: 'Вечер в галерее', photo_url: null, context_saved_later: false, created_at: '2026-11-25T10:00:00Z' },
  { id: secondId, name: 'Саша', age: 24, display_code: 'NPQR-STUV-WXYZ', context: 'Прогулка в парке', photo_url: null, context_saved_later: false, created_at: '2026-11-25T11:00:00Z' },
]

async function setup(page: Page, admin = false) {
  await scenario().install(page, responder)
  const state = { admin, items: people(), deleted: [] as string[], failUnblock: false, failLoad: false, deleteAccount: false, deleteRefused: true }
  await page.route('**/api/v1/admin/session', route => route.fulfill(state.admin ? { json: { role: 'admin', permissions: ['analytics', 'users', 'plans', 'moderation', 'system', 'editorial'] } } : { status: 403, json: { error: { code: 'ADMIN_REQUIRED', message: 'Доступ ограничен' } } }))
  await page.route('**/api/v1/admin/reports?**', route => route.fulfill({ json: { items: [], next_cursor: null } }))
  await page.route('**/api/v1/me/blocks', route => route.fulfill(state.failLoad ? { status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Не удалось загрузить список' } } } : { json: { items: state.items } }))
  await page.route('**/api/v1/me/blocks/*', route => {
    expect(route.request().method()).toBe('DELETE')
    if (state.failUnblock) return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Не удалось разблокировать' } } })
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    state.deleted.push(id); state.items = state.items.filter(person => person.id !== id)
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/v1/me', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    state.deleteAccount = true
    return route.fulfill(state.deleteRefused ? { status: 409, json: { error: { code: 'ACCOUNT_HAS_RELATED_DATA', message: 'Есть совместная история — требуется отдельный порядок удаления' } } } : { json: { deleted: true, media_cleanup_pending: false } })
  })
  return state
}

test('settings preserve unsaved fields, interests, photo and step only in memory', async ({ page }) => {
  await setup(page)
  let writes = 0
  page.on('request', request => { if (request.url().endsWith('/me/profile') && request.method() === 'PUT') writes++ })
  await launch(page, '/profile')
  await page.getByRole('textbox', { name: 'Твоё имя', exact: true }).fill('Несохранённое имя')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('textbox', { name: 'Пара слов о себе' }).fill('Несохранённое описание')
  await page.locator('input[type=file]').setInputFiles('public/images/gallery.jpeg')
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveAttribute('src', /^data:image/)
  const photo = await page.getByRole('img', { name: 'Предпросмотр твоей фотографии' }).getAttribute('src')
  await page.locator('.interest-chips button[aria-pressed=true]').first().click()
  await page.locator('.interest-chips button[aria-pressed=false]').last().click()
  const interests = await page.locator('.interest-chips button[aria-pressed=true]').allTextContents()
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Очистить данные', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Уведомления.*Уведомления от бота/ })).toHaveAttribute('href', /\?start=notifications$/)
  await page.getByRole('link', { name: 'К анкете', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Пара слов о себе' })).toHaveValue('Несохранённое описание')
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveAttribute('src', photo!)
  expect(await page.locator('.interest-chips button[aria-pressed=true]').allTextContents()).toEqual(interests)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Твоё имя', exact: true })).toHaveValue('Несохранённое имя')
  await expect(page.locator('.profile-page').getByRole('button', { name: 'Удалить аккаунт', exact: true })).toHaveCount(0)
  expect(writes).toBe(0)
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('Несохранённое')))).toBe(false)
})

test('same-name rows and confirmation identify and unblock exactly the selected relation', async ({ page }) => {
  const state = await setup(page)
  await launch(page, '/settings/blocked')
  const rows = page.locator('.blocked-person')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).locator('h2')).toHaveText('Саша, 24')
  await expect(rows.nth(1).locator('h2')).toHaveText('Саша, 24')
  await expect(rows.nth(0)).toContainText('ABCD-EFGH-JKLM')
  await expect(rows.nth(1)).toContainText('NPQR-STUV-WXYZ')
  await expect(rows.locator('img')).toHaveCount(0)
  await rows.nth(1).getByRole('button', { name: 'Разблокировать', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('NPQR-STUV-WXYZ')
  await expect(page.getByRole('dialog')).toContainText('Прогулка в парке')
  await page.getByRole('dialog').getByRole('button', { name: 'Разблокировать', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('ABCD-EFGH-JKLM')
  expect(state.deleted).toEqual([secondId])
  await page.reload()
  await expect(rows.first()).toContainText('ABCD-EFGH-JKLM')
})

test('blocked-list loading failure, retry, failed unblock and empty state stay local', async ({ page }) => {
  const state = await setup(page); state.failLoad = true
  await launch(page, '/settings/blocked')
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить список')
  state.failLoad = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.blocked-person')).toHaveCount(2)
  state.failUnblock = true
  await page.locator('.blocked-person').first().getByRole('button', { name: 'Разблокировать', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Разблокировать', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Не удалось разблокировать')
  await expect(page.locator('.blocked-person')).toHaveCount(2)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  state.items = []
  await page.reload()
  await expect(page.getByText('Заблокированных пользователей нет', { exact: true })).toBeVisible()
})

test('account removal stays confirmed, handles B13 and preserves its original API', async ({ page }) => {
  const state = await setup(page)
  await launch(page, '/settings')
  await page.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  expect(state.deleteAccount).toBe(false)
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('совместная история')
  await expect(page).toHaveURL(/\/settings/)
  state.deleteRefused = false
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /Всё начинается/ })).toBeVisible()
})

test('moderation link follows server role and returns to settings', async ({ page }) => {
  const state = await setup(page, true)
  await launch(page, '/settings')
  await page.getByRole('link', { name: /Управление приложением/ }).click()
  await expect(page.getByRole('navigation', { name: 'Разделы администратора' })).toBeVisible()
  await page.getByRole('link', { name: 'В приложение', exact: true }).click()
  await expect(page.getByRole('link', { name: /Управление приложением/ })).toBeVisible()
  state.admin = false
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('link', { name: /Управление приложением/ })).toHaveCount(0)
})

test('ordinary settings do not expose admin or local reset', async ({ page }, testInfo) => {
  await setup(page)
  await launch(page, '/settings')
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Управление приложением/ })).toHaveCount(0)
  await expect(page.getByText('Очистить данные', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('settings-user.png'), fullPage: true })
})

test('portal menus preserve geometry and scroll; dismiss outside, Escape and keyboard', async ({ page }) => {
  await setup(page)
  await launch(page, '/catalog')
  const card = page.locator('.plan-card').first(), button = card.getByRole('button', { name: 'Действия с планом', exact: true })
  await button.scrollIntoViewIfNeeded()
  const before = await card.boundingBox(), scroll = await page.evaluate(() => scrollY)
  await button.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  expect(await card.boundingBox()).toEqual(before)
  expect(await page.evaluate(() => scrollY)).toBe(scroll)
  const popup = (await menu.boundingBox())!, nav = await page.locator('.mobile-nav').boundingBox()
  if (nav?.height) expect(popup.y + popup.height).toBeLessThanOrEqual(nav.y)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Пожаловаться' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Заблокировать' })).toBeFocused()
  await page.mouse.click(1, 1)
  await expect(menu).toHaveCount(0)
  expect(await card.boundingBox()).toEqual(before)
})

test('settings, duplicate names and menus fit all required widths with review screenshots', async ({ page }, testInfo) => {
  // 30+ полноразмерных снимков и несколько переходов на каждой из шести ширин.
  test.setTimeout(180000)
  const state = await setup(page, true)
  for (const width of [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 })
    for (const [path, name] of [['/profile', 'profile-gear'], ['/settings', 'settings-admin'], ['/settings/blocked', 'blocked-same-names']]) {
      await launch(page, path)
      await expect(page.locator('main h1').filter({ visible: true })).toBeVisible()
      if (path === '/settings') await expect(page.getByRole('link', { name: /Управление приложением/ })).toBeVisible()
      if (path === '/settings/blocked') {
        await expect(page.locator('.blocked-person')).toHaveCount(2)
        if (width === 320) {
          state.items[1].name = 'Очень длинное имя участника для проверки ширины'
          await page.reload(); await expect(page.locator('.blocked-person')).toHaveCount(2)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: testInfo.outputPath('blocked-long-name-320.png'), fullPage: true })
          state.items[1].name = 'Саша'; await page.reload(); await expect(page.locator('.blocked-person')).toHaveCount(2)
        }
      }
      await page.evaluate(() => document.fonts.ready)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true })
      state.items[1].name = 'Саша'
    }
    await launch(page, `/people/${planId}`)
    await page.getByRole('button', { name: 'Действия с анкетой' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`), fullPage: false })
    await page.getByRole('menuitem', { name: 'Заблокировать' }).click()
    await expect(page.getByRole('dialog')).toContainText('Тестовый автор')
    await page.screenshot({ path: testInfo.outputPath(`block-confirm-${width}.png`), fullPage: false })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('native Telegram Back returns through settings without discarding the profile draft', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => {
    let back: (() => void) | undefined
    window.addEventListener('synthetic-native-back', () => back?.())
    Object.assign(window, { Telegram: { WebApp: {
      initData: 'synthetic-browser-contract', ready: () => {}, expand: () => {},
      isVersionAtLeast: (version: string) => version === '6.1', setBackgroundColor: () => {},
      onEvent: () => {}, offEvent: () => {}, viewportStableHeight: 844,
      BackButton: { show: () => {}, hide: () => {}, onClick: (callback: () => void) => { back = callback }, offClick: (callback: () => void) => { if (back === callback) back = undefined } },
    } } })
  })
  await launch(page, '/profile')
  // Возврат проверяем на уже загруженной анкете: неподтверждённый черновик
  // намеренно не переносится при смене серверной identity во время входа.
  await expect(page.getByText('Вход через Telegram', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Твоё имя', exact: true })).toHaveValue('Тестовый участник')
  await page.getByRole('textbox', { name: 'Твоё имя', exact: true }).fill('Черновик с нативной кнопкой')
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: /Безопасность/ }).click()
  await expect(page.getByRole('heading', { name: 'Заблокированные', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('synthetic-native-back')))
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('synthetic-native-back')))
  await expect(page.getByRole('textbox', { name: 'Твоё имя', exact: true })).toHaveValue('Черновик с нативной кнопкой')
})
