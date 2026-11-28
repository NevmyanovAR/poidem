import { serveEditorial } from './helpers/editorial'
import { fillProfileBasics } from './helpers/profile'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const wine = 'rgb(85, 7, 7)'
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
  }, [wine, light, white])
  expect(unexpected).toEqual([])
  expect(await page.locator('body').innerText()).not.toMatch(/прототип/i)
}

test.beforeEach(async ({ page }) => { await serveEditorial(page) })

test('approved palette across routes, both profile steps and interaction states', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/', '/home', '/catalog', '/profile', '/create', '/plans', '/inspiration', '/people/demo-gallery', '/match/missing']) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), `Direct request to ${route}`).toBe(200)
      await expect(page.locator('main')).toBeVisible()
      await expect(page.locator('h1, .empty-state h2').first()).toBeVisible()
      await checkColors(page)
      if (['/', '/profile', '/catalog', '/inspiration'].includes(route)) {
        await page.evaluate(() => document.fonts.ready)
        for (const img of await page.locator('img').all()) {
          if (!await img.isVisible()) continue
          await img.scrollIntoViewIfNeeded()
          await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
        }
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: test.info().outputPath(`${route === '/' ? 'welcome' : route.slice(1)}-${width}.png`), fullPage: true })
      }
      if (route === '/home') {
        await expect(page.locator('.hero-copy h1')).toHaveCSS('color', white)
        await expect(page.locator('.hero-copy h1 em')).toHaveCSS('color', light)
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: test.info().outputPath(`home-${width}.png`), fullPage: true })
      }
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(wine)
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).color)).toBe(white)
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--brand-light-blue').trim())).toBe('#B8E4FF')
    }
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await checkColors(page)
    await expect(page.locator('.field-error').first()).toHaveCSS('color', light)
    await fillProfileBasics(page)
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await page.getByRole('button', { name: 'Кофе', exact: true }).click()
    await expect(page.locator('button.chip.selected').first()).toHaveCSS('background-color', light)
    await expect(page.locator('button.chip.selected').first()).toHaveCSS('color', wine)
    await checkColors(page)
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
    await page.goto('/match/missing')
    await checkColors(page)
    await expect(page.getByRole('button', { name: 'Очистить данные', exact: true })).toHaveCount(0)
    await page.goto('/settings')
    await checkColors(page)
    await page.goto('/plans')
    await checkColors(page)
  }
})

test('static assets use only approved colors; authored small-text pairs meet contrast 4.5', async () => {
  const allowed = new Set(['#550707', '#B8E4FF', '#FFFFFF'])
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
  for (const [foreground, background] of [['#FFFFFF', '#550707'], ['#B8E4FF', '#550707'], ['#550707', '#B8E4FF']]) {
    const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
})

test('mobile browser without SDK previews input but never creates a local substitute for server plans', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Войди, чтобы увидеть планы' })).toBeVisible()
  await page.goto('/create')
  await page.getByRole('textbox', { name: 'Название плана' }).fill('Кофе в 18.30')
  await page.getByRole('textbox', { name: 'Название места', exact: true }).fill('ул. Примерная, 3')
  await page.getByRole('textbox', { name: 'Адрес', exact: true }).fill('Тестовый город, улица 1')
  await page.locator('input[name=date]').fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10))
  await page.locator('input[name=time]').fill('18:30')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeDisabled()
  await page.reload()
  await page.goto('/plans')
  await expect(page.locator('.my-plan')).toHaveCount(0)
  await page.goto('/catalog')
  await expect(page.locator('.plan-card')).toHaveCount(0)
  expect(serviceRequests).toEqual([])
  expect(errors).toEqual([])
})

test('original transparent PNGs are served unchanged and logos use their proportions', async ({ page }) => {
  for (const name of ['logo_full.png', 'logo_text.png', 'logo_glasses.png']) {
    const original = await readFile(new URL(`../../references/brand/${name}`, import.meta.url))
    const copy = await readFile(new URL(`../public/brand/${name}`, import.meta.url))
    expect(copy.equals(original), name).toBe(true)
  }
  await page.goto('/')
  const lettering = page.locator('.welcome-top .brand img')
  const glasses = page.locator('.welcome-glasses')
  await expect(lettering).toHaveAttribute('src', '/brand/logo_text.png')
  await expect(glasses).toHaveAttribute('src', '/brand/logo_glasses.png')
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(() => lettering.evaluate(el => (el as HTMLImageElement).currentSrc)).toContain(viewport.width > 680 ? '/brand/logo_full.png' : '/brand/logo_text.png')
    if (viewport.width > 680) await expect(glasses).toBeHidden()
    for (const logo of viewport.width > 680 ? [lettering] : [lettering, glasses]) {
      await expect(logo).toBeVisible()
      await expect(logo).toHaveCSS('filter', 'none')
      await expect.poll(() => logo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await logo.evaluate(img => (img as HTMLImageElement).decode())
      const geometry = await logo.evaluate(node => {
        const img = node as HTMLImageElement
        const rect = img.getBoundingClientRect()
        return { actual: rect.width / rect.height, original: img.naturalWidth / img.naturalHeight }
      })
      expect(geometry.actual).toBeCloseTo(geometry.original, 2)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
  await page.goto('/profile')
  await expect(page.locator('header .brand img')).toHaveAttribute('src', '/brand/logo_text.png')
})

test('Forum renders Cyrillic headings, light-blue accents and transparent light-blue circles', async ({ page }) => {
  await page.goto('/home')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.hero-copy h1')).toHaveCSS('font-family', 'Forum, Georgia, serif')
  const session = await page.context().newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const { root } = await session.send('DOM.getDocument')
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.hero-copy h1' })
  const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
  expect(fonts.some((font: { familyName: string; glyphCount: number }) => font.familyName === 'Forum' && font.glyphCount > 0)).toBe(true)
  await session.detach()
  await expect(page.locator('.hero-copy h1 em')).toHaveCSS('color', light)
  await expect(page.locator('.hero-footnote svg')).toHaveCSS('color', light)
  await page.goto('/inspiration')
  for (const arrow of await page.locator('.photo-arrow').all()) {
    await expect(arrow).toHaveCSS('color', light)
    await expect(arrow).toHaveCSS('border-top-color', light)
    await expect(arrow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(arrow.locator('svg')).toHaveCSS('color', light)
  }
})

test('Nicoletta renders the approved spelling with no missing Cyrillic glyphs or saturated blue', async ({ page }) => {
  for (const route of ['/', '/home']) {
    await page.goto(route)
    await page.evaluate(() => document.fonts.ready)
    const accent = page.locator('h1 em')
    await expect(accent).toHaveText(route === '/' ? '«пойдем?»' : 'пойдем?')
    await expect(accent).toHaveCSS('font-family', '"Nicoletta Script", Forum, serif')
    await expect(accent).toHaveCSS('font-style', 'normal')
    await expect(accent).toHaveCSS('color', light)
    const session = await page.context().newCDPSession(page)
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1 em' })
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
    expect(fonts.length).toBeGreaterThan(0)
    expect(fonts.every((font: { familyName: string; isCustomFont: boolean }) => font.familyName.toLowerCase().includes('nicoletta') && font.isCustomFont)).toBe(true)
    await session.detach()
  }
  for (const route of ['/profile', '/create', '/plans', '/catalog', '/inspiration']) {
    await page.goto(route)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.locator('em').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringMatching(/[Ёё]/)]))
    await checkColors(page)
  }
})
