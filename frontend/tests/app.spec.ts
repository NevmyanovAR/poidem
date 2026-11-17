import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

test('welcome, age gate, exactly three interests and profile persistence', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Всё начинается/ })).toBeVisible()
  await page.getByRole('link', { name: 'Начать знакомство' }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByText('Укажи имя: от 1 до 40 символов.')).toBeVisible()
  await page.getByRole('button', { name: 'Заполнить примером' }).click()
  await page.getByRole('spinbutton', { name: 'Возраст' }).fill('17')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByText('Знакомиться здесь можно только с 18 лет.')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Возраст' }).fill('24')
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: 'Кофе', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить анкету' }).click()
  await expect(page.getByText('Выбери ровно три интереса.')).toBeVisible()
  await page.getByRole('button', { name: 'Кофе', exact: true }).click()
  await page.getByRole('button', { name: 'Кино', exact: true }).click()
  await expect(page.getByText('Уже выбрано три.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить анкету' }).click()
  await expect(page).toHaveURL('/home')
  await page.reload()
  await expect(page.getByText('Маша, какой у тебя план?')).toBeVisible()
})

test('photo upload validation and actual image preview', async ({ page }) => {
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить примером' }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'fake.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  await expect(page.getByText('Подойдёт JPG, PNG или WebP.')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../public/images/portrait-sasha.jpeg', import.meta.url)))
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveAttribute('src', /^data:image\/jpeg/)
  await page.getByRole('button', { name: 'Сохранить анкету' }).click()
  await page.reload()
  await page.getByRole('link', { name: 'Моя анкета' }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Предпросмотр твоей фотографии' })).toHaveAttribute('src', /^data:image\/jpeg/)
})

test('catalog filter, one-sided invitation, explicit mutual simulation and protected match URL', async ({ page }) => {
  await page.goto('/match/unknown')
  await expect(page.getByRole('heading', { name: 'Для встречи нужны двое' })).toBeVisible()
  await page.goto('/catalog')
  await page.getByRole('button', { name: 'Прогулки', exact: true }).click()
  await expect(page.locator('.plan-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Все планы', exact: true }).click()
  await page.getByRole('link', { name: 'Выбрать план «Выставка, потом кофе»' }).click()
  await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
  await expect(page).toHaveURL('/people/demo-gallery')
  await expect(page.getByText('Нужен ответ второго человека.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Посмотреть совпадение' }).click()
  await expect(page.getByRole('heading', { name: /Кажется, вам/ })).toBeVisible()
  await expect(page.locator('.match-page')).toBeVisible()
  await page.getByRole('button', { name: 'Перейти к общению' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Общение пока недоступно' })).toBeVisible()
  await page.getByRole('button', { name: 'Понятно', exact: true }).click()
  await page.getByRole('link', { name: 'К моим планам', exact: true }).click()
  await page.getByRole('button', { name: 'Мэтчи', exact: true }).click()
  await expect(page.locator('.my-plan')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.my-plan')).toHaveCount(1)
})

test('skipping all people shows empty state and can restart', async ({ page }) => {
  await page.goto('/people/demo-gallery')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Следующий', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'На сегодня это все' })).toBeVisible()
  await page.getByRole('button', { name: 'Посмотреть анкеты заново' }).click()
  await expect(page.getByRole('button', { name: 'Пойдём?', exact: true })).toBeVisible()
  const invites = await page.evaluate(() => JSON.parse(localStorage.getItem('poidem:demo:v1') ?? '{"invites":[]}').invites)
  expect(invites).toHaveLength(0)
})

test('inspiration prefills a plan, rejects missing and past dates, saves and survives reload', async ({ page }) => {
  await page.goto('/plans')
  await expect(page.getByRole('heading', { name: 'Здесь будет ваша история' })).toBeVisible()
  await page.goto('/inspiration')
  await page.getByRole('link', { name: 'Создать план здесь' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Название плана' })).toHaveValue('Арт-свидание вдвоём')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByText('Выбери дату.', { exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page).toHaveURL('/plans')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Арт-свидание вдвоём', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Посмотреть статус', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Твой план ждёт свою историю' })).toBeVisible()
})

test('navigation, all image assets, mobile and desktop layout', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
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

test('corrupted local data recovers, reset clears demo profile', async ({ page }) => {
  await page.goto('/home')
  await page.evaluate(() => localStorage.setItem('poidem:demo:v1', '{broken'))
  await page.reload()
  await expect(page.getByRole('heading', { name: /Куда/ })).toBeVisible()
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Заполнить примером' }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить анкету' }).click()
  await page.getByRole('button', { name: 'Очистить данные', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Очистить', exact: true }).click()
  await page.reload()
  await expect(page.getByText('Привет. Давай придумаем что-нибудь хорошее.')).toBeVisible()
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
  await expect(page.locator('.plan-card')).toHaveCount(6)
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
