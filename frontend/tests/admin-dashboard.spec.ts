import { expect, test, type Page } from '@playwright/test'
import { scenario, responder, planId, author, launch } from './connectionScenario'
import type { AdminPeriod, AnalyticsReport } from '../src/api/admin'

// Синтетический контракт только для браузерных тестов; SQL-агрегаты проверяет pytest.
function report(period: AdminPeriod): AnalyticsReport {
  const keys = ['users_total', 'new_users', 'active_users', 'plans_created', 'plans_published', 'responses', 'matches', 'confirmed_meetings', 'pending_reports', 'plans_response_rate', 'accepted_rate', 'retention']
  const titles = ['Всего пользователей', 'Новые пользователи', 'Активные по действиям', 'Созданные планы', 'Первые публикации', 'Отправленные отклики', 'Созданные мэтчи', 'Взаимно подтверждённые встречи', 'Жалобы в очереди', 'Планы с откликами', 'Принятые отклики', 'Возвращаемость по открытиям']
  const values = [12, 12, 9, 6, null, 11, 3, 1, 2, 50, 27.27, null]
  const first = new Date(`${period.start_date}T12:00:00Z`), last = new Date(`${period.end_date}T12:00:00Z`)
  const days = Math.round((+last - +first) / 86400000) + 1
  return { generated_at: new Date().toISOString(), collection_started_at: '2026-11-25T10:00:00Z',
    period: { ...period, from: `${period.start_date}T00:00:00Z`, to_exclusive: `${period.end_date}T20:00:00Z`, previous_from: '2026-09-27T00:00:00Z', previous_to_exclusive: '2026-10-26T20:00:00Z' },
    metrics: keys.map((id, i) => ({ id, label: titles[i], unit: i > 8 ? '%' : 'записей', value: values[i], previous: [0, 8, 6, 4, null, 7, 2, 0, 0, 0, 0, null][i], change_percent: i === 1 ? 50 : null, definition: `Расчёт ${titles[i]} из серверных записей; синтетический контракт теста`, reason: values[i] == null ? id === 'retention' ? 'Нет журнала открытий приложения' : 'Нет полного учёта публикаций за период' : null })),
    daily: Array.from({ length: days }, (_, i) => { const date = new Date(first); date.setUTCDate(first.getUTCDate() + i); return { date: date.toISOString().slice(0, 10), registrations: i >= days - 6 ? 2 : 0, active_users: i >= days - 7 ? (i % 3) + 1 : 0 } }),
    categories: [{ code: 'art', label: 'Искусство', value: 3 }, { code: 'coffee', label: 'Кофе и еда', value: 2 }, { code: 'walk', label: 'Прогулки', value: 1 }],
    funnel: { basis: 'Когорта откликов; просмотры не измерялись за весь период', unit: 'пара кандидат/план', note: 'Только последовательные переходы', stages: ['Просмотр плана', 'Отклик', 'Мэтч', 'Начало переписки', 'Подтверждение после переписки'].map((label, i) => ({ label, value: [null, 11, 3, 2, 1][i], numerator: [null, 11, 3, 2, 1][i], denominator: [null, null, 11, 3, 2][i], conversion: [null, null, 27.27, 66.67, 50][i] })) },
    meetings: ['mutual_yes', 'mutual_no', 'conflicting', 'insufficient', 'no_data'].map((id, i) => ({ id, value: [1, 0, 0, 1, 1][i] })),
    limitations: ['Данные сохранившихся записей; удалённая история не восстанавливается', 'Активность не равна Telegram-входам', 'Молчание не означает неявку'] }
}

async function setup(page: Page) {
  await scenario().install(page, responder)
  const calls: { path: string; query: string }[] = []
  const profile = { id: author, name: 'Участник пилота', state: 'active', profile_state: 'not_submitted', created_at: '2026-11-20T12:00:00Z', plans: 2, matches: 1, related_reports: 1 }
  const plan = { id: planId, title: 'Вечер в галерее', category: 'Искусство', category_code: 'art', starts_at: '2027-01-12T16:00:00Z', time_zone: 'Europe/Moscow', publication_status: 'published', moderation_status: 'not_submitted', responses: 3, created_at: '2026-11-20T12:00:00Z', author: { id: author, name: profile.name }, description: 'Прогулка по выставке', place: 'Галерея', has_reports: true, related_reports: 1 }
  await page.route('**/api/v1/admin/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1/admin/', '')
    calls.push({ path, query: url.search })
    if (path === 'session') return route.fulfill({ json: { role: 'admin', permissions: ['analytics', 'users', 'plans', 'moderation', 'system', 'editorial'] } })
    if (path === 'analytics') return route.fulfill({ json: report(Object.fromEntries(url.searchParams) as unknown as AdminPeriod) })
    if (path === 'analytics/export') { const data = report(route.request().postDataJSON()); data.metrics[0].value = 13; return route.fulfill({ json: { report: data, filename: 'poidem-test.csv', csv: '\ufeffПоказатель;Значение\r\nПользователи;13\r\n' } }) }
    if (path === 'users') return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [{ ...profile, id: responder, name: 'Другой участник' }] : [profile], total: 2, next_cursor: url.searchParams.has('cursor') ? null : 'synthetic-page-2' } })
    if (path === `users/${author}`) return route.fulfill({ json: profile })
    if (path === 'plans') return route.fulfill({ json: { items: [plan], total: 1, next_cursor: null } })
    if (path === `plans/${planId}`) return route.fulfill({ json: plan })
    if (path === 'system') return route.fulfill({ json: { checked_at: new Date().toISOString(), api: 'available', database: 'available', worker: 'unknown', worker_explanation: 'Heartbeat не записывается', jobs: { pending: 1, sent: 5, suppressed: 2 }, last_sent_at: null, oldest_due_at: null, errors: [], audit: [{ action: 'server_assign_role', occurred_at: '2026-11-25T12:00:00Z', target: `user:${responder}` }] } })
    if (path === 'audit' || path === 'notifications') return route.fulfill({ json: { items: [], total: 0, next_offset: null } })
    if (path === 'reports') return route.fulfill({ json: { items: [], next_cursor: null } })
    return route.fallback()
  })
  return calls
}

test('admin overview, honest missing metrics, interactive graph, period and same-snapshot CSV', async ({ page }, info) => {
  const calls = await setup(page)
  await launch(page, '/admin')
  await expect.poll(async () => { const box = await page.locator('.admin-skip-link').boundingBox(); return box ? box.y + box.height : 0 }).toBeLessThanOrEqual(0)
  await expect(page.getByRole('navigation', { name: 'Разделы администратора' }).getByRole('button')).toHaveCount(7)
  await expect(page.locator('.admin-metric').filter({ hasText: 'Новые пользователи' })).toContainText('12')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Первые публикации' })).toContainText('Нет данных')
  await page.getByRole('button', { name: '7 дней', exact: true }).click()
  await expect.poll(() => calls.filter(row => row.path === 'analytics').length).toBeGreaterThanOrEqual(2)
  await page.getByLabel('День на графике').fill('6')
  await expect(page.locator('.admin-chart output')).toContainText('Регистрации: 2')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('poidem-test.csv')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Всего пользователей' })).toContainText('13')
  for (const width of info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? [320, 360, 390, 430] : [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    if ([390, 1366].includes(width)) await page.screenshot({ path: info.outputPath(`admin-overview-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Аналитика', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Итоги встреч', exact: true })).toBeVisible()
  await expect(page.locator('.admin-funnel')).toContainText('Неполные данные')
  await expect(page.locator('.admin-main')).not.toContainText('Штраф')
  await page.setViewportSize({ width: info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? 390 : 1366, height: 900 })
  await page.screenshot({ path: info.outputPath('admin-analytics-desktop.png'), fullPage: true })
})

test('admin directory paginates and links only to permitted complaint context', async ({ page }, info) => {
  test.setTimeout(90000)
  const calls = await setup(page)
  await launch(page, '/admin?section=users')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page.locator('tbody')).toContainText('Другой участник')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.locator('.admin-table-scroll').first().evaluate(node => { node.scrollLeft = node.scrollWidth })
  await page.getByRole('button', { name: 'Открыть Участник пилота', exact: true }).click()
  await expect(page.locator('.admin-object-detail')).toContainText('Планов: 2')
  await expect(page.locator('.admin-object-detail img, .chat-message')).toHaveCount(0)
  await page.getByRole('link', { name: 'Связанные жалобы · 1', exact: true }).click()
  await expect.poll(() => calls.some(row => row.path === 'reports' && row.query.includes(`user_id=${author}`))).toBe(true)
  await page.getByRole('button', { name: 'Планы', exact: true }).click()
  await page.getByLabel('Поиск', { exact: true }).fill('галерея')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect.poll(() => calls.some(row => row.path === 'plans' && new URLSearchParams(row.query).get('q') === 'галерея')).toBe(true)
  await page.locator('.admin-table-scroll').first().evaluate(node => { node.scrollLeft = node.scrollWidth })
  await page.getByRole('button', { name: 'Открыть Вечер в галерее', exact: true }).click()
  await expect(page.locator('.admin-object-detail')).toContainText('Прогулка по выставке')
  for (const width of info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? [320, 390, 430] : [320, 390, 1366]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1) }
  await page.screenshot({ path: info.outputPath('admin-plans-desktop.png') })
  await page.getByRole('button', { name: 'Система', exact: true }).click()
  await expect(page.locator('.admin-metric').filter({ hasText: 'Обработчик уведомлений' })).toContainText('Нет данных')
  await expect(page.getByRole('heading', { name: 'Очередь уведомлений' })).toBeVisible()
})

test('admin errors never turn into fabricated counts and ordinary roles are denied', async ({ page }) => {
  await setup(page)
  await page.route('**/api/v1/admin/analytics?**', route => route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Статистика временно недоступна' } } }))
  await launch(page, '/admin')
  await expect(page.getByRole('alert')).toContainText('Статистика временно недоступна')
  await expect(page.locator('.admin-metric')).toHaveCount(0)
  await page.route('**/api/v1/admin/session', route => route.fulfill({ status: 403, json: { error: { code: 'ADMIN_REQUIRED', message: 'Доступ ограничен' } } }))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Доступ ограничен' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Разделы администратора' })).toHaveCount(0)
})

test('a failed CSV export retries the export and updates the same report snapshot', async ({ page }) => {
  await setup(page)
  let fail = true
  await page.route('**/api/v1/admin/analytics/export', route => {
    if (!fail) return route.fallback()
    fail = false
    return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'CSV временно недоступен' } } })
  })
  await launch(page, '/admin')
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('CSV временно недоступен')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('poidem-test.csv')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Всего пользователей' })).toContainText('13')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
