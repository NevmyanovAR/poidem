import { expect, test } from '@playwright/test'
import { launch, planId, matchId, responder, scenario } from './connectionScenario'

const reportId = '00000000-0000-4000-8000-000000000707'
const blockId = '00000000-0000-4000-8000-000000000708'
const entry = { id: reportId, state: 'pending', target_type: 'plan', reason_code: 'content', created_at: '2026-11-25T12:00:00Z' }

test('report from profile is brief, optional comment and no automatic block', async ({ page }) => {
  const mock = scenario(); await mock.install(page, responder)
  let submitted: unknown
  await page.route('**/api/v1/reports', route => { submitted = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...entry, target_type: 'profile' } }) })
  await launch(page, `/people/${planId}`)
  await page.getByRole('button', { name: 'Действия с анкетой', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Пожаловаться', exact: true }).click()
  await page.getByLabel('Причина', { exact: true }).selectOption('harassment')
  await page.getByRole('button', { name: 'Отправить жалобу', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveText('Жалоба отправлена')
  expect(submitted).toEqual({ target_type: 'profile', context_type: 'plan', context_id: planId, reason_code: 'harassment', comment: null })
  await expect(page.getByRole('button', { name: 'Пойдём?', exact: true })).toBeEnabled()
})

test('chat reports participant without message menus; blocking keeps history and stops composer', async ({ page }) => {
  const mock = scenario(); mock.state.matched = true
  mock.state.messages.push({ id: reportId, sequence: 1, senderId: 'another-user', text: 'Текст истории без изменений', client_id: crypto.randomUUID(), created_at: new Date().toISOString() })
  await mock.install(page, responder)
  let blocked = false, body: Record<string, unknown> = {}
  await page.route('**/api/v1/me/blocks', route => { blocked = true; return route.fulfill({ json: { id: blockId, blocked: true } }) })
  await page.route(`**/api/v1/matches/${matchId}/chat`, async route => { await route.fulfill({ json: { match_id: matchId, last_sequence: 1, last_read_sequence: 1, other_last_read_sequence: 0, unread_count: 0, can_send: !blocked, meeting_cancelled: false, archived: false } }) })
  await page.route('**/api/v1/reports', route => { body = route.request().postDataJSON(); return route.fulfill({ json: entry, status: 201 }) })
  await launch(page, `/match/${matchId}/chat`)
  await expect(page.locator('.chat-message')).toHaveCount(1)
  await expect(page.locator('.chat-message button')).toHaveCount(0)
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 })
    const message = page.locator('.chat-message')
    const text = message.locator('p')
    const freeWidth = await message.evaluate(element => element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft) - parseFloat(getComputedStyle(element).paddingRight))
    expect(Math.abs((await text.boundingBox())!.width - freeWidth)).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: 'Действия безопасности', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Пожаловаться', exact: true }).click()
  await page.getByRole('button', { name: 'Отправить жалобу' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(body.target_type).toBe('chat')
  expect(body).not.toHaveProperty('message_id')
  expect(body.context_id).toBe(matchId)
  await page.getByRole('button', { name: 'Действия безопасности', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Заблокировать', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('внутри «Пойдём?»')
  await page.getByRole('dialog').getByRole('button', { name: 'Заблокировать', exact: true }).click()
  await expect(page.getByText('Переписка недоступна', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Сообщение', { exact: true })).toBeDisabled()
  await expect(page.getByText('Текст истории без изменений', { exact: true })).toBeVisible()
})

test('published plan menu and arrow have equal circles and mirrored insets', async ({ page }, testInfo) => {
  // Семь размеров и снимков в одном тесте; WebKit на локальном стенде требует больше 30 с.
  test.setTimeout(90000)
  await scenario().install(page, responder)
  await launch(page, '/catalog')
  const frame = page.locator('.plan-photo-frame').first()
  await expect(frame).toBeVisible()
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 })
    await page.evaluate(() => document.fonts.ready)
    const photo = (await frame.locator('.card-photo').boundingBox())!
    const menu = (await frame.getByRole('button', { name: 'Действия с планом' }).boundingBox())!
    const arrow = (await frame.locator('.photo-arrow').boundingBox())!
    expect(menu.width).toBe(arrow.width)
    expect(menu.height).toBe(arrow.height)
    expect(menu.width).toBe(37)
    expect(Math.abs(menu.y - photo.y - (photo.y + photo.height - arrow.y - arrow.height))).toBeLessThan(1)
    expect(Math.abs(menu.x - arrow.x)).toBeLessThan(1)
    expect(Math.abs(photo.x + photo.width - menu.x - menu.width - 15)).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`plan-controls-${width}.png`) })
  }
  await frame.getByRole('button', { name: 'Действия с планом' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await frame.locator('.card-photo').click()
  await expect(page).toHaveURL(new RegExp(`/people/${planId}$`))
})

test('published plan circles align precisely at fractional browser scale', async ({ page }) => {
  await scenario().install(page, responder)
  await launch(page, '/catalog')
  const frame = page.locator('.plan-photo-frame').first()
  await expect(frame).toBeVisible()
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const zoom of [1, 1.1, 1.25]) {
      await page.evaluate(value => { document.documentElement.style.zoom = String(value) }, zoom)
      const photo = (await frame.locator('.card-photo').boundingBox())!
      const menu = (await frame.getByRole('button', { name: 'Действия с планом' }).boundingBox())!
      const arrow = (await frame.locator('.photo-arrow').boundingBox())!
      expect(Math.abs(menu.x + menu.width / 2 - arrow.x - arrow.width / 2), `horizontal centres: ${width}px, zoom ${zoom}`).toBeLessThan(0.02)
      expect(Math.abs(menu.y - photo.y - (photo.y + photo.height - arrow.y - arrow.height)), `mirrored insets: ${width}px, zoom ${zoom}`).toBeLessThan(0.02)
    }
  }
})

test('unblock from compact profile settings removes only personal restriction', async ({ page }) => {
  const mock = scenario(); await mock.install(page, responder)
  await page.route('**/api/v1/admin/session', route => route.fulfill({ status: 403, json: { error: { code: 'ADMIN_REQUIRED', message: 'Доступ ограничен' } } }))
  await page.route('**/api/v1/me/blocks', route => route.fulfill({ json: { items: [{ id: blockId, name: 'Тестовый участник', created_at: entry.created_at }] } }))
  let removed = false
  await page.route(`**/api/v1/me/blocks/${blockId}`, route => { expect(route.request().method()).toBe('DELETE'); removed = true; return route.fulfill({ status: 204 }) })
  await launch(page, '/profile')
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: /Безопасность/ }).click()
  await page.getByRole('button', { name: 'Разблокировать', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Разблокировать', exact: true }).click()
  await expect(page.getByText('Заблокированных пользователей нет', { exact: true })).toBeVisible()
  expect(removed).toBe(true)
  await expect(page.getByRole('link', { name: 'Рассмотрение жалоб' })).toHaveCount(0)
})

test('ordinary user cannot open administrative actions', async ({ page }) => {
  await scenario().install(page, responder)
  await page.route('**/api/v1/admin/session', route => route.fulfill({ status: 403, json: { error: { code: 'ADMIN_REQUIRED', message: 'Этот раздел доступен только администратору' } } }))
  await launch(page, '/admin')
  await expect(page.getByRole('heading', { name: 'Доступ ограничен' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Скрыть план', exact: true })).toHaveCount(0)
})

test('admin queue, scoped evidence, decision confirmation and seven viewport sizes', async ({ page }, testInfo) => {
  await scenario().install(page, responder)
  let reviewed = false, decisions = 0
  const detail = () => ({ ...entry, state: reviewed ? 'reviewed' : 'pending', comment: 'Тестовое обращение', evidence: { title: '<img src=x onerror=alert(1)>', description: 'Контекст выбранного плана' }, can_hide_plan: !reviewed, decisions: reviewed ? [{ action: 'hide_plan', reason: 'Проверенное нарушение', actor: 'Тестовый администратор', actor_id: responder, decided_at: entry.created_at }] : [] })
  await page.route('**/api/v1/admin/session', route => route.fulfill({ json: { role: 'admin', permissions: ['analytics', 'users', 'plans', 'moderation', 'system', 'editorial'] } }))
  await page.route('**/api/v1/admin/reports?**', route => route.fulfill({ json: { items: reviewed ? [] : [entry], next_cursor: null } }))
  await page.route(`**/api/v1/admin/reports/${reportId}`, route => route.fulfill({ json: detail() }))
  await page.route(`**/api/v1/admin/reports/${reportId}/decision`, route => { expect(route.request().postDataJSON()).toEqual({ action: 'hide_plan', reason: 'Проверенное нарушение' }); decisions++; reviewed = true; return route.fulfill({ json: detail() }) })
  await launch(page, '/admin?section=moderation')
  await page.locator('.admin-report').click()
  await expect(page.locator('.admin-detail h3').filter({ hasText: '<img' })).toBeVisible()
  await expect(page.locator('.admin-detail img')).toHaveCount(0)
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`admin-${width}.png`), fullPage: true })
  }
  await page.getByLabel('Причина решения', { exact: true }).fill('Проверенное нарушение')
  await page.getByRole('button', { name: 'Скрыть план', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Подтвердить скрытие', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'История решений' })).toBeVisible()
  expect(decisions).toBe(1)
})
