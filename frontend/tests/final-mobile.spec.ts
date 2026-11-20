import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const widths = [320, 360, 375, 390, 430]
const root = join(tmpdir(), 'poidem-final-mobile', 'after')

test('mobile match decoration has its own space and original PNG proportions', async ({ page }) => {
  test.setTimeout(90000)
  const captureRoot = test.info().project.name ? join(root, test.info().project.name) : root
  await mkdir(captureRoot, { recursive: true })
  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Демонстрационный режим' }).click()
  await page.getByRole('button', { name: 'Заполнить примером', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить анкету', exact: true }).click()
  await page.goto('/people/demo-gallery')
  await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
  await page.getByRole('button', { name: 'Имитировать принятие автором' }).click()
  await expect(page.locator('.match-heading')).toBeVisible()
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--app-safe-left', '12px')
      document.documentElement.style.setProperty('--app-safe-right', '12px')
      document.documentElement.style.setProperty('--app-safe-top', '20px')
      document.documentElement.style.setProperty('--app-safe-bottom', '34px')
    })
    await page.evaluate(() => document.fonts.ready)
    const logo = page.locator('.match-heading > .brand-glasses')
    await expect(logo).toHaveAttribute('src', '/brand/logo_glasses.png')
    const box = (await logo.boundingBox())!
    expect(box.width / box.height).toBeCloseTo(2, 2)
    const letters = await page.locator('.match-heading h1').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el)
      return [...range.getClientRects()].map(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }))
    })
    expect(letters.length).toBeGreaterThan(0)
    for (const rect of letters) expect(box.y + box.height + 15).toBeLessThan(rect.top)
    expect(box.x).toBeGreaterThanOrEqual(12)
    expect(box.x + box.width).toBeLessThanOrEqual(width - 12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect(page.locator('.match-heading h1')).toHaveCSS('font-size', '69px')
    await page.screenshot({ path: join(captureRoot, `match-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  for (const width of test.info().project.name ? [] : [431, 680, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    const logo = page.locator('.match-heading > .brand-glasses')
    await expect(logo).toHaveCSS('position', 'absolute')
    await expect(logo).toHaveCSS('width', width <= 680 ? '68px' : '105px')
    await expect(logo).toHaveCSS('height', width <= 680 ? '55px' : '80px')
    await expect(page.locator('.match-heading')).toHaveCSS('display', 'block')
    await expect(page.locator('.match-heading h1')).toHaveCSS('font-size', width <= 680 ? '69px' : '86px')
    if (width > 680) await page.screenshot({ path: join(captureRoot, `match-${width}.png`), fullPage: true, animations: 'disabled' })
  }
  await page.getByRole('button', { name: 'Перейти к общению' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('home atmosphere and monochrome SVG preserve the plan-search action', async ({ page }) => {
  const captureRoot = test.info().project.name ? join(root, test.info().project.name) : root
  await mkdir(captureRoot, { recursive: true })
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить примером', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить анкету', exact: true }).click()
  await expect(page).toHaveURL('/home')
  for (const width of test.info().project.name ? widths : [...widths, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/home')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByText('Маша, какой у тебя план?')).toBeVisible()
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
    await page.getByRole('link', { name: 'Найти свой план', exact: true }).click()
    await expect(page).toHaveURL('/catalog')
    await expect(page.locator('.home-atmosphere')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Пока нет опубликованных планов' })).toBeVisible()
  }
})
