import { expect, test } from '@playwright/test'
import { author, responder, planId, matchId, scenario, launch } from './connectionScenario'

test('two accounts send, accept and see the same match with contact only after consent', async ({ page, browser }) => {
  const mock = scenario()
  const owner = await browser.newPage()
  try {
    await mock.install(page, responder); await mock.install(owner, author)
    await launch(page, `/people/${planId}`)
    await expect(page.getByRole('heading', { name: /Тестовый автор/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Написать в Telegram' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
    await expect(page.getByText('Ожидает ответа', { exact: true })).toBeVisible()
    await launch(owner, '/plans?tab=incoming')
    await owner.getByRole('button', { name: 'Принять', exact: true }).click()
    await expect(owner).toHaveURL(`/match/${matchId}`)
    await expect(owner.locator('.match-portrait')).toHaveCount(2)
    await expect(owner.getByRole('link', { name: 'Написать в Telegram' })).toHaveAttribute('href', 'https://t.me/Synthetic_Partner')
    await launch(page, '/plans?tab=matches')
    await page.getByRole('link', { name: 'Подробнее', exact: true }).click()
    await expect(page.locator('.match-portrait')).toHaveCount(2)
    expect(mock.state.attempts).toHaveLength(1)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(matchId)
  } finally { await owner.close() }
})

test('rejection permanently hides the plan and provides no link back to it', async ({ page, browser }, testInfo) => {
  const mock = scenario(), owner = await browser.newPage()
  try {
    await mock.install(page, responder); await mock.install(owner, author)
    await launch(page, `/people/${planId}`)
    await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
    await launch(owner, '/plans?tab=incoming')
    await owner.getByRole('button', { name: 'Отклонить', exact: true }).click()
    await expect(owner.getByText('Вы отклонили отклик', { exact: true })).toBeVisible()
    await expect(owner.locator('.response-history-entry')).toContainText('Тестовый участник, 24')
    await expect(owner.locator('.response-history-entry')).not.toContainText('Повторно откликнуться')
    await owner.locator('.response-history-entry').screenshot({ path: testInfo.outputPath('rejection-author.png') })
    await page.getByRole('button', { name: 'Обновить план', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Этот план недоступен' })).toBeVisible()
    await launch(page, '/plans?tab=outgoing')
    await expect(page.getByText('Ваш отклик не принят', { exact: true })).toBeVisible()
    await expect(page.locator('.response-history-entry a')).toHaveCount(0)
    await expect(page.locator('.response-history-entry')).toContainText('Автор: Тестовый автор')
    await expect(page.locator('.response-history-entry h3')).toHaveText('Тестовый вечер в галерее')
    await page.locator('.response-history-entry').screenshot({ path: testInfo.outputPath('rejection-responder.png') })
    expect(mock.state.attempts).toHaveLength(1)
  } finally { await owner.close() }
})

test('fifteen waiting responses disable sending without offering a simulated match', async ({ page }) => {
  const mock = scenario({ full: true })
  await mock.install(page, responder)
  await launch(page, `/people/${planId}`)
  await expect(page.getByText('Ожидают ответа: 15 из 15', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Пойдём?', exact: true })).toBeDisabled()
  expect(mock.state.attempts).toHaveLength(0)
})

test('missing username has an honest state and match layout keeps the approved logo away from text', async ({ page }, testInfo) => {
  const mock = scenario({ matched: true, noUsername: true })
  await mock.install(page, responder)
  await launch(page, `/match/${matchId}`)
  await expect(page.locator('.match-portrait')).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'Открыть чат', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Написать в Telegram' })).toHaveCount(0)
  for (const width of [320, 360, 375, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    if (width <= 430) {
      const logo = await page.locator('.match-heading > img').boundingBox()
      const heading = await page.locator('.match-heading h1').boundingBox()
      expect(logo!.y + logo!.height).toBeLessThanOrEqual(heading!.y)
    }
  }
  await page.setViewportSize({ width: 375, height: 844 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: testInfo.outputPath('real-match-layout.png') })
})
