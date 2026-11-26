import { expect, test } from '@playwright/test'
import { launch, planId, responder, scenario } from './connectionScenario'

test('bot refusal link opens its own response directly and the tab still opens the full list', async ({ page }) => {
  const mock = scenario()
  await mock.install(page, responder)
  const first = mock.response({ id: crypto.randomUUID(), status: 'rejected', version: 2 }, responder)
  const second = { ...first, id: crypto.randomUUID(), plan_id: crypto.randomUUID(), history_context: { ...first.history_context, plan_title: 'Другой тестовый план' } }
  await page.route('**/api/v1/me/responses?**', route => route.fulfill({ json: {
    items: new URL(route.request().url()).searchParams.get('direction') === 'outgoing' ? [first, second] : [], next_cursor: null,
  } }))
  await launch(page, `/plans?tab=outgoing&plan=${planId}`)
  await expect(page.locator('.response-history-entry')).toHaveCount(1)
  await expect(page.locator('.response-history-entry h3')).toHaveText(first.history_context.plan_title)
  await expect(page.locator('.response-history')).toHaveAttribute('open', '')
  await expect(page.locator('.response-history-entry a')).toHaveCount(0)
  await page.getByRole('button', { name: 'Отклики', exact: true }).click()
  await expect(page.locator('.response-history-entry')).toHaveCount(2)
  expect(new URL(page.url()).searchParams.has('plan')).toBe(false)
})

test('bot archive link requests the target plan, preserves refresh and can return to the full archive', async ({ page }) => {
  const mock = scenario({ archived: true })
  await mock.install(page, responder)
  const first = mock.response({ id: crypto.randomUUID(), status: 'rejected', version: 2 }, responder)
  const second = { ...first, id: crypto.randomUUID(), plan_id: crypto.randomUUID(), history_context: { ...first.history_context, plan_title: 'Другая архивная история' } }
  const filters: (string | null)[] = []
  await page.route('**/api/v1/me/activity?**', route => {
    expect(route.request().headers()['x-account-context']).toBe(responder)
    const params = new URL(route.request().url()).searchParams, selected = params.get('plan_id')
    filters.push(selected)
    return route.fulfill({ json: { items: [first, second].filter(response => !selected || response.plan_id === selected).map(response => ({
      key: `outgoing:${response.id}`, kind: 'outgoing', plan_id: response.plan_id, archived: true, hidden: false, response, plan: null, match: null,
    })), next_cursor: null } })
  })
  await launch(page, `/plans?tab=archive&plan=${planId}`)
  await expect(page.locator('.response-history-entry')).toHaveCount(1)
  expect(filters).toContain(planId)
  const entry = await page.locator('.response-history-entry').elementHandle()
  await expect(page.getByRole('button', { name: 'Обновить список', exact: true })).toHaveCount(0)
  const beforeRefresh = filters.length
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => filters.length).toBeGreaterThan(beforeRefresh)
  expect(await entry!.evaluate(node => node.isConnected)).toBe(true)
  expect(filters.every(value => value === planId)).toBe(true)
  await page.getByRole('button', { name: 'Архив', exact: true }).click()
  await expect(page.locator('.response-history-entry')).toHaveCount(2)
  expect(filters).toContain(null)
})
