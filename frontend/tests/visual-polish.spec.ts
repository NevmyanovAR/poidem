import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { scenario, author, responder, planId, launch } from './connectionScenario'
import { installVisualCamera } from './helpers/visualCamera'

const phase = process.env.POIDEM_VISUAL_PHASE === 'before' ? 'before' : 'after'
const folder = resolve('..', '.local', 'stage11g', phase)
const cases = [
  { name: 'catalog', path: '/catalog', viewer: responder, useful: '.plan-grid' },
  { name: 'plans', path: '/plans', viewer: author, useful: '.my-plans-list' },
  { name: 'chats', path: '/chats', viewer: author, useful: '.dialogs-list', matched: true },
  { name: 'profile', path: '/profile', viewer: author, useful: '.profile-page .form-panel' },
  { name: 'person', path: `/people/${planId}`, viewer: responder, useful: '.person-response' },
  { name: 'create', path: '/create', viewer: author, useful: '.form-panel' },
  { name: 'verification', path: '/settings/photo-verification', viewer: author, useful: '.verification-framing' },
  { name: 'camera', path: '/settings/photo-verification', viewer: author, useful: '.verification-camera-actions', camera: true },
]
async function prepare(page: Page, item: typeof cases[number]) {
  const base = scenario({ matched: item.matched })
  if (item.name === 'plans') base.state.attempts.push({ id: '00000000-0000-4000-8000-000000004001', status: 'waiting', version: 1 })
  await base.install(page,item.viewer)
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/me/photo-verification') return route.fulfill({ json: { available: true, state: 'unverified', photo_verified: false, consent_version: 'synthetic-stage11g', consent_text: 'Синтетические условия только для браузерного теста', retention: { pending_hours: 72, reviewed_hours: 0 }, request: null } })
    if (path.endsWith('/photo-verification/challenge')) return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000009001', state: 'pending', version: 1, created_at: new Date().toISOString(), instruction: 'Покажи открытую ладонь рядом с лицом', consent_version: 'synthetic-stage11g' } })
    if (path.endsWith('/author')) return route.fulfill({ json: { profile: { name: 'Александра', age: 28, bio: 'Люблю выставки и прогулки', interests: ['Кино','Кофе','Искусство'], photo: { url: '/images/gallery.jpeg' }, photo_verified: true, experience: { unique_confirmed_partners: 8, pleasant_communication: true, policy_version: 'D58-mutual-unique-partners-v1' } } } })
    if (path === `/api/v1/plans/${planId}`) return route.fulfill({ json: { plan: { ...base.plan(item.viewer), place: 'Кафе у галереи · Тестовый город, Примерная улица, 1', place_check_status: 'confirmed' } } })
    return route.fallback()
  })
  if (item.camera) await installVisualCamera(page)
}

for (const item of cases) test(`polish ${item.name}: consistent spacing, safe controls and comparative screenshots`, async ({ page, isMobile }) => {
  test.setTimeout(180000)
  await mkdir(folder,{ recursive: true })
  await prepare(page,item)
  for (const width of isMobile ? [320,360,390,430] : [320,360,390,430,1366,1920]) {
    const height = width < 681 ? 844 : 1080
    await page.setViewportSize({ width, height })
    await launch(page,item.path)
    await expect(page.locator(item.camera ? '.verification-framing' : item.useful).first()).toBeAttached()
    await page.evaluate(() => document.fonts.ready)
    if (item.camera) {
      await page.getByRole('checkbox').check()
      await page.getByRole('button',{ name: 'Открыть камеру', exact: true }).click()
      await expect(page.locator('video')).toBeVisible()
    }
    await page.evaluate(() => window.scrollTo(0,0))
    const metrics = await page.evaluate(selector => {
      const main = document.querySelector('main')!, heading = [...main.querySelectorAll('h1')].find(node => node.getBoundingClientRect().height > 0)!, useful = main.querySelector(selector)!
      const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } }
      return { heading: rect(heading), useful: rect(useful), scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
    },item.useful)
    const suffix = test.info().project.name ? `-${test.info().project.name}` : ''
    await writeFile(resolve(folder,`${item.name}-${width}${suffix}.json`),JSON.stringify(metrics,null,2))
    await page.screenshot({ path: resolve(folder,`${item.name}-${width}${suffix}.png`) })
    if (phase === 'after') {
      expect(metrics.scrollWidth-width).toBeLessThanOrEqual(1)
      if (width < 681 && ['catalog','plans','chats','profile','create'].includes(item.name)) expect(metrics.useful.y,`${item.name} ${width}`).toBeLessThan(430)
      if (item.name === 'person') { await page.locator('.person-response .invite-button').scrollIntoViewIfNeeded(); await expect(page.getByRole('button',{name:'Пойдём?',exact:true})).toBeEnabled() }
      if (item.camera) {
        const take = await page.getByRole('button',{name:'Сделать снимок',exact:true}).boundingBox(), close = await page.getByRole('button',{name:'Закрыть камеру',exact:true}).boundingBox()
        expect(take && close && take.y+take.height <= close.y-8).toBeTruthy()
        expect(take?.height).toBeGreaterThanOrEqual(44)
        expect(close?.height).toBeGreaterThanOrEqual(44)
      }
      const nav = page.getByRole('navigation',{name:'Мобильная навигация'})
      if (width < 681) await expect(nav.getByRole('link')).toHaveCount(5)
      if (item.name === 'plans') await expect(page.getByRole('link',{name:/Посмотреть отклики \(1\)/})).toBeVisible()
    }
    if (item.camera) await page.getByRole('button',{name:'Закрыть камеру',exact:true}).click()
  }
})

test('visual keyboard hides obstructing chrome and restores five tabs without losing input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const state = { height: null as number | null, scale: 1 }
    Object.assign(window,{ __polishViewport: state })
    if (window.visualViewport) {
      Object.defineProperty(window.visualViewport,'height',{ configurable: true, get: () => state.height ?? window.innerHeight })
      Object.defineProperty(window.visualViewport,'scale',{ configurable: true, get: () => state.scale })
    }
  })
  await prepare(page,cases.find(item => item.name === 'profile')!)
  await launch(page,'/profile')
  const input = page.getByRole('textbox',{ name: 'Твоё имя', exact: true })
  await input.fill('Сохранённый черновик')
  await page.evaluate(() => { const s = (window as unknown as { __polishViewport: { height: number | null; scale: number } }).__polishViewport; s.height = 390; window.visualViewport?.dispatchEvent(new Event('resize')) })
  await expect(page.locator('html')).toHaveAttribute('data-visual-keyboard','')
  await expect(page.locator('.mobile-nav')).toBeHidden()
  expect(await page.locator('.mobile-nav a').count()).toBe(5)
  await expect(input).toHaveValue('Сохранённый черновик')
  await page.evaluate(() => { const s = (window as unknown as { __polishViewport: { height: number | null; scale: number } }).__polishViewport; s.height = null; window.visualViewport?.dispatchEvent(new Event('resize')) })
  await expect(page.locator('html')).not.toHaveAttribute('data-visual-keyboard')
  await expect(page.getByRole('navigation',{name:'Мобильная навигация'})).toBeVisible()
  await page.evaluate(() => { const s = (window as unknown as { __polishViewport: { height: number | null; scale: number } }).__polishViewport; s.height = 390; s.scale = 2; window.visualViewport?.dispatchEvent(new Event('resize')) })
  await expect(page.locator('.mobile-nav')).toBeVisible()
  await expect(input).toHaveValue('Сохранённый черновик')
})

test('larger text, safe areas, consent and camera controls remain usable without overlap', async ({ page }) => {
  test.setTimeout(120000)
  await prepare(page,cases.find(item => item.name === 'camera')!)
  for (const width of [320,390]) for (const path of ['/create','/profile','/settings/photo-verification']) {
    await page.setViewportSize({ width, height: 844 })
    await launch(page,path)
    await page.addStyleTag({ content: '.polished-ui :is(.heading-description,.small-note,label,.button,input,select,textarea) { font-size: 20px !important; }' })
    await page.evaluate(() => { document.documentElement.style.setProperty('--app-safe-top','24px'); document.documentElement.style.setProperty('--app-safe-bottom','34px') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)
    if (path === '/profile') {
      await page.getByRole('button',{name:'Продолжить',exact:true}).click()
      const back = await page.getByRole('button',{name:'Назад',exact:true}).boundingBox(), save = await page.getByRole('button',{name:'Сохранить анкету',exact:true}).boundingBox()
      expect(back && save && (back.y+back.height <= save.y || back.x+back.width <= save.x)).toBeTruthy()
    }
    if (path.includes('verification')) {
      await page.getByRole('button',{name:'Условия согласия',exact:true}).click()
      await expect(page.getByRole('dialog',{name:'Условия согласия'})).toBeVisible()
      await expect(page.getByText('Синтетические условия только для браузерного теста',{exact:true})).toHaveCount(1)
      await page.getByRole('button',{name:'Закрыть условия',exact:true}).click()
      await page.getByRole('checkbox').check()
      await page.getByRole('button',{name:'Открыть камеру',exact:true}).click()
      const take = await page.getByRole('button',{name:'Сделать снимок',exact:true}).boundingBox(), close = await page.getByRole('button',{name:'Закрыть камеру',exact:true}).boundingBox()
      expect(take && close && take.y+take.height <= close.y-8).toBeTruthy()
      await page.getByRole('button',{name:'Закрыть камеру',exact:true}).scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(folder,`camera-large-text-${width}.png`) })
      await page.getByRole('button',{name:'Закрыть камеру',exact:true}).click()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)
  }
})

test('handwritten ink fits the content bounds at every required width', async ({ page, isMobile }) => {
  test.setTimeout(120000)
  await prepare(page,cases.find(item => item.name === 'plans')!)
  for (const width of isMobile ? [320,360,390,430] : [320,360,390,430,1366,1920]) {
    await page.setViewportSize({width,height:900})
    for (const path of ['/plans','/chats','/create','/catalog']) {
      await launch(page,path)
      await page.evaluate(() => document.fonts.ready)
      const ink = await page.locator('.page-heading h1 em').evaluate(element => {
        const node = element.firstChild!, text = node.textContent!, style = getComputedStyle(element)
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const main = document.querySelector('main')!.getBoundingClientRect()
        return [...text.matchAll(/\S+/g)].map(match => {
          const range = document.createRange(); range.setStart(node,match.index!); range.setEnd(node,match.index!+match[0].length)
          const r = range.getBoundingClientRect(), m = ctx.measureText(match[0])
          return { word: match[0], left: r.left-m.actualBoundingBoxLeft, right: r.left+m.actualBoundingBoxRight, min: main.left, max: main.right }
        })
      })
      for (const word of ink) { expect(word.left,`${path} ${width} ${word.word}`).toBeGreaterThanOrEqual(word.min-1); expect(word.right,`${path} ${width} ${word.word}`).toBeLessThanOrEqual(word.max+1) }
    }
  }
})
