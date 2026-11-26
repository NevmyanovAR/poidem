import { expect, test } from '@playwright/test'
import { meetingDateLabel } from '../src/lib/date'
import { author, responder, matchId, scenario, launch } from './connectionScenario'

test('meeting dates use one Russian format, actual zone, year boundary and DST', () => {
  const now = new Date('2026-11-24T00:00:00Z')
  expect(meetingDateLabel({ startsAt: '2027-02-22T09:12:00Z', timeZone: 'Europe/Moscow' }, now)).toBe('22 февраля 2027, 12:12')
  expect(meetingDateLabel({ startsAt: '2026-11-24T09:12:00Z', timeZone: 'Europe/Moscow' }, now)).toBe('24 ноября, 12:12')
  expect(meetingDateLabel({ startsAt: '2026-12-31T22:30:00Z', timeZone: 'Europe/Moscow' }, now)).toBe('1 января 2027, 01:30')
  expect(meetingDateLabel({ startsAt: '2027-03-14T14:00:00Z', timeZone: 'America/New_York' }, now)).toBe('14 марта 2027, 10:00')
})

test('accepted replies live in chats and retain direct meeting details for both roles', async ({ page, browser }, testInfo) => {
  const mock = scenario({ matched: true, noUsername: true })
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'accepted', version: 2 })
  const owner = await browser.newPage()
  try {
    await mock.install(page, responder); await mock.install(owner, author)
    for (const [client, paths, partner] of [[page, ['/chats', '/plans?tab=matches'], 'Тестовый автор'], [owner, ['/plans?tab=matches'], 'Тестовый участник']] as const) {
      for (const path of paths) {
        await launch(client, path)
        const card = client.locator('.dialog-card')
        await expect(card).toHaveCount(1)
        await expect(card).toContainText(`${partner}, 24`)
        await expect(card.locator('.interest-tags, .review-description')).toHaveCount(0)
        await expect(card.locator('.dialog-open')).toHaveAttribute('href', `/match/${matchId}/chat`)
        await expect(card.getByRole('link', { name: 'О встрече', exact: true })).toHaveAttribute('href', `/match/${matchId}`)
        await expect(card.getByRole('link')).toHaveCount(2)
        await expect(card).not.toContainText('Europe/Moscow')
        if (path.includes('incoming') || path.includes('outgoing')) await card.screenshot({ path: testInfo.outputPath(path.includes('incoming') ? 'match-author.png' : 'match-responder.png') })
      }
    }
    for (const [client, path] of [[page, '/plans?tab=outgoing'], [owner, '/plans?tab=incoming']] as const) {
      await launch(client, path)
      await expect(client.locator('[data-record-kind="match"]')).toHaveCount(0)
      await expect(client.getByText('Подтверждённые пары и встречи доступны в')).toBeVisible()
    }
    await launch(owner, '/plans?tab=matches')
    await owner.locator('.dialog-open').click()
    await expect(owner).toHaveURL(`/match/${matchId}/chat`)
    await expect(owner.getByLabel('Сообщение', { exact: true })).toBeEnabled()
  } finally { await owner.close() }
})

test('archive refresh keeps layout, existing cards and scroll during delay and failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 })
  const mock = scenario({ matched: true, archived: true })
  await mock.install(page, responder)
  let delay = false, fail = false, release: (() => void) | undefined
  await page.route('**/api/v1/me/activity?**', async route => {
    if (!delay) return route.fallback()
    await new Promise<void>(resolve => { release = resolve })
    if (fail) return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'Архив временно недоступен' } } })
    return route.fallback()
  })
  await launch(page, '/plans?tab=archive')
  await expect(page.locator('.my-plan')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Архив', exact: true })).toBeVisible()
  const heading = await page.getByRole('heading', { name: 'Архив', exact: true }).boundingBox()
  await expect(page.getByRole('button', { name: 'Обновить список', exact: true })).toHaveCount(0)
  const toggle = await page.getByLabel('Показать скрытые').boundingBox()
  expect(heading!.y + heading!.height).toBeLessThan(toggle!.y)
  const card = await page.locator('.my-plan').elementHandle(), layout = await page.locator('main').elementHandle()
  await page.evaluate(() => window.scrollTo({ top: 60, behavior: 'instant' }))
  const beforeScroll = await page.evaluate(() => scrollY)
  expect(beforeScroll).toBeGreaterThan(0)
  let reloads = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++ })
  delay = true; fail = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => !!release).toBe(true)
  expect(await card!.evaluate(element => element.isConnected)).toBe(true)
  expect(await layout!.evaluate(element => element.isConnected)).toBe(true)
  expect(await page.evaluate(() => scrollY)).toBe(beforeScroll)
  expect(release).toBeDefined(); release!()
  await expect(page.getByRole('alert')).toContainText('Архив временно недоступен')
  expect(await card!.evaluate(element => element.isConnected)).toBe(true)
  expect(reloads).toBe(0)
})

test('long content, interests and tabs fit narrow screens; arrow interactions do not shift layout', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const mock = scenario({ matched: true, archived: true, long: true, noUsername: true })
  await mock.install(page, responder)
  for (const width of [320, 360, 375, 390, 430, 1366]) {
    await page.setViewportSize({ width, height: 900 })
    await launch(page, '/plans?tab=archive')
    const card = page.locator('[data-record-kind="match"]')
    await expect(card).toHaveCount(1)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    const tab = page.getByRole('button', { name: 'Архив', exact: true })
    await expect.poll(async () => {
      const button = await tab.boundingBox(), row = await page.getByRole('navigation', { name: 'Разделы моих планов' }).boundingBox()
      return button!.x + button!.width - row!.x - row!.width
    }).toBeLessThanOrEqual(1)
    const tabBounds = await tab.boundingBox(), row = await page.getByRole('navigation', { name: 'Разделы моих планов' }).boundingBox()
    expect(tabBounds!.x).toBeGreaterThanOrEqual(row!.x - 1)
    expect(tabBounds!.x + tabBounds!.width).toBeLessThanOrEqual(row!.x + row!.width + 1)
    const action = card.getByRole('link', { name: 'Подробнее', exact: true })
    await action.scrollIntoViewIfNeeded()
    const measure = () => page.evaluate(() => {
      const card = document.querySelector('.record-match')!, link = card.querySelector('a[href$="/chat"]')!, details = card.querySelector('a:not([href$="/chat"])')!
      const values = [card, link, details].map(node => { const rect = node.getBoundingClientRect(); return [rect.x + scrollX, rect.y + scrollY, rect.width, rect.height] })
      return values.flat()
    })
    const initial = await measure()
    await action.hover(); await page.waitForTimeout(220)
    const hovered = await measure()
    hovered.forEach((value, index) => expect(Math.abs(value - initial[index])).toBeLessThan(.6))
    const arrowTransform = await action.locator('.action-arrow svg').evaluate(element => getComputedStyle(element).transform)
    expect(arrowTransform).not.toBe('none')
    await action.focus()
    const focused = await measure()
    focused.forEach((value, index) => expect(Math.abs(value - hovered[index])).toBeLessThan(.6))
    await page.mouse.down()
    const pressed = await measure()
    pressed.forEach((value, index) => expect(Math.abs(value - focused[index])).toBeLessThan(.6))
    await page.mouse.move(0, 0); await page.mouse.up()
    if (width === 375) await card.screenshot({ path: testInfo.outputPath('compact-match-card.png') })
    await launch(page, `/match/${matchId}`)
    const interests = page.locator('.match-partner .interest-tags')
    await expect(interests.locator('.chip')).toHaveCount(3)
    const overflow = await interests.evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await launch(page, '/plans?tab=archive')
  const link = page.locator('.record-match').getByRole('link', { name: 'Подробнее', exact: true })
  await link.hover()
  expect(await link.locator('.action-arrow svg').evaluate(element => getComputedStyle(element).transform)).toBe('none')
})

test('pending candidate interests wrap within the card and published actions stay grouped', async ({ page }, testInfo) => {
  const mock = scenario({ long: true })
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  await mock.install(page, author)
  for (const width of [320, 360, 390, 430, 1366]) {
    await page.setViewportSize({ width, height: 900 })
    await launch(page, '/plans?tab=incoming')
    const card = page.locator('[data-record-kind="incoming"]')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.interest-tags')).toHaveCount(0)
    await card.getByRole('button', { name: 'Посмотреть анкету', exact: true }).click()
    await expect(page.getByRole('dialog').locator('.interest-tags .chip')).toHaveCount(3)
    await page.getByRole('button', { name: 'Закрыть анкету', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Принять', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Отклонить', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    if (width === 390) await card.screenshot({ path: testInfo.outputPath('pending-interests.png') })
    await launch(page, '/plans?tab=own')
    await expect(page.getByRole('link', { name: 'Посмотреть отклики (1)', exact: true })).toBeVisible()
    await expect(page.getByLabel('Действия со своим планом')).toHaveCount(0)
    if (width === 390) await page.locator('.record-own').screenshot({ path: testInfo.outputPath('own-published.png') })
  }
})
