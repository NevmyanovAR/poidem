import type { Page } from '@playwright/test'

// Данные только для заполнения полей браузерной проверки, не runtime-анкета.
export async function fillProfileBasics(page: Page) {
  await page.getByRole('textbox', { name: 'Твоё имя' }).fill('Проверка формы')
  await page.getByRole('spinbutton', { name: 'Возраст' }).fill('24')
  await page.locator('select[name=gender]').selectOption('woman')
  await page.locator('select[name=preference]').selectOption('any')
}
