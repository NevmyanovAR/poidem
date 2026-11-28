import { expect, test, type Page } from '@playwright/test'
import { scenario, author } from './connectionScenario'
import type { VerificationRequest } from '../src/api/verification'

const entry = (): VerificationRequest => ({ id: '00000000-0000-4000-8000-000000009001', state: 'pending', version: 1, created_at: new Date().toISOString(), submitted_at: null, expires_at: new Date(Date.now() + 86400000).toISOString(), reviewed_at: null, instruction: 'Покажи открытую ладонь рядом с лицом', reason_code: null, reason: null, consent_version: 'synthetic-consent-v1' })

async function setup(page: Page, options: { pending?: boolean; available?: boolean; approved?: boolean; admin?: boolean } = {}) {
  const base = scenario()
  await base.install(page, author)
  const state = { consentVersion: 'synthetic-consent-v1', available: options.available ?? true, approved: options.approved ?? false, request: options.pending || options.approved ? { ...entry(), submitted_at: new Date().toISOString(), state: options.approved ? 'approved' : 'pending', version: 2 } as VerificationRequest : null, uploads: 0, decisions: 0 }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value })
    if (path === '/api/v1/admin/session' && options.admin) return json({ role: 'moderator', permissions: ['moderation'] })
    if (path === '/api/v1/me/photo-verification') return json({ available: state.available, state: state.approved ? 'verified' : state.request?.submitted_at && state.request.state === 'pending' ? 'pending' : state.request?.state === 'rejected' ? 'rejected' : 'unverified', photo_verified: state.approved, consent_version: state.consentVersion, consent_text: 'Разрешённые синтетические данные только браузерного теста. Проверочный снимок удаляется по тестовой политике', retention: { pending_hours: 72, reviewed_hours: 0 }, request: state.request })
    if (path.endsWith('/photo-verification/challenge')) { state.request = state.request ?? entry(); return json(state.request) }
    if (path.endsWith('/selfie') && route.request().method() === 'POST') { state.uploads++; state.request = { ...state.request!, submitted_at: new Date().toISOString(), version: 2 }; return json(state.request) }
    if (path.endsWith('/withdraw')) { state.approved = false; state.request = { ...state.request!, state: 'cancelled', reason_code: 'consent_withdrawn', version: state.request!.version + 1 }; return json(state.request) }
    if (path === '/api/v1/admin/photo-verifications') return json({ items: state.request ? [{ ...state.request, user_name: 'Синтетический участник' }] : [], next_offset: null })
    if (path.endsWith('/decision') && path.includes('/photo-verifications/')) {
      const payload = route.request().postDataJSON(); state.decisions++
      state.approved = payload.decision === 'approved'
      state.request = { ...state.request!, state: payload.decision, reason: payload.reason_code === 'face_unclear' ? 'Лицо плохо видно' : payload.comment ?? null, version: state.request!.version + 1 }
      return json(state.request)
    }
    if (/\/admin\/photo-verifications\/[^/]+$/.test(path)) return json({ ...state.request, user_name: 'Синтетический участник', can_decide: state.request?.state === 'pending', primary_url: '/api/v1/admin/photo-verifications/test/photo/primary', selfie_url: '/api/v1/admin/photo-verifications/test/photo/selfie' })
    if (path.includes('/photo-verifications/') && path.includes('/photo/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#550707"/><circle cx="150" cy="140" r="60" fill="#B8E4FF"/></svg>' })
    return route.fallback()
  })
  return state
}

async function launch(page: Page, path = '/settings/photo-verification') {
  await page.goto(`${path}#tgWebAppData=synthetic-browser-contract`, { waitUntil: 'domcontentloaded' })
}

test('voluntary photo verification handles unavailable collection and camera denial without gallery fallback', async ({ page }) => {
  const state = await setup(page, { available: false })
  await launch(page, '/settings')
  await page.getByRole('link', { name: /Подтвердить фото/ }).click()
  await expect(page.getByText('Подтверждение фото пока недоступно')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть камеру' })).toHaveCount(0)
  state.available = true
  await launch(page)
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError') } } }) })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('checkbox')).toBeVisible()
  await expect(page.locator('.verification-retention')).toHaveCount(0)
  await page.getByRole('button', { name: 'Условия согласия', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Условия согласия' })).toBeVisible()
  await expect(page.locator('.verification-retention')).toContainText('до 72 ч')
  await expect(page.locator('.verification-retention')).toContainText('После решения снимки становятся недоступны')
  await page.getByRole('button', { name: 'Закрыть условия', exact: true }).click()
  await expect(page.locator('.verification-consent')).toHaveCount(0)
  await page.getByRole('checkbox').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('verification-consent.png') })
  await page.getByRole('checkbox').check()
  state.consentVersion = 'synthetic-consent-v2'
  await page.evaluate(() => window.dispatchEvent(new Event('poidem:foreground-refresh')))
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Открыть камеру' }).click()
  await expect(page.getByRole('alert')).toContainText('Доступ к камере запрещён')
  await expect(page.locator('.verification-page input[type=file]')).toHaveCount(0)
  expect(state.uploads).toBe(0)
})

test('camera capture can be reviewed, retaken and submitted once without persistent storage', async ({ page, isMobile }) => {
  test.setTimeout(180000)
  await page.addInitScript(() => {
    const state = { stops: 0 }; Object.assign(window, { verificationCameraTest: state })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 640
      const context = canvas.getContext('2d')!; let alive = true
      const draw = () => { if (!alive) return; context.fillStyle = '#550707'; context.fillRect(0, 0, 480, 640); context.fillStyle = '#B8E4FF'; context.fillRect(180, 150, 120, 160); requestAnimationFrame(draw) }; draw()
      if (typeof canvas.captureStream !== 'function') {
        // WebKit port lacks canvas.captureStream: UI-only synthetic video metadata/frame.
        // This branch does NOT verify media playback or physical getUserMedia.
        const stream = { getTracks: () => [{ stop: () => { alive = false; state.stops++ } }] }
        const streams = new WeakMap<HTMLMediaElement, unknown>()
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return streams.get(this) ?? null }, set(value) { streams.set(this, value) } })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 480 })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 640 })
        HTMLMediaElement.prototype.play = async function () {}
        const original = CanvasRenderingContext2D.prototype.drawImage
        CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
          if (image instanceof HTMLVideoElement) { this.fillStyle = '#550707'; this.fillRect(0, 0, this.canvas.width, this.canvas.height); this.fillStyle = '#B8E4FF'; this.fillRect(180, 150, 120, 160); return }
          original.apply(this, [image, ...args] as Parameters<typeof original>)
        }
        return stream
      }
      const stream = canvas.captureStream(10)
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { alive = false; state.stops++; stop() } })
      return stream
    } } })
  })
  const state = await setup(page)
  await launch(page)
  await expect(page.getByRole('button', { name: 'Открыть камеру' })).toBeDisabled()
  await page.screenshot({ path: test.info().outputPath('verification-compact.png') })
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Открыть камеру' }).click()
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  await expect(page.getByText('Сделай селфи по инструкции. Модератор сравнит его с фото анкеты', { exact: true })).toHaveCount(0)
  const capture = await page.getByRole('button', { name: 'Сделать снимок' }).boundingBox()
  const close = await page.getByRole('button', { name: 'Закрыть камеру', exact: true }).boundingBox()
  expect(capture && close && capture.y + capture.height <= close.y - 8).toBeTruthy()
  for (const width of isMobile ? [320, 360, 390, 430] : [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    const primary = await page.getByRole('button', { name: 'Сделать снимок' }).boundingBox()
    const secondary = await page.getByRole('button', { name: 'Закрыть камеру', exact: true }).boundingBox()
    expect(primary && secondary && primary.y + primary.height <= secondary.y - 8).toBeTruthy()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    if (width === 390 || width === 1366) await page.screenshot({ path: test.info().outputPath(`verification-camera-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 320, height: 720 })
  const fontStyle = await page.addStyleTag({ content: '.verification-page { font-size: 2em } .verification-camera-actions .button { font-size: 1em }' })
  const enlarged = await page.getByRole('button', { name: 'Сделать снимок' }).boundingBox()
  const closeLarge = await page.getByRole('button', { name: 'Закрыть камеру', exact: true }).boundingBox()
  expect(enlarged && closeLarge && enlarged.y + enlarged.height <= closeLarge.y - 8).toBeTruthy()
  await page.screenshot({ path: test.info().outputPath('verification-camera-large-font.png'), fullPage: true })
  await fontStyle.evaluate(element => element.remove())
  await page.getByRole('button', { name: 'Закрыть камеру', exact: true }).click()
  await expect(page.locator('video')).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть камеру' }).click()
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Сделать снимок' }).click()
  await expect(page.getByAltText('Проверочное селфи перед отправкой')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('verification-selfie-preview.png') })
  await page.getByRole('button', { name: 'Переснять', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Сделать снимок' }).click()
  await page.getByRole('button', { name: 'Отправить на проверку' }).click()
  await expect(page.getByText('Фото на проверке', { exact: true })).toBeVisible()
  expect(state.uploads).toBe(1)
  expect(await page.evaluate(() => (window as unknown as { verificationCameraTest: { stops: number } }).verificationCameraTest.stops)).toBeGreaterThanOrEqual(2)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('synthetic-consent')
})

test('moderator compares private snapshots with zoom and records rejection before retry or approval', async ({ page }) => {
  const state = await setup(page, { pending: true, admin: true })
  await launch(page, '/admin?section=moderation&tab=photos')
  await page.getByRole('button', { name: 'Открыть заявку' }).click()
  await expect(page.locator('.verification-compare img')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Открыть фотографию Проверочное селфи' })).toBeEnabled()
  await page.getByRole('button', { name: 'Открыть фотографию Проверочное селфи' }).click()
  await expect(page.getByRole('dialog', { name: 'Фотография: Проверочное селфи' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: 'Причина отказа' }).selectOption('face_unclear')
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Отклонить заявку', exact: true }).click()
  await expect.poll(() => state.decisions).toBe(1)
  await launch(page)
  await expect(page.getByText('Заявка отклонена', { exact: true })).toBeVisible()
  await expect(page.getByText('Лицо плохо видно')).toBeVisible()
  state.request = { ...entry(), submitted_at: new Date().toISOString(), version: 2 }
  await launch(page, '/admin?section=moderation&tab=photos')
  await page.getByRole('button', { name: 'Открыть заявку' }).click()
  await page.getByRole('button', { name: 'Подтвердить фото', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить фото', exact: true }).click()
  await expect.poll(() => state.decisions).toBe(2)
  await launch(page)
  await expect(page.getByRole('button', { name: 'Фото подтверждено', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('verification-approved.png') })
  await page.getByRole('button', { name: 'Фото подтверждено', exact: true }).click()
  await expect(page.getByText(/Это не проверка личности по документам/)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть пояснение' }).click()
  await page.getByRole('button', { name: 'Отозвать согласие и удалить снимки' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Отозвать согласие', exact: true }).click()
  await expect(page.getByText('Не подтверждено', { exact: true })).toBeVisible()
  expect(state.approved).toBe(false)
})

test('photo verification user and moderator layouts fit narrow and desktop screens', async ({ page }) => {
  test.setTimeout(180000)
  await setup(page, { pending: true, admin: true })
  for (const width of [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await launch(page)
    await expect(page.getByText('Фото на проверке', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath(`verification-user-${width}.png`), fullPage: true })
    await launch(page, '/admin?section=moderation&tab=photos')
    await page.getByRole('button', { name: 'Открыть заявку' }).click()
    await expect(page.locator('.verification-compare img')).toHaveCount(2)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath(`verification-admin-${width}.png`), fullPage: true })
  }
})
