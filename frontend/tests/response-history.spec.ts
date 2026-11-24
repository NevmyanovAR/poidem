import { expect, test } from '@playwright/test'
import { author, responder, planId, scenario, launch } from './connectionScenario'

test('expired waiting reply is compact history for either role without decision buttons', async ({ page, browser }) => {
  const mock = scenario({ expired: true }), owner = await browser.newPage()
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'waiting', version: 1 })
  try {
    for (const [client, viewer, tab] of [[page, responder, 'outgoing'], [owner, author, 'incoming']] as const) {
      await mock.install(client, viewer)
      await launch(client, `/plans?tab=${tab}`)
      await expect(client.locator('.response-history-entry .plan-status')).toHaveText('Время плана прошло')
      await expect(client.locator('.response-history-entry h3')).toHaveText('Тестовый вечер в галерее')
      await expect(client.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0)
      await expect(client.getByRole('button', { name: 'Отклонить', exact: true })).toHaveCount(0)
      await expect(client.locator('.response-history-entry')).toContainText(viewer === author ? 'Тестовый участник, 24' : 'Автор: Тестовый автор')
      await expect(client.locator('.response-history-entry time')).toContainText('Отклик')
      await expect(client.locator('.response-history-entry a')).toHaveCount(0)
      await expect(client.getByRole('button', { name: /Полученные отклики/ })).not.toContainText('· 1')
    }
    expect(mock.state.attempts[0].status).toBe('waiting')
  } finally { await owner.close() }
})

test('active replies stay first; refusal is immediately visible in collapsible history; matches are separate', async ({ page }) => {
  const mock = scenario()
  await mock.install(page, responder)
  const waiting = mock.response({ id: crypto.randomUUID(), status: 'waiting', version: 1 }, responder)
  const rejected = mock.response({ id: crypto.randomUUID(), status: 'rejected', version: 2 }, responder)
  const expired = { ...mock.response({ id: crypto.randomUUID(), status: 'waiting', version: 1, displayStatus: 'expired' }, responder), plan_id: crypto.randomUUID() }
  const closed = mock.response({ id: crypto.randomUUID(), status: 'closed', version: 2 }, responder)
  const accepted = mock.response({ id: crypto.randomUUID(), status: 'accepted', version: 2 }, responder)
  await page.route('**/api/v1/me/responses?**', route => route.fulfill({ json: {
    items: new URL(route.request().url()).searchParams.get('direction') === 'outgoing' ? [closed, accepted, expired, rejected, waiting] : [], next_cursor: null,
  } }))
  await launch(page, '/plans?tab=outgoing')
  await expect(page.locator('[data-record-kind="outgoing"]')).toHaveCount(1)
  await expect(page.locator('[data-record-kind="match"]')).toHaveCount(0)
  const history = page.locator('details.response-history')
  await expect(history).not.toHaveAttribute('open', '')
  await expect(history.locator('summary')).toContainText('История (3)')
  await expect(history.locator('summary')).toContainText('Ваш отклик не принят')
  await expect(history.locator('summary')).toContainText('Тестовый вечер в галерее')
  await history.locator('summary').click()
  await expect(history.locator('.response-history-entry')).toHaveCount(3)
  await expect(history.getByRole('link')).toHaveCount(0)
  await expect(history.getByRole('button')).toHaveCount(0)
  await expect(history).toContainText('Время плана прошло')
  await expect(history).toContainText('Выбрана другая пара')
  const activeBounds = await page.locator('[data-record-kind="outgoing"]').boundingBox(), historyBounds = await history.boundingBox()
  expect(activeBounds!.y + activeBounds!.height).toBeLessThanOrEqual(historyBounds!.y)
  await history.locator('summary').click()
  await expect(history).not.toHaveAttribute('open', '')
})

for (const matched of [false, true]) {
  test(`archive author reads paginated outcomes inline without decisions; candidate keeps own ${matched ? 'match' : 'reply'}`, async ({ page, browser }, testInfo) => {
    const mock = scenario({ archived: true, matched, expired: !matched, historyPageSize: 1 })
    mock.state.attempts.push({ id: crypto.randomUUID(), status: matched ? 'accepted' : 'rejected', version: 2 },
      { id: crypto.randomUUID(), status: matched ? 'closed' : 'waiting', version: 1, responderId: '00000000-0000-4000-8000-000000000303' })
    const candidate = await browser.newPage()
    try {
      await mock.install(page, author); await mock.install(candidate, responder)
      await launch(page, '/plans?tab=archive')
      const details = page.locator('details.archive-response-history')
      await expect(details).toHaveCount(1)
      await details.locator('summary').click()
      await expect(details.locator('.response-history-entry')).toHaveCount(1)
      await details.getByRole('button', { name: 'Показать ещё отклики', exact: true }).click()
      await expect(details.locator('.response-history-entry')).toHaveCount(2)
      await expect(details).toContainText(matched ? 'Принят' : 'Отклонён')
      await expect(details).toContainText(matched ? 'Выбрана другая пара' : 'Время плана прошло')
      await expect(details).toContainText('Тестовый участник, 24')
      await expect(details.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0)
      await expect(details.getByRole('button', { name: 'Отклонить', exact: true })).toHaveCount(0)
      await expect(details.getByRole('link')).toHaveCount(0)
      await expect(details.locator('h3')).toHaveCount(0) // Название уже есть в родительской карточке плана.
      for (const width of [320, 360, 375, 390, 430, 1366]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      }
      await page.setViewportSize({ width: 375, height: 844 })
      await details.screenshot({ path: testInfo.outputPath('archive-response-history.png') })
      await launch(candidate, '/plans?tab=archive')
      await expect(candidate.locator('details.archive-response-history')).toHaveCount(0)
      await expect(candidate.locator(matched ? '[data-record-kind="match"]' : '.response-history-entry')).toHaveCount(1)
      if (!matched) await expect(candidate.locator('.response-history-entry')).toContainText('Ваш отклик не принят')
      if (matched) {
        await expect(candidate.getByRole('link', { name: 'Написать', exact: true })).toHaveAttribute('href', /\/chat$/)
        await page.getByRole('link', { name: 'Подробнее', exact: true }).click()
        await expect(page.locator('.match-page details.archive-response-history')).toHaveCount(1)
      }
    } finally { await candidate.close() }
  })
}

test('archive history API errors are local and retry does not remount the plan card', async ({ page }) => {
  const mock = scenario({ archived: true, expired: true, historyPageSize: 1 })
  mock.state.attempts.push({ id: crypto.randomUUID(), status: 'rejected', version: 2 },
    { id: crypto.randomUUID(), status: 'waiting', version: 1, responderId: '00000000-0000-4000-8000-000000000303' })
  await mock.install(page, author)
  let fail = true
  await page.route(`**/api/v1/plans/${planId}/responses?**`, async route => {
    if (fail) return route.fulfill({ status: 503, json: { error: { code: 'TEST_UNAVAILABLE', message: 'История временно недоступна' } } })
    return route.fallback()
  })
  await launch(page, '/plans?tab=archive')
  const card = await page.locator('.record-own').elementHandle()
  await page.locator('details.archive-response-history summary').click()
  await expect(page.getByRole('alert')).toContainText('История временно недоступна')
  expect(await card!.evaluate(node => node.isConnected)).toBe(true)
  fail = false
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
  await expect(page.locator('.response-history-entry')).toHaveCount(1)
  expect(await card!.evaluate(node => node.isConnected)).toBe(true)
  fail = true
  await page.getByRole('button', { name: 'Показать ещё отклики', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('История временно недоступна')
  await expect(page.locator('.response-history-entry')).toHaveCount(1)
  fail = false
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
  await expect(page.locator('.response-history-entry')).toHaveCount(2)
  expect(await card!.evaluate(node => node.isConnected)).toBe(true)
})
