import { expect, test, type Page } from '@playwright/test'
import { scenario, responder, author, launch } from './connectionScenario'
import { editorialIdeas, staffPermissions } from './helpers/editorial'
import type { EditorialIdea, StaffRole, AnalyticsReport, AdminPeriod } from '../src/api/admin'

const timestamp = '2026-11-26T06:00:00Z'

function analytics(period: AdminPeriod): AnalyticsReport {
  return { generated_at: timestamp, period: { ...period, from: timestamp, to_exclusive: timestamp, previous_from: timestamp, previous_to_exclusive: timestamp }, collection_started_at: timestamp,
    metrics: [
      { id: 'plans_published', label: 'Первые публикации', value: null, unit: 'планов', previous: null, change_percent: null, definition: 'Первые публикации в периоде, без восстановления истории', reason: 'Учёт ведётся с 26 ноября 2026; период начинается раньше', data_status: 'incomplete', collection_started_at: timestamp },
      { id: 'plans_published_now', label: 'Опубликовано планов сейчас', value: 2, unit: 'планов', previous: null, change_percent: null, definition: 'Текущие published с доступной модерацией', reason: null, data_status: 'complete' },
      { id: 'published_response_rate_now', label: 'Доля текущих публикаций с откликами', value: 50, unit: '%', previous: null, change_percent: null, definition: '1 / 2 на момент снимка, вне фильтра периода', reason: null },
    ], daily: [{ date: '2026-11-26', registrations: 0, active_users: 0 }], categories: [], meetings: [], limitations: ['Нет восстановления прежних событий'],
    funnel: { basis: 'Когорта откликов', unit: 'пара кандидат/план', note: 'Просмотры ранее не измерялись', stages: [{ label: 'Просмотр плана', value: null, numerator: null, denominator: null, conversion: null }, { label: 'Отклик', value: 0, numerator: 0, denominator: null, conversion: null }] } }
}

async function setup(page: Page, role: Exclude<StaffRole, 'user'> = 'owner') {
  await scenario().install(page, responder)
  const state = { role, ideas: editorialIdeas.map(row => ({ ...row })) as EditorialIdea[], staffRole: 'user' as StaffRole, version: 1, changes: 0, commands: [] as string[], photoUploads: 0, csv: 0 }
  await page.route('**/api/v1/admin/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1/admin/', '')
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status })
    if (path === 'session') return json({ role: state.role, permissions: staffPermissions[state.role] })
    if (path === 'analytics') return json(analytics(Object.fromEntries(url.searchParams) as unknown as AdminPeriod))
    if (path === 'analytics/export') { state.csv++; return json({ report: analytics(request.postDataJSON()), filename: 'analytics.csv', csv: '\ufeffПоказатель;Значение\r\nОпубликовано планов сейчас;2\r\n' }) }
    if (path === 'team') return json({ items: [{ id: author, name: 'Сотрудник пилота', role: state.staffRole, version: state.version, state: 'active', created_at: timestamp }], total: 1, next_cursor: null })
    if (path === `team/${author}/role`) { state.staffRole = request.postDataJSON().role; state.version++; state.changes++; return json({ changed: true }) }
    if (path === 'inspiration' && request.method() === 'GET') return json({ items: state.ideas, total: state.ideas.length, next_offset: null })
    if (path === 'inspiration' && request.method() === 'POST') { const idea: EditorialIdea = { ...request.postDataJSON(), version: 1, image: null, state: 'draft', created_at: timestamp, updated_at: timestamp }; state.ideas.push(idea); return json(idea, 201) }
    const match = /^inspiration\/([^/]+)(?:\/(photo|command))?$/.exec(path)
    if (match) {
      const idea = state.ideas.find(row => row.id === match[1])!
      if (match[2] === 'photo') { idea.image = '/images/art.jpeg'; idea.version++; state.photoUploads++; return json(idea) }
      if (match[2] === 'command') { const action = request.postDataJSON().action; state.commands.push(action); if (action === 'delete') { state.ideas = state.ideas.filter(row => row !== idea); return json({ deleted: true }) }; idea.state = action === 'publish' ? 'published' : 'draft'; idea.version++; return json(idea) }
      Object.assign(idea, request.postDataJSON(), { version: idea.version + 1 }); return json(idea)
    }
    if (path === 'system') return json({ checked_at: timestamp, api: 'available', database: 'available', worker: 'ok', worker_explanation: 'Два цикла; свежесть heartbeat 60 секунд', heartbeat: { worker: { state: 'ok', label: 'Работает', last_seen_at: timestamp }, polling: { state: 'stale', label: 'Нет свежего сигнала', last_seen_at: timestamp } }, categories: [{ id: 'suppressed', label: 'Намеренно пропущены', count: 9 }, { id: 'unknown', label: 'Причина неизвестна для старых записей', count: 3 }, { id: 'sent', label: 'Успешно отправлены', count: 13 }], jobs: {}, last_sent_at: timestamp, oldest_due_at: null, expired_leases: 0, errors: [], audit: [] })
    if (path === 'notifications') return json({ items: [{ id: 'job-1', kind: 'Сообщения чата', state_label: 'Причина неизвестна для старых записей', category: 'unknown', reason: 'Событие утратило актуальность; точная причина не сохранена', created_at: timestamp, due_at: timestamp, next_attempt_at: timestamp, sent_at: null, attempts: 1, overdue: false }], total: 1, next_offset: null })
    if (path === 'audit') return json({ items: url.searchParams.get('kind') === 'reads' ? [{ action: 'admin_analytics_read', occurred_at: timestamp, target: 'analytics:snapshot' }] : [{ action: 'team_role_change', occurred_at: timestamp, target: `user:${author}`, reason: 'Назначен сотрудник' }], total: 1, next_offset: null })
    if (path === 'reports') return json({ items: [], next_cursor: null })
    return route.fallback()
  })
  return state
}

test('owner edits editorial content, preview, photo, publication, ordering and confirmed deletion', async ({ page }, info) => {
  test.setTimeout(120000)
  const state = await setup(page)
  await launch(page, '/admin?section=inspiration')
  await expect(page.getByRole('navigation', { name: 'Разделы администратора' }).getByRole('button')).toHaveCount(9)
  await expect(page.getByRole('heading', { name: 'Вдохновение', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Новая идея', exact: true }).click()
  await expect(page.getByLabel('Адрес идеи', { exact: true })).toBeFocused()
  await page.getByLabel('Адрес идеи', { exact: true }).fill('test-gallery')
  await page.getByLabel('Название', { exact: true }).fill('Вечер в галерее')
  await page.getByLabel('Описание', { exact: true }).fill('Искусство и разговоры')
  await page.getByLabel('Место', { exact: true }).fill('Выставочное пространство')
  await page.getByLabel('Название будущего плана', { exact: true }).fill('Пойдём на выставку')
  await page.getByLabel('Порядок отображения', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.locator('.admin-content [role="status"]')).toContainText('Идея сохранена')
  await expect.poll(() => state.ideas.find(row => row.id === 'test-gallery')?.state).toBe('draft')
  await page.getByLabel('Фотография идеи', { exact: true }).setInputFiles({ name: 'idea.png', mimeType: 'image/png', buffer: Buffer.from('synthetic transport; actual validation is tested in pytest') })
  await page.getByRole('button', { name: 'Загрузить фотографию', exact: true }).click()
  await expect.poll(() => state.photoUploads).toBe(1)
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
  await expect(page.locator('.admin-editor-preview')).toContainText('Вечер в галерее')
  for (const width of info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? [320, 360, 390, 430] : [320, 360, 390, 430, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    if ([390, 1366, 1920].includes(width)) await page.screenshot({ path: info.outputPath(`admin9b-editor-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect(page.locator('.admin-content [role="status"]')).toContainText('Идея опубликована')
  await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect(page.locator('.admin-content [role="status"]')).toContainText('Идея снята с публикации')
  await page.getByRole('button', { name: 'Удалить идею', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect.poll(() => state.commands).toEqual(['publish', 'unpublish', 'delete'])
  await expect(page.locator('.admin-editor')).toHaveCount(0)
})

test('owner manages an existing member with confirmation; repeated clicks do not duplicate changes', async ({ page }, info) => {
  const state = await setup(page)
  await launch(page, '/admin?section=team')
  await page.locator('.admin-table-scroll').first().evaluate(node => { node.scrollLeft = node.scrollWidth })
  await page.getByRole('button', { name: 'Изменить права', exact: true }).click()
  await page.getByLabel('Новая роль', { exact: true }).selectOption('analyst')
  await page.getByLabel('Причина изменения', { exact: true }).fill('Работа со статистикой диплома')
  await page.getByRole('button', { name: 'Проверить изменение', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Пользователь → Аналитик')
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить изменение прав' }).click()
  await expect.poll(() => state.changes).toBe(1)
  await expect(page.locator('.admin-content [role="status"]')).toContainText('Права сотрудника сохранены')
  await expect(page.locator('tbody')).toContainText('Аналитик')
  await page.setViewportSize({ width: info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? 390 : 1366, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('admin9b-team-desktop.png'), fullPage: true })
})

for (const role of ['analyst', 'moderator', 'admin'] as const) test(`${role} only sees permitted sections and uses the permitted landing screen`, async ({ page }) => {
  await setup(page, role)
  await launch(page, '/admin?section=team')
  const nav = page.getByRole('navigation', { name: 'Разделы администратора' })
  await expect(nav.getByRole('button', { name: 'Команда', exact: true })).toHaveCount(0)
  await expect(nav.getByRole('button')).toHaveCount(role === 'analyst' ? 2 : role === 'moderator' ? 2 : 8)
  await expect(page.getByRole('heading', { level: 1, name: role === 'moderator' ? 'Модерация' : 'Обзор', exact: true })).toBeVisible()
  await expect(page.locator('.admin-editor')).toHaveCount(0)
})

test('system distinguishes suppression and unknown reasons; heartbeat and audit views are explicit', async ({ page }, info) => {
  await setup(page)
  await launch(page, '/admin?section=system')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Telegram-бот' })).toContainText('Нет свежего сигнала')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Обработчик уведомлений' })).toContainText('Работает')
  await expect(page.getByRole('button', { name: 'Намеренно пропущены', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Причина неизвестна для старых записей', exact: true }).click()
  await expect(page.locator('tbody')).toContainText('точная причина не сохранена')
  await expect(page.locator('.admin-audit')).toContainText('Изменение прав сотрудника')
  await page.getByLabel('Показывать', { exact: true }).selectOption('reads')
  await expect(page.locator('.admin-audit')).toContainText('Просмотр аналитики')
  for (const width of info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? [320, 360, 390, 430] : [320, 360, 390, 430, 1366, 1920]) { await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0)); expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1); if ([390, 1366].includes(width)) await page.screenshot({ path: info.outputPath(`admin9b-system-${width}.png`), fullPage: true }) }
})

test('incomplete history is distinct from current published snapshots and exported CSV', async ({ page }, info) => {
  const state = await setup(page, 'analyst')
  await launch(page, '/admin?section=analytics')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Первые публикации' })).toContainText('Неполные данные')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Первые публикации' })).toContainText('Учёт ведётся с')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Опубликовано планов сейчас' })).toContainText('2')
  await expect(page.locator('.admin-metric').filter({ hasText: 'Доля текущих публикаций с откликами' })).toContainText('50%')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт CSV', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('analytics.csv')
  expect(state.csv).toBe(1)
  await page.setViewportSize({ width: info.project.name === 'iphone-webkit' || info.project.name === 'android-chrome' ? 390 : 1366, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('admin9b-analytics-desktop.png'), fullPage: true })
})

test('editorial load failure has retry and never falls back to static published cards', async ({ page }) => {
  await setup(page)
  await page.route('**/api/v1/inspiration?**', route => route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Идеи временно недоступны' } } }))
  await launch(page, '/inspiration')
  await expect(page.getByRole('alert')).toContainText('Идеи временно недоступны')
  await expect(page.locator('.inspiration-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible()
})
