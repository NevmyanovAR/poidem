import { fillProfileBasics } from './helpers/profile'
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

test('registration validates adult age and interests without offering a fake account', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Начать знакомство' }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByText('Укажи имя: от 1 до 40 символов')).toBeVisible()
  await fillProfileBasics(page)
  await page.getByRole('spinbutton', { name: 'Возраст' }).fill('17')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByText('Знакомиться здесь можно только с 18 лет')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Возраст' }).fill('24')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  for (const interest of ['Искусство', 'Кофе', 'Прогулки']) await page.getByRole('button', { name: interest, exact: true }).click()
  await page.getByRole('button', { name: 'Кино', exact: true }).click()
  await expect(page.getByText('Уже выбрано три.', { exact: false })).toBeVisible()
  await expect(page.locator('button.chip.selected')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Сохранить анкету' })).toBeDisabled()
  await expect(page.getByText('Для сохранения анкеты нужен вход через Telegram')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('')
})

test('photo upload validation and actual image preview', async ({ page }) => {
  await page.goto('/profile')
  await fillProfileBasics(page)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'fake.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  await expect(page.getByText('Подойдёт JPG, PNG или WebP')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../public/images/portrait-sasha.jpeg', import.meta.url)))
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(page.getByRole('button', { name: 'Сохранить анкету' })).toBeDisabled()
  await page.reload()
  await fillProfileBasics(page)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveCount(0)
})

test('catalog only lists publications and never substitutes editorial fixtures', async ({ page }) => {
  await page.goto('/catalog')
  await expect(page.getByRole('heading', { name: 'Войди, чтобы увидеть планы' })).toBeVisible()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Прогулки', exact: true }).click()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Прогулки', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.empty-state').getByRole('link', { name: 'Моя анкета', exact: true }).click()
  await expect(page).toHaveURL('/profile')
})

test('old fixture deep links and stored invitations do not expose fictional users or matches', async ({ page }) => {
  await page.goto('/home')
  await page.evaluate(() => localStorage.setItem('poidem:demo:v1', JSON.stringify({
    version: 1, profile: null, ownPlans: [], selectedIds: ['demo-gallery'],
    invites: [{ id: 'old-match', planId: 'demo-gallery', personId: 'demo-sasha', status: 'matched' }],
  })))
  await page.goto('/people/demo-gallery')
  await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть план' })).toBeVisible()
  await expect(page.locator('.person-layout')).toHaveCount(0)
  await page.goto('/match/old-match')
  await expect(page.getByRole('heading', { name: 'Для встречи нужны двое' })).toBeVisible()
  await expect(page.locator('.match-portraits')).toHaveCount(0)
  await page.goto('/plans')
  await expect(page.locator('.my-plan')).toHaveCount(0)
  // Старый обычный профиль не импортируется; его очистка — явное действие.
  expect(await page.evaluate(() => localStorage.getItem('poidem:demo:v1'))).not.toBeNull()
})

test('inspiration prefills a plan and validates dates without saving outside authentication', async ({ page }) => {
  await page.goto('/plans')
  await expect(page.getByRole('heading', { name: 'Войди, чтобы увидеть свои планы' })).toBeVisible()
  await page.goto('/inspiration')
  await page.getByRole('link', { name: 'Создать план здесь' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Название плана' })).toHaveValue('Арт-свидание вдвоём')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByText('Выбери дату', { exact: true })).toBeVisible()
  await page.locator('input[name=date]').fill('2020-01-01')
  await page.locator('input[name=time]').fill('18:30')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByText('Встреча должна быть в будущем.', { exact: false })).toBeVisible()
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  await page.locator('input[name=date]').fill(tomorrow)
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Так будет выглядеть твой план' })).toBeVisible()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await expect(page.locator('input[name=date]')).toHaveValue(tomorrow)
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeDisabled()
  await page.reload()
  await page.goto('/plans')
  await expect(page.getByRole('heading', { name: 'Войди, чтобы увидеть свои планы' })).toBeVisible()
})

test('navigation, all image assets, mobile and desktop layout', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.includes('kaspersky-labs.com')) errors.push(message.text()) })
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/home', '/catalog', '/profile', '/create', '/plans', '/inspiration', '/people/demo-gallery']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('h1, .empty-state h2').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      expect(overflow, `${route} overflows at ${width}px`).toBe(false)
      for (const image of await page.locator('img').all()) {
        if (!await image.isVisible()) continue
        await image.scrollIntoViewIfNeeded()
        await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
        await expect(image).not.toHaveAttribute('data-fallback', 'true')
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation', { name: 'Мобильная навигация' }).getByRole('link', { name: 'Мои планы' }).click()
  await expect(page).toHaveURL('/plans')
  expect(errors).toEqual([])
})

test('legacy corrupt data is ignored and explicit reset preserves the server-account boundary', async ({ page }) => {
  await page.goto('/home')
  await page.evaluate(() => localStorage.setItem('poidem:demo:v1', '{broken'))
  await page.reload()
  await expect(page.getByRole('heading', { name: /Куда/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('poidem:demo:v1'))).toBe('{broken')
  await page.getByRole('button', { name: 'Очистить данные', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Серверные анкета и планы сохранятся')
  await page.getByRole('dialog').getByRole('button', { name: 'Очистить', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('poidem:demo:v1'))).toBeNull()
  await expect(page.getByText('Данные на устройстве очищены. Серверные анкета и планы сохранены', { exact: true })).toBeVisible()
})

test('Telegram bridge adapts safe area, viewport and native back button without authentication', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { calls: [] as string[], events: {} as Record<string, (() => void)[]>, back: null as (() => void) | null }
    Object.assign(window, { __tgTest: state, Telegram: { WebApp: {
      platform: 'android', initData: '', viewportStableHeight: 844,
      safeAreaInset: { top: 20, bottom: 16, left: 0, right: 0 },
      contentSafeAreaInset: { top: 12, bottom: 0, left: 0, right: 0 },
      ready: () => state.calls.push('ready'), expand: () => state.calls.push('expand'),
      isVersionAtLeast: () => true,
      setHeaderColor: () => state.calls.push('header'), setBackgroundColor: () => state.calls.push('background'), setBottomBarColor: () => state.calls.push('bottom'),
      onEvent: (event: string, fn: () => void) => { state.events[event] = [...(state.events[event] ?? []), fn] },
      offEvent: (event: string, fn: () => void) => { state.events[event] = (state.events[event] ?? []).filter(f => f !== fn) },
      BackButton: { show: () => state.calls.push('showBack'), hide: () => state.calls.push('hideBack'), onClick: (fn: () => void) => { state.back = fn }, offClick: () => { state.back = null } },
    } } })
  })
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  await page.goto('/catalog')
  const values = await page.evaluate(() => {
    const state = (window as unknown as { __tgTest: { calls: string[] } }).__tgTest
    return { calls: state.calls, top: getComputedStyle(document.documentElement).getPropertyValue('--app-safe-top'), height: getComputedStyle(document.documentElement).getPropertyValue('--app-height') }
  })
  expect(values.calls).toContain('ready')
  expect(values.calls).toContain('expand')
  expect(values.calls).toContain('showBack')
  expect(values.top).toBe('32px')
  expect(values.height).toBe('844px')
  await page.evaluate(() => (window as unknown as { __tgTest: { back: () => void } }).__tgTest.back())
  await expect(page).toHaveURL('/home')
})

test('ordinary browser works when the Telegram SDK is unavailable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  await page.goto('/home', { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Найти свой план', exact: true }).click()
  await expect(page).toHaveURL('/catalog')
  await expect(page.locator('.plan-card')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a late Telegram SDK initializes after the interface is already visible', async ({ page }) => {
  let releaseSdk: () => void = () => undefined
  const gate = new Promise<void>(resolve => { releaseSdk = resolve })
  await page.route('https://telegram.org/js/telegram-web-app.js', async route => {
    await gate
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: `
      window.__lateCalls = [];
      window.Telegram = { WebApp: {
        platform: 'android', viewportStableHeight: 777,
        ready: () => window.__lateCalls.push('ready'), expand: () => {},
        isVersionAtLeast: () => false, onEvent: () => {}, offEvent: () => {}
      }};
    ` })
  })
  await page.goto('/home', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { name: 'Найти свой план', exact: true })).toBeVisible()
  releaseSdk()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height'))).toBe('777px')
  expect(await page.evaluate(() => (window as unknown as { __lateCalls: string[] }).__lateCalls)).toContain('ready')
})

test('compact home, editorial navigation, punctuation and mobile safe areas', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/home')
    await expect(page.locator('main .hero-copy')).toHaveCount(1)
    await expect(page.locator('main .plan-card, main .inspiration-card, main .hero-image, main .manifesto, main .home-shortcuts')).toHaveCount(0)
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--app-safe-top', '59px')
      document.documentElement.style.setProperty('--app-safe-bottom', '34px')
      document.documentElement.style.setProperty('--app-safe-left', '24px')
      document.documentElement.style.setProperty('--app-safe-right', '28px')
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: test.info().outputPath(`home-safe-${viewport.width}x${viewport.height}.png`), fullPage: true })
    const nav = page.getByRole('navigation', { name: 'Мобильная навигация' })
    const plus = nav.getByRole('link', { name: 'Создать свой план' })
    const navBox = (await nav.boundingBox())!
    const plusBox = (await plus.boundingBox())!
    const otherBox = (await nav.getByRole('link', { name: 'Главная', exact: true }).boundingBox())!
    expect(plusBox.y).toBeLessThan(otherBox.y)
    expect(plusBox.y + plusBox.height).toBeLessThanOrEqual(navBox.y + navBox.height - 34)
    expect(plusBox.x + plusBox.width).toBeLessThanOrEqual(viewport.width - 28)
    expect((await page.locator('.header-inner').boundingBox())!.y).toBeGreaterThanOrEqual(59)
    await plus.click()
    await expect(page).toHaveURL('/create')
    const submit = page.getByRole('button', { name: 'Посмотреть план', exact: true })
    await submit.scrollIntoViewIfNeeded()
    const submitBox = (await submit.boundingBox())!
    expect(submitBox.y + submitBox.height).toBeLessThanOrEqual((await nav.boundingBox())!.y)
    await nav.getByRole('link', { name: 'Вдохновение', exact: true }).click()
    await expect(page.locator('.inspiration-card')).toHaveCount(3)
    await expect(page.getByRole('link', { name: 'Все планы', exact: true })).toHaveCount(0)
    await expect(page.locator('.inspiration-photo .photo-arrow').first()).toHaveCSS('color', 'rgb(184, 228, 255)')
    await page.getByRole('link', { name: /^Создать план:/ }).first().click()
    await expect(page).toHaveURL('/create?idea=art-evening')
    await page.goto('/profile')
    await expect(page.getByText('Без лишнего', { exact: false })).toHaveCount(0)
  }
  for (const route of ['/', '/home', '/profile', '/catalog', '/create', '/plans', '/inspiration', '/people/missing', '/match/missing']) {
    await page.goto(route)
    const trailing = await page.locator('h1, h2, h3, p, .eyebrow, .hero-footnote, .heading-description, .form-disclaimer, .small-note').evaluateAll(elements =>
      elements.map(el => el.textContent?.trim()).filter(text => text && /[А-Яа-яЁё].*\.$/s.test(text)))
    expect(trailing, route).toEqual([])
  }
})
