import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { author, responder, planId, publicProfile, scenario, launch } from './connectionScenario'

// Только тестовая подмена защищённого изображения; путь к портрету не попадает в UI/API приложения.
const portrait = readFileSync(new URL('../public/images/portrait-sasha.jpeg', import.meta.url))
const photoPath = `/api/v1/plans/${planId}/author/photo`
const title = 'Кофе после прогулки'
const bio = 'Неспешные прогулки, музыка и разговоры за кофе'
const description = 'Договоримся о маршруте в переписке'

async function detail(page: Page, options: { photo?: 'missing' | 'error'; experience?: number; blocked?: boolean; full?: boolean; long?: boolean } = {}) {
  const mock = scenario({ full: options.full })
  await mock.install(page, responder)
  const person = { ...publicProfile(author), name: options.long ? 'Оченьдлинноеимябезпробелов'.repeat(2) : 'Саша', bio,
    photo: { url: options.photo === 'missing' ? '' : photoPath },
    experience: { unique_confirmed_partners: options.experience ?? 0, policy_version: 'D58-mutual-unique-partners-v1' } }
  const plan = { ...mock.plan(responder), title: options.long ? 'Достопримечательности'.repeat(4).slice(0, 80) : title,
    place: options.long ? 'Оченьдлинныйадрес'.repeat(10).slice(0, 160) : 'Москва, Парк Горького', description }
  await page.route(`**/api/v1/plans/${planId}/author`, route => route.fulfill({ json: { profile: person } }))
  await page.route(`**${photoPath}`, route => options.photo === 'error'
    ? route.fulfill({ status: 404, json: { error: { code: 'PHOTO_UNAVAILABLE', message: 'Фото недоступно' } } })
    : route.fulfill({ contentType: 'image/jpeg', body: portrait }))
  await page.route(`**/api/v1/plans/${planId}`, route => route.fulfill({ json: { plan } }))
  if (options.blocked) await page.route(`**/api/v1/plans/${planId}/capacity`, route => route.fulfill({ json: { count: 0, maximum: 15, remaining: 15, can_respond: false, own_response_id: null } }))
  return { mock, person, plan }
}

test('author portrait and compact hierarchy keep the invitation above navigation', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const { mock } = await detail(page, { experience: 3 })
  await launch(page, `/people/${planId}`)
  const photo = page.locator('.person-photo img'), invite = page.getByRole('button', { name: 'Пойдём?', exact: true })
  await expect(photo).toHaveAttribute('src', new RegExp(`${photoPath}$`))
  await expect.poll(() => photo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'Саша, 24', exact: true })).toBeVisible()
  await expect(page.getByText(title, { exact: true })).toHaveCount(1)
  await expect(page.getByText(bio, { exact: true })).toBeHidden()
  await expect(page.locator('.person-more .interest-tags')).toBeHidden()
  await expect(page.locator('.site-footer')).toHaveCount(0)
  for (const width of [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : width > 1000 ? 900 : 844 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const button = (await invite.boundingBox())!, nav = await page.locator('.mobile-nav').boundingBox()
    if (nav?.height) expect(button.y + button.height, `CTA at ${width}px`).toBeLessThanOrEqual(nav.y)
    const image = (await photo.boundingBox())!
    if (width <= 430) { expect(image.height).toBeGreaterThanOrEqual(190); expect(image.height).toBeLessThanOrEqual(260) }
    await page.screenshot({ path: testInfo.outputPath(`person-plan-${width}.png`) })
  }
  await page.getByText('Об авторе и плане', { exact: true }).click()
  await expect(page.getByText(bio, { exact: true })).toBeVisible()
  await expect(page.locator('.person-more .interest-tags .chip')).toHaveCount(3)
  await expect(page.getByText(description, { exact: true })).toBeVisible()
  await invite.click()
  await expect(page.getByText('Ожидает ответа', { exact: true })).toBeVisible()
  expect(mock.state.attempts).toHaveLength(1)
})

for (const photo of ['missing', 'error'] as const) test(`unavailable author photo (${photo}) has a neutral placeholder and preserves actions`, async ({ page }, testInfo) => {
  const { mock } = await detail(page, { photo })
  await launch(page, `/people/${planId}`)
  await expect(page.getByRole('img', { name: 'Фотография автора недоступна', exact: true })).toBeVisible()
  await expect(page.locator('.person-photo img')).toHaveCount(0)
  await expect(page.locator('.person-photo')).toContainText('Фото пока недоступно')
  await expect(page.getByRole('button', { name: 'Пойдём?', exact: true })).toBeEnabled()
  await expect(page.locator('.experience-badge')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('Взаимные подтверждения')
  await page.screenshot({ path: testInfo.outputPath(`person-photo-${photo}.png`) })
  await page.getByRole('link', { name: 'Следующий план', exact: true }).click()
  await expect(page).toHaveURL('/catalog')
  await expect(page.locator('.site-footer')).toHaveCount(1)
  expect(mock.state.attempts).toHaveLength(0)
})

test('public experience is a positive badge without a number; personal statistics stay private', async ({ page }, testInfo) => {
  const { person } = await detail(page, { experience: 12 })
  await launch(page, `/people/${planId}`)
  const badge = page.locator('.experience-badge')
  await badge.locator('summary').click()
  await expect(badge).toContainText('Участники хотя бы одной встречи подтвердили, что встретились')
  expect(await badge.innerText()).not.toMatch(/\d/u)
  await expect(page.locator('[aria-label*="Уникальных партнёров"]')).toHaveCount(0)
  person.experience.unique_confirmed_partners = 0
  await page.getByRole('button', { name: 'Обновить план', exact: true }).click()
  await expect(page.locator('.person-photo img')).toBeVisible()
  await expect.poll(() => page.locator('.person-photo img').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(badge).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('Взаимные подтверждения')
  await page.screenshot({ path: testInfo.outputPath('person-no-experience.png') })
  await page.route('**/api/v1/me/reliability', route => route.fulfill({ json: { unique_confirmed_partners: 12, policy_version: 'D58-mutual-unique-partners-v1' } }))
  await launch(page, '/profile')
  await expect(page.getByLabel('Уникальных партнёров со взаимным подтверждением встречи: 12')).toHaveText('Взаимные подтверждения · 12')
})

for (const state of ['blocked', 'full'] as const) test(`${state} server capacity is never bypassed by the redesigned page`, async ({ page }) => {
  const { mock } = await detail(page, { [state]: true, experience: 3 })
  await launch(page, `/people/${planId}`)
  const invite = page.getByRole('button', { name: 'Пойдём?', exact: true })
  await expect(invite).toBeDisabled()
  if (state === 'full') await expect(page.getByText('На план уже ожидают ответа 15 человек', { exact: true })).toBeVisible()
  else await expect(page.getByText('Сейчас откликнуться на этот план нельзя', { exact: true })).toBeVisible()
  await page.getByText('Есть подтверждённые встречи', { exact: true }).click()
  await page.getByText('Об авторе и плане', { exact: true }).click()
  await page.getByRole('button', { name: 'Обновить план', exact: true }).click()
  await expect(invite).toBeDisabled()
  expect(mock.state.attempts).toHaveLength(0)
})

test('long names and plan text wrap; expanded details remain above the bottom navigation', async ({ page }) => {
  test.setTimeout(60000)
  await detail(page, { long: true })
  await launch(page, `/people/${planId}`)
  for (const width of [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const heading = (await page.locator('.person-details h1').boundingBox())!, panel = (await page.locator('.person-details').boundingBox())!
    expect(heading.x + heading.width).toBeLessThanOrEqual(panel.x + panel.width + 1)
  }
  await page.setViewportSize({ width: 320, height: 740 })
  await page.getByText('Об авторе и плане', { exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const bottom = (await page.getByText(description, { exact: true }).boundingBox())!
  const nav = (await page.locator('.mobile-nav').boundingBox())!
  expect(bottom.y + bottom.height).toBeLessThan(nav.y)
  await page.getByRole('link', { name: 'Все планы', exact: true }).click()
  await expect(page).toHaveURL('/catalog')
})
