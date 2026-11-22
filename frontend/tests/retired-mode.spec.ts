import { expect, test } from '@playwright/test'
import { readFile, readdir } from 'node:fs/promises'

test('legacy mode flags and stored profiles cannot enable fictional data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('poidem:demo-mode:v1', 'true')
    const retired = JSON.stringify({ version: 1, profile: { name: 'Старая анкета' }, ownPlans: [{ id: 'old-plan' }], invites: [{ id: 'old-match', status: 'matched' }] })
    localStorage.setItem('poidem:simulation:v1', retired)
    localStorage.setItem('poidem:demo:v1', retired)
  })
  await page.goto('/profile?demo=true')
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Заполнить примером' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Твоё имя' })).toHaveValue('')
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('poidem:')))).toEqual(['poidem:demo:v1'])
  await page.goto('/catalog?demo=true')
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await page.goto('/match/old-match')
  await expect(page.getByRole('heading', { name: 'Для встречи нужны двое' })).toBeVisible()
  await expect(page.locator('.match-portraits')).toHaveCount(0)
  await page.goto('/plans')
  await expect(page.locator('.my-plan')).toHaveCount(0)
})

test('production bundle contains no fictional accounts, publications or consent simulation', async () => {
  const assets = new URL('../dist/assets/', import.meta.url)
  const files = (await readdir(assets)).filter(name => name.endsWith('.js'))
  expect(files.length).toBeGreaterThan(0)
  const bundle = (await Promise.all(files.map(name => readFile(new URL(name, assets), 'utf8')))).join('\n')
  for (const value of ['demo-gallery', 'demo-sasha', 'demo-lev', 'demo-anya', 'DEMO_PEOPLE', 'Демонстрационный режим', 'Заполнить примером', 'Имитировать принятие', 'Показать тестовый отклик']) {
    expect(bundle).not.toContain(value)
  }
})
