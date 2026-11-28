import { expect, test, type Page } from '@playwright/test'
import { scenario, author } from './connectionScenario'
import type { CataloguePlace } from '../src/api/places'

async function setup(page: Page) {
  await scenario().install(page, author)
  const state = { place: null as CataloguePlace | null, plan: false, published: false, decisions: 0, imports: 0 }
  const checked = () => ({ provider: 'local', provider_place_id: state.place!.id, name: state.place!.name, address: `${state.place!.city}, ${state.place!.address}`, city: state.place!.city, latitude: null, longitude: null, category: state.place!.category, category_label: 'Музей', status: state.place!.status, catalogue_version: state.place!.version, checked_at: new Date().toISOString(), policy_version: 'local-catalog-v1' })
  const plan = () => ({ id: '00000000-0000-4000-8000-000000008001', author: { id: author, name: 'Синтетический автор' }, title: 'План с предложенным местом', category_code: 'art', starts_at: '2099-01-01T14:00:00Z', time_zone: 'Europe/Moscow', place: `${checked().name} · ${checked().address}`, venue: checked(), selected_place_id: '00000000-0000-4000-8000-000000007001', place_status: state.place!.status === 'approved' ? 'catalogue' : 'pending', description: '', publication_status: state.published ? 'published' : 'draft', moderation_status: 'not_submitted', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, image: '/images/gallery.jpeg', own: true, allowed_actions: state.place!.status === 'approved' ? ['edit', 'cancel', 'publish'] : ['edit', 'cancel'] })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    const json = (value: unknown) => route.fulfill({ json: value })
    if (path === '/api/v1/admin/place-checks') return json({ items: [], total: 0, next_offset: null })
    if (path === '/api/v1/admin/session') return json({ role: 'moderator', permissions: ['moderation'] })
    if (path === '/api/v1/places/search') return json({ items: state.place?.status === 'approved' ? [checked()] : [], attribution: '' })
    if (path === '/api/v1/places/proposals') {
      state.place = { ...route.request().postDataJSON(), id: '00000000-0000-4000-8000-000000006001', status: 'pending', version: 1, category_label: 'Музей', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_at: null, reason: null }
      return json({ selection_id: '00000000-0000-4000-8000-000000007001', place: checked() })
    }
    if (path.endsWith('/publish') && method === 'POST') { state.published = true; return json({ plan: plan() }) }
    if (path === '/api/v1/plans' && method === 'POST') { state.plan = true; return json({ plan: plan() }) }
    if (state.plan && path === '/api/v1/me/plans') return json({ items: [plan()], next_cursor: null })
    if (state.plan && path === '/api/v1/me/activity') return json({ items: [{ key: `plan:${plan().id}`, kind: 'plan', plan_id: plan().id, archived: false, hidden: false, plan: plan() }], next_cursor: null })
    if (path === '/api/v1/admin/places/import') { state.imports++; return json({ created: 1, skipped: 0 }) }
    if (path === '/api/v1/admin/places') {
      const filter = new URL(route.request().url()).searchParams.get('state')
      const rows = state.place && (!filter || state.place.status === filter) ? [state.place] : []
      return json({ items: rows, total: rows.length, next_offset: null })
    }
    if (path.startsWith('/api/v1/admin/places/') && state.place) {
      if (path.endsWith('/decision')) { const body = route.request().postDataJSON(); state.decisions++; state.place.status = body.action === 'approve' ? 'approved' : body.action === 'hide' ? 'hidden' : 'rejected'; state.place.version++; return json(state.place) }
      if (method === 'PUT') { Object.assign(state.place, route.request().postDataJSON()); state.place.version++; return json(state.place) }
      return json({ ...state.place, possible_duplicates: [] })
    }
    await route.fallback()
  })
  return state
}

async function launch(page: Page, path: string) { await page.goto(`${path}#tgWebAppData=synthetic-local-places&tgWebAppVersion=8.0`) }

test('moderator reviews, edits, approves and hides local places and imports checked CSV', async ({ page }) => {
  const state = await setup(page)
  state.place = { id: '00000000-0000-4000-8000-000000006001', name: 'Синтетический музей', address: 'Примерная улица, 1', city: 'Тестовый город', category: 'museum', category_label: 'Музей', status: 'pending', version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_at: null, reason: null }
  await launch(page, '/admin?section=places')
  await page.getByText('Сохранённый каталог', { exact: true }).click()
  await page.getByRole('button', { name: 'Рассмотреть место' }).click()
  await page.getByRole('textbox', { name: 'Название места' }).fill('Уточнённый синтетический музей')
  await page.getByRole('textbox', { name: 'Причина решения или изменения' }).fill('Проверены адрес и публичный доступ')
  await page.getByRole('button', { name: 'Сохранить сведения' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await page.getByRole('button', { name: 'Рассмотреть место' }).click()
  await expect(page.getByRole('button', { name: 'Одобрить место' })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Причина решения или изменения' }).fill('Объект проверен')
  await page.getByRole('checkbox', { name: 'Я проверил существование объекта, адрес и публичную доступность' }).check()
  await page.screenshot({ path: test.info().outputPath('local-place-moderation.png'), fullPage: true })
  await page.getByRole('button', { name: 'Одобрить место' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect.poll(() => state.decisions).toBe(1)
  await page.getByRole('combobox', { name: 'Статус места' }).selectOption('approved')
  await page.getByRole('button', { name: 'Рассмотреть место' }).click()
  await page.getByRole('textbox', { name: 'Причина решения или изменения' }).fill('Временно скрываем из новых подсказок')
  await page.getByRole('button', { name: 'Скрыть место' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect.poll(() => state.decisions).toBe(2)
  await page.getByText('Наполнить каталог из CSV', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Поиск места' }).fill('')
  await page.locator('input[type=file]').setInputFiles({ name: 'checked.csv', mimeType: 'text/csv', buffer: Buffer.from('name,address,city,category\nСинтетический парк,Примерная 1,Тестовый город,park\n') })
  await page.getByRole('checkbox', { name: 'Все объекты в CSV проверены мной' }).check()
  await page.getByRole('button', { name: 'Импортировать CSV', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect.poll(() => state.imports).toBe(1)
})

