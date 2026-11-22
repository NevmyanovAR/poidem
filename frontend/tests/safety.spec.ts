import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ timezoneId: 'Europe/Moscow' })

async function planFields(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Название плана' }).fill(title)
  await page.getByRole('textbox', { name: 'Где встречаемся?' }).fill('Кафе')
  await page.locator('input[name=date]').fill(await page.evaluate(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)))
  await page.locator('input[name=time]').fill('18:30')
}

test('text filtering reports errors without deleting the title or description', async ({ page }) => {
  await page.goto('/create')
  await planFields(page, '  СТРИП-КЛУБ  ')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByText('В планах нельзя предлагать посещение стрип-клубов', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Название плана' })).toHaveValue('  СТРИП-КЛУБ  ')
  await page.getByRole('textbox', { name: 'Название плана' }).fill('Кофе и стрипсы')
  await page.locator('textarea[name=description]').fill('Пойдём в заброшенное здание')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.locator('textarea[name=description]')).toHaveValue('Пойдём в заброшенное здание')
  await expect(page.getByText('Выбери безопасное место вместо заброшенного здания или сооружения', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('poidem:simulation:v1'))).toBeNull()
  await page.locator('textarea[name=description]').fill('Кофе, клубника и разговор')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page).toHaveURL('/plans')
})

test('forged client Telegram data does not become verified authentication', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { Telegram: { WebApp: {
    initData: 'test-data-not-a-signature', initDataUnsafe: { user: { id: 123456 } }, platform: 'web',
    ready: () => {}, expand: () => {}, isVersionAtLeast: () => false, onEvent: () => {}, offEvent: () => {},
  } } }))
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  await page.goto('/profile')
  await expect(page.getByText('Сервер пока не подключён', { exact: true })).toBeVisible()
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
})
