import { expect, test } from '@playwright/test'
import { author, responder, matchId, scenario, launch } from './connectionScenario'

test('two accounts chat without username, receive new messages and restore history safely', async ({ page, browser }, testInfo) => {
  const mock = scenario({ matched: true, noUsername: true }), owner = await browser.newPage()
  try {
    await mock.install(page, responder); await mock.install(owner, author)
    await launch(page, `/match/${matchId}`)
    await expect(page.getByRole('link', { name: 'Написать в Telegram', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Открыть чат', exact: true }).click()
    await expect(page.getByLabel('Сообщение', { exact: true })).toBeEnabled()
    await page.getByLabel('Сообщение', { exact: true }).fill('Привет! Встречаемся у музея?')
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page.locator('.chat-message')).toHaveCount(1)
    await launch(owner, `/match/${matchId}/chat`)
    await expect(owner.locator('.chat-message')).toContainText('Встречаемся у музея?')
    await owner.getByLabel('Сообщение', { exact: true }).fill('<img src=x onerror=alert(1)>')
    await owner.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page.locator('.chat-message')).toHaveCount(2, { timeout: 10000 })
    await expect(page.locator('.chat-message img')).toHaveCount(0)
    await expect(page.locator('.chat-message').last()).toContainText('<img src=x onerror=alert(1)>')
    await launch(page, `/match/${matchId}/chat`)
    await expect(page.locator('.chat-message')).toHaveCount(2)
    for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    }
    expect(mock.state.messages).toHaveLength(2)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Встречаемся')
    await page.setViewportSize({ width: 375, height: 844 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: testInfo.outputPath('chat-mobile.png') })
    await page.locator('.chat-compose').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('chat-compose-mobile.png') })
  } finally { await owner.close() }
})

test('uncertain send retries with the same key and produces one message', async ({ page }) => {
  const mock = scenario({ matched: true })
  await mock.install(page, responder)
  let interrupted = true
  await page.route(`**/api/v1/matches/${matchId}/messages`, async route => {
    if (route.request().method() === 'POST' && interrupted) {
      interrupted = false
      const body = route.request().postDataJSON()
      mock.state.messages.push({ id: crypto.randomUUID(), sequence: 1, senderId: responder, text: body.text, client_id: body.client_id, created_at: new Date().toISOString() })
      mock.state.messageKeys.push(body.client_id)
      return route.abort('failed')
    }
    return route.fallback()
  })
  await launch(page, `/match/${matchId}/chat`)
  await page.getByLabel('Сообщение', { exact: true }).fill('Не дублировать')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(1)
  expect(new Set(mock.state.messageKeys).size).toBe(1)
  expect(mock.state.messages).toHaveLength(1)
})

test('archive hiding belongs to one account and keeps chat reachable after restoring', async ({ page, browser }) => {
  const mock = scenario({ matched: true, archived: true }), owner = await browser.newPage()
  try {
    await mock.install(page, responder); await mock.install(owner, author)
    await launch(page, '/plans')
    await expect(page.locator('.my-plan')).toHaveCount(0)
    await page.getByRole('button', { name: 'Архив', exact: true }).click()
    await expect(page.locator('.my-plan')).toHaveCount(1)
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
    await expect(page.locator('.my-plan')).toHaveCount(0)
    await launch(owner, '/plans?tab=archive')
    await expect(owner.locator('.my-plan')).toHaveCount(1)
    await page.getByLabel('Показать скрытые').check()
    await page.getByRole('button', { name: 'Восстановить карточку', exact: true }).click()
    await page.getByRole('link', { name: 'Написать', exact: true }).click()
    await expect(page.getByLabel('Сообщение', { exact: true })).toBeEnabled()
    expect(mock.state.hidden.has(responder)).toBe(false)
    expect(mock.state.hidden.has(author)).toBe(false)
    expect(mock.state.matched).toBe(true)
  } finally { await owner.close() }
})
