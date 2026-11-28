import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const widths = [320, 360, 375, 390, 430]
const root = join(tmpdir(), 'poidem-final-mobile', 'after')

test('live plan filter works at mobile widths without a submit and preserves readable layout', async ({ page }, testInfo) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  await page.goto('/create', { waitUntil: 'domcontentloaded' })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    for (const [field, value] of [['title', 'хуй'], ['description', 'наркотики'], ['placeName', 'стриптиз'], ['placeAddress', 'закрытая крыша']]) {
      const input = page.locator(`form [name=${field}]`)
      await input.fill(value)
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await expect(page.locator(field.startsWith('place') ? '#error-place' : `#error-${field}`)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      await input.fill('Кофе')
      await expect(input).toHaveAttribute('aria-invalid', 'false')
    }
  }
  await page.locator('[name=placeName]').fill('Закрытая крыша')
  await page.screenshot({ path: testInfo.outputPath('live-plan-filter.png'), fullPage: true })
})

test('unavailable matches keep a safe empty state at mobile widths', async ({ page }) => {
  test.setTimeout(90000)
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/match/old-match')
    await expect(page.getByRole('heading', { name: 'Для встречи нужны двое' })).toBeVisible()
    await expect(page.locator('.match-portraits')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.getByRole('link', { name: 'К моим планам', exact: true }).click()
    await expect(page).toHaveURL('/plans')
  }
})

test('home atmosphere and monochrome SVG preserve the plan-search action', async ({ page }) => {
  test.setTimeout(90000)
  const captureRoot = test.info().project.name ? join(root, test.info().project.name) : root
  await mkdir(captureRoot, { recursive: true })
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  for (const width of test.info().project.name ? widths : [...widths, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/home')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByText('Привет. Давай придумаем что-нибудь хорошее')).toBeVisible()
    await expect(page.locator('svg.title-star')).toHaveCount(1)
    await expect(page.locator('.title-star')).toHaveCSS('color', 'rgb(184, 228, 255)')
    expect(await page.locator('.title-star').textContent()).toBe('')
    await expect(page.locator('.home-atmosphere > img')).toHaveAttribute('src', '/images/hands-cinema.jpg')
    await expect(page.locator('.home-atmosphere')).toHaveCSS('position', 'fixed')
    const background = (await page.locator('.home-atmosphere').boundingBox())!
    expect(background.x).toBe(0)
    expect(background.y).toBe(0)
    expect(background.width).toBe(width)
    expect(background.height).toBe(900)
    await expect(page.locator('.home-atmosphere > img')).toHaveCSS('filter', 'blur(2px)')
    await expect(page.locator('.hero-copy')).toHaveCSS('filter', 'none')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: join(captureRoot, `home-${width}.png`), fullPage: true, animations: 'disabled' })
    if (width <= 430) {
      await page.setViewportSize({ width, height: 600 })
      const layer = page.locator('.home-atmosphere')
      const image = page.locator('.home-atmosphere > img')
      const layerBefore = await layer.boundingBox()
      const imageBefore = await image.boundingBox()
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      expect(await layer.boundingBox()).toEqual(layerBefore)
      expect(await image.boundingBox()).toEqual(imageBefore)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    }
    await page.getByRole('link', { name: 'Найти свой план', exact: true }).click()
    await expect(page).toHaveURL('/catalog')
    await expect(page.locator('.home-atmosphere')).toHaveCount(0)
    await expect(page.locator('.plan-card')).toHaveCount(0)
  }
})
