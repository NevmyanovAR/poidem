import { fillProfileBasics } from './helpers/profile'
import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

const phase = process.env.POIDEM_REVIEW_PHASE === 'before' ? 'before' : 'after'
const reviewRoot = join(tmpdir(), process.env.POIDEM_REVIEW_DIR ?? 'poidem-desktop-review')
const viewports = [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 },
  { width: 1024, height: 768 }, { width: 768, height: 1024 },
  { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 393, height: 852 },
]

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  for (const img of await page.locator('img').all()) {
    if (!await img.isVisible()) continue
    await img.scrollIntoViewIfNeeded()
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await img.evaluate(el => (el as HTMLImageElement).decode())
  }
  await page.mouse.move(0, 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' })
  await writeFile(join(reviewRoot, phase, name), png)
  await writeFile(test.info().outputPath(name), png)
}

test('desktop welcome and registration adapt while mobile composition stays available', async ({ page }) => {
  test.setTimeout(180000)
  await mkdir(join(reviewRoot, phase), { recursive: true })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    const suffix = viewport.width + 'x' + viewport.height + '.png'
    await page.goto('/')
    await capture(page, 'welcome-' + suffix)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'welcome ' + suffix).toBe(false)
    if (phase === 'after' && viewport.width > 680) {
      const photo = (await page.locator('.welcome-photo').boundingBox())!
      const logo = (await page.locator('.welcome-top .brand img').boundingBox())!
      const copy = (await page.locator('.welcome-copy').boundingBox())!
      expect(photo.x).toBe(0)
      expect(photo.y).toBe(0)
      expect(photo.width).toBe(viewport.width)
      expect(photo.height).toBeGreaterThanOrEqual(viewport.height)
      await expect(page.locator('.welcome-photo > img')).toHaveCSS('object-fit', 'cover')
      await expect(page.locator('.welcome-photo > img')).toHaveCSS('opacity', '1')
      await expect(page.locator('.welcome-photo > img')).toHaveCSS('filter', 'blur(1.5px)')
      await expect(page.locator('.welcome-body')).toHaveCSS('filter', 'none')
      await expect(page.locator('.welcome-photo > img')).not.toHaveAttribute('data-fallback', 'true')
      expect(logo.x).toBeLessThan(viewport.width * .15)
      expect(logo.y).toBeLessThan(viewport.height * .15)
      expect(await page.locator('.welcome-top .brand img').evaluate(el => (el as HTMLImageElement).currentSrc)).toContain('/brand/logo_full.png')
      expect(copy.x).toBeLessThan(viewport.width * .15)
      expect(copy.y).toBeGreaterThan(viewport.height * .2)
      await expect(page.locator('.welcome-glasses')).toBeHidden()
      await expect(page.getByText('Меньше переписок', { exact: true })).toBeHidden()
      const secondary = page.getByRole('link', { name: 'Посмотреть планы', exact: true })
      await secondary.hover()
      await expect(secondary).toHaveCSS('background-color', 'rgb(184, 228, 255)')
      await expect(secondary).toHaveCSS('color', 'rgb(85, 7, 7)')
    }
    await page.getByRole('link', { name: 'Начать знакомство', exact: true }).click()
    await expect(page).toHaveURL('/profile')
    await capture(page, 'profile-' + suffix)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'profile ' + suffix).toBe(false)
    if (phase === 'after' && viewport.width > 680) {
      const image = (await page.locator('.profile-editorial').boundingBox())!
      const form = (await page.locator('.profile-page > .form-panel').boundingBox())!
      expect(image.x + image.width).toBeLessThanOrEqual(form.x)
      expect(image.height).toBeGreaterThanOrEqual(450)
      expect((await page.locator('.profile-authorization').boundingBox())!.x).toBe(form.x)
      if (viewport.width >= 1366) expect(image.width / viewport.width).toBeGreaterThan(.4)
      await expect(page.locator('.profile-editorial > img')).toHaveCount(1)
    }
    await fillProfileBasics(page)
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await capture(page, 'profile-step2-' + suffix)
    await expect(page.getByRole('button', { name: 'Сохранить анкету', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('Проверка формы')
    await page.goto('/home')
    await page.evaluate(() => localStorage.clear())
  }
  expect(errors).toEqual([])
})

test('welcome secondary action retains its navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('link', { name: 'Посмотреть планы', exact: true }).click()
  await expect(page).toHaveURL('/home')
})
