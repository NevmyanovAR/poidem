import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ timezoneId: 'Europe/Moscow' })

async function planFields(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Название плана' }).fill(title)
  await page.getByRole('textbox', { name: 'Название места', exact: true }).fill('Кафе')
  await page.getByRole('textbox', { name: 'Адрес', exact: true }).fill('Тестовый город, улица 1')
  await page.locator('input[name=date]').fill(await page.evaluate(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)))
  await page.locator('input[name=time]').fill('18:30')
}

test('text filtering reports errors without deleting the title or description', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  await page.goto('/create')
  await planFields(page, '  СТРИП-КЛУБ  ')
  await expect(page.getByRole('button', { name: 'Посмотреть план', exact: true })).toBeDisabled()
  await expect(page.getByText('В планах нельзя предлагать стриптиз и посещение стрип-клубов', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Название плана' })).toHaveValue('  СТРИП-КЛУБ  ')
  await page.getByRole('textbox', { name: 'Название плана' }).fill('Кофе и стрипсы')
  await page.locator('textarea[name=description]').fill('Пойдём в заброшенное здание')
  await expect(page.getByRole('button', { name: 'Посмотреть план', exact: true })).toBeDisabled()
  await expect(page.locator('textarea[name=description]')).toHaveValue('Пойдём в заброшенное здание')
  await expect(page.getByText('Выбери безопасное место вместо заброшенного здания или сооружения', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('poidem:simulation:v1'))).toBeNull()
  await page.locator('textarea[name=description]').fill('Кофе, клубника и разговор')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeDisabled()
})

test('all editable plan fields reject forbidden words immediately, recover on correction and send no plan requests', async ({ page }) => {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
  const writes: string[] = []
  page.on('request', request => {
    if (request.url().includes('/api/v1/plans') && request.method() !== 'GET') writes.push(request.method())
  })
  await page.goto('/create', { waitUntil: 'domcontentloaded' })
  for (const field of ['title', 'description', 'placeName', 'placeAddress']) {
    const input = page.locator(`form [name=${field}]`)
    for (const word of ['хуй', 'стриптиз', 'наркотики', 'бордель', 'закрытая крыша', 'аварийное здание', 'бл*дь']) {
      await input.fill(word)
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await expect(page.locator(field.startsWith('place') ? '#error-place' : `#error-${field}`)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Посмотреть план', exact: true })).toBeDisabled()
      await expect(input).toHaveValue(word)
      await input.fill('Кофе и прогулка')
      await expect(page.locator(field.startsWith('place') ? '#error-place' : `#error-${field}`)).toHaveCount(0)
      await expect(input).toHaveAttribute('aria-invalid', 'false')
    }
    await input.fill('')
  }
  const title = page.locator('[name=title]')
  await title.fill('ху')
  await expect(title).toHaveAttribute('aria-invalid', 'false')
  await title.pressSequentially('й')
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await title.fill('Кофе')
  await page.locator('textarea[name=description]').fill('Лекция о вреде наркотиков')
  await expect(page.locator('[role=alert]')).toHaveCount(0)
  expect(writes).toEqual([])
})

test('forged client Telegram data does not become verified authentication', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { Telegram: { WebApp: {
    initData: 'test-data-not-a-signature', initDataUnsafe: { user: { id: 123456 } }, platform: 'web',
    ready: () => {}, expand: () => {}, isVersionAtLeast: () => false, onEvent: () => {}, offEvent: () => {},
  } } }))
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  await page.goto('/profile')
  await expect(page.locator('.trust-status').filter({ hasText: /Сервер пока не подключён|Недопустимый источник запроса|Не удалось подтвердить вход через Telegram/ })).toBeVisible()
  await expect(page.getByText('Вход через Telegram', { exact: true })).toHaveCount(0)
})
