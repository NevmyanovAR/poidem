import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const wine = 'rgb(85, 7, 7)'
const blue = 'rgb(5, 153, 246)'
const light = 'rgb(184, 228, 255)'
const white = 'rgb(255, 255, 255)'

async function checkColors(page: import('@playwright/test').Page) {
  const unexpected = await page.evaluate((allowed) => {
    const sample = document.createElement('span')
    sample.style.color = 'var(--muted)'
    document.body.appendChild(sample)
    const muted = getComputedStyle(sample).color
    sample.remove()
    return [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
      const style = getComputedStyle(el)
      return el.getClientRects().length > 0 && style.visibility !== 'hidden'
        && ![...allowed, muted].includes(style.color)
    }).slice(0, 12).map(el => ({ element: el.tagName, className: String(el.className), color: getComputedStyle(el).color }))
  }, [wine, blue, light, white])
  expect(unexpected).toEqual([])
  expect(await page.locator('body').innerText()).not.toMatch(/демо|демонстрац|прототип|имитац|имитир/i)
}

test('approved palette on all nine screens, both profile steps and interaction states', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/home', '/catalog', '/profile', '/create', '/plans', '/inspiration', '/people/demo-gallery']) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), `Direct request to ${route}`).toBe(200)
      await expect(page.locator('main')).toBeVisible()
      await expect(page.locator('h1, .empty-state h2').first()).toBeVisible()
      await checkColors(page)
      if (route === '/home') {
        await expect(page.locator('.hero-copy h1')).toHaveCSS('color', white)
        await expect(page.locator('.hero-copy h1 em')).toHaveCSS('color', light)
        await page.evaluate(() => document.fonts.ready)
        await page.locator('.hero-image img').evaluate(img => (img as HTMLImageElement).decode())
        await page.screenshot({ path: test.info().outputPath(`home-${width}.png`), fullPage: true })
      }
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(wine)
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).color)).toBe(white)
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--brand-blue').trim())).toBe('#0599F6')
    }
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await checkColors(page)
    await expect(page.locator('.field-error').first()).toHaveCSS('color', light)
    await page.getByRole('button', { name: 'Заполнить примером' }).click()
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await checkColors(page)
    await expect(page.locator('button.chip.selected').first()).toHaveCSS('background-color', light)
    await expect(page.locator('button.chip.selected').first()).toHaveCSS('color', wine)
    const primary = page.getByRole('button', { name: 'Сохранить анкету' })
    // Move the pointer away before checking the default state on desktop.
    await page.mouse.move(0, 0)
    await expect(primary).toHaveCSS('background-color', light)
    await expect(primary).toHaveCSS('color', wine)
    await primary.hover()
    await expect(primary).toHaveCSS('background-color', white)
    await expect(primary).toHaveCSS('color', wine)
    await primary.focus()
    await checkColors(page)
    await page.goto('/people/demo-gallery')
    const invite = page.getByRole('button', { name: 'Пойдём?', exact: true })
    if (await invite.isVisible()) await invite.click()
    await page.getByRole('button', { name: 'Посмотреть совпадение' }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: /Кажется, вам/ })).toBeVisible()
    await checkColors(page)
    await page.getByRole('button', { name: 'Перейти к общению' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await checkColors(page)
    await page.getByRole('button', { name: 'Понятно', exact: true }).click()
    await page.goto('/plans')
    await checkColors(page)
  }
})

test('static assets use only approved colors; authored small-text pairs meet contrast 4.5', async () => {
  const allowed = new Set(['#550707', '#0599F6', '#B8E4FF', '#FFFFFF'])
  for (const name of ['src/theme.css', 'public/favicon.svg', 'public/fallback.svg', 'index.html']) {
    const content = await readFile(new URL(`../${name}`, import.meta.url), 'utf8')
    for (const color of content.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) expect(allowed.has(color), `${name}: ${color}`).toBe(true)
  }
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull()
  function luminance(hex: string) {
    return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const channel = parseInt(hex.slice(index * 2 + 1, index * 2 + 3), 16) / 255
      return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    }, 0)
  }
  for (const [foreground, background] of [['#FFFFFF', '#550707'], ['#B8E4FF', '#550707'], ['#550707', '#B8E4FF'], ['#550707', '#0599F6']]) {
    const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
})

test('mobile production flow works with no SDK, initData or backend and survives deep-link reloads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  const serviceRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', req => {
    // The local machine injects antivirus instrumentation into Chrome pages.
    // Observe it normally, but do not attribute its requests to this application.
    if (new URL(req.url()).hostname === 'gc.kis.v2.scr.kaspersky-labs.com') return
    if (['fetch', 'xhr'].includes(req.resourceType()) || req.method() !== 'GET') serviceRequests.push(req.url())
  })
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  await page.goto('/')
  expect(await page.evaluate(() => window.Telegram)).toBeUndefined()
  await page.getByRole('link', { name: 'Посмотреть планы' }).click()
  await page.getByRole('link', { name: 'Найти свой план', exact: true }).click()
  await page.getByRole('link', { name: 'Выбрать план «Выставка, потом кофе»' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
  await expect(page).toHaveURL('/people/demo-gallery')
  await page.getByRole('button', { name: 'Посмотреть совпадение' }).click()
  const matchUrl = page.url()
  await page.goto(matchUrl)
  await expect(page.getByRole('heading', { name: /Кажется, вам/ })).toBeVisible()
  await page.getByRole('link', { name: 'К моим планам', exact: true }).click()
  await page.reload()
  await expect(page.locator('.my-plan')).toHaveCount(1)
  expect(serviceRequests).toEqual([])
  expect(errors).toEqual([])
})
