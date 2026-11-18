import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ timezoneId: 'Europe/Moscow' })

async function demoProfile(page: Page) {
  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Демонстрационный режим' }).click()
  await page.getByRole('button', { name: 'Заполнить примером', exact: true }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить анкету', exact: true }).click()
}

async function planFields(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Название плана' }).fill(title)
  await page.getByRole('textbox', { name: 'Где встречаемся?' }).fill('Кафе')
  await page.locator('input[name=date]').fill(await page.evaluate(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)))
  await page.locator('input[name=time]').fill('18:30')
}

test('fifteenth response is allowed, sixteenth is blocked even if the button is re-enabled', async ({ page }) => {
  await demoProfile(page)
  await page.goto('/people/demo-walk')
  await expect(page.locator('.response-limit')).toContainText('Отклики: 14 из 15')
  await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
  await expect(page.locator('.response-limit')).toContainText('Отклики: 15 из 15')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Пойдём?', exact: true })).toHaveCount(0)
  const one = await page.evaluate(() => JSON.parse(localStorage.getItem('poidem:simulation:v1')!).invites)
  expect(one).toHaveLength(1)
  await page.goto('/people/demo-coffee')
  await expect(page.locator('.response-limit')).toContainText('Лимит откликов достигнут')
  const response = page.getByRole('button', { name: 'Пойдём?', exact: true })
  await expect(response).toBeDisabled()
  await response.evaluate(button => { (button as HTMLButtonElement).disabled = false })
  await response.click()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('poidem:simulation:v1')!).invites)
  expect(after).toHaveLength(1)
  expect(after.some((entry: { planId: string }) => entry.planId === 'demo-coffee')).toBe(false)
  await page.goto('/home')
  await expect(page.getByRole('link', { name: 'Найти свой план', exact: true })).toBeVisible()
})

test('fourth daily creation is blocked and local-calendar quota resets on the next day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T09:00:00+03:00') })
  await demoProfile(page)
  for (let index = 1; index <= 3; index++) {
    await page.goto('/create')
    await expect(page.locator('.plan-limit')).toContainText(String(4 - index) + ' из 3')
    await planFields(page, 'Кофе ' + index)
    await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
    await page.getByRole('button', { name: 'Опубликовать план', exact: true }).click()
    await expect(page).toHaveURL('/plans')
  }
  await page.goto('/create')
  await expect(page.locator('.plan-limit')).toContainText('0 из 3')
  await planFields(page, 'Четвёртый план')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  const publish = page.getByRole('button', { name: 'Опубликовать план', exact: true })
  await expect(publish).toBeDisabled()
  await publish.evaluate(button => { (button as HTMLButtonElement).disabled = false })
  await publish.click()
  await expect(page).toHaveURL('/create')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('poidem:simulation:v1')!).ownPlans)).toHaveLength(3)
  await page.reload()
  await expect(page.locator('.plan-limit')).toContainText('0 из 3')
  await page.clock.fastForward(24 * 60 * 60 * 1000)
  await expect(page.locator('.plan-limit')).toContainText('3 из 3')
  await planFields(page, 'Новый день')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Опубликовать план', exact: true })).toBeEnabled()
})

test('text filtering reports errors without deleting the title or description', async ({ page }) => {
  await demoProfile(page)
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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('poidem:simulation:v1')!).ownPlans)).toHaveLength(0)
  await page.locator('textarea[name=description]').fill('Кофе, клубника и разговор')
  await page.getByRole('button', { name: 'Посмотреть план', exact: true }).click()
  await page.getByRole('button', { name: 'Опубликовать план', exact: true }).click()
  await expect(page).toHaveURL('/plans')
})

test('forged client Telegram data does not become verified authentication', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { Telegram: { WebApp: {
    initData: 'test-data-not-a-signature', initDataUnsafe: { user: { id: 123456 } }, platform: 'web',
    ready: () => {}, expand: () => {}, isVersionAtLeast: () => false, onEvent: () => {}, offEvent: () => {},
  } } }))
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, body: '' }))
  await page.goto('/profile')
  await expect(page.getByText('Telegram-авторизация пока не подтверждена', { exact: true })).toBeVisible()
  await expect(page.getByText('Данные Telegram подтверждены сервером', { exact: true })).toHaveCount(0)
})

test('future moderation statuses are displayed without inventing the two stages', async ({ page }) => {
  await demoProfile(page)
  for (const status of ['pending', 'rejected']) {
    await page.evaluate(value => {
      const state = JSON.parse(localStorage.getItem('poidem:simulation:v1')!)
      state.ownPlans = [{ id: 'local-review', title: 'На выставку', category: 'Искусство', date: '2099-01-01', time: '12:00', place: 'Галерея', description: '', image: '/images/gallery.jpeg', label: 'Черновик', own: true, moderation: { status: value, source: 'demo' } }]
      localStorage.setItem('poidem:simulation:v1', JSON.stringify(state))
    }, status)
    await page.goto('/people/local-review')
    await expect(page.locator('.moderation-status')).toContainText(status === 'pending' ? 'На проверке' : 'Отклонён')
    await expect(page.getByRole('button', { name: 'Опубликовать в деморежиме' })).toBeDisabled()
  }
})

test('fictional reliability is labelled and does not change after an ordinary response or refusal', async ({ page }) => {
  await demoProfile(page)
  await page.goto('/people/demo-gallery')
  const reliability = page.getByRole('region', { name: 'Демонстрационная надёжность' })
  const before = await reliability.innerText()
  expect(before).toContain('Надёжность:')
  expect(before).not.toContain('тестовые данные')
  await page.getByRole('button', { name: 'Пойдём?', exact: true }).click()
  await expect(reliability).toHaveText(before, { useInnerText: true })
  await page.getByRole('button', { name: 'Имитировать отказ автора' }).click()
  await expect(reliability).toHaveText(before, { useInnerText: true })
})
