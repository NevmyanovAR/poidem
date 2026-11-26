import type { Page } from '@playwright/test'

// Тестовая копия исходного редакционного контента; в runtime статического fallback нет.
export const editorialIdeas = [
  { id: 'art-evening', title: 'Искусство быть рядом', subtitle: 'Красивое свидание не требует сценария. Но иногда с ним проще', image: '/images/art.jpeg', category_code: 'experiences', place: 'Творческая мастерская · Москва', plan_title: 'Арт-свидание вдвоём', tag: 'Делать что-то впервые' },
  { id: 'slow-dinner', title: 'Вечер со вкусом', subtitle: 'Приглушённый свет, любимая еда и ещё один повод задержаться', image: '/images/wine.jpeg', category_code: 'food', place: 'Cavita · Москва', plan_title: 'Вечер в Cavita', tag: 'Для разговоров обо всём' },
  { id: 'gallery-date', title: 'Смотреть в одну сторону', subtitle: 'Найти свою картину. А может быть, и своего человека', image: '/images/gallery.jpeg', category_code: 'art', place: 'Галерея на Волхонке · Москва', plan_title: 'Вместе на выставку', tag: 'Вдохновляться вдвоём' },
].map((idea, index) => ({ ...idea, sort_order: index, state: 'published', version: 1, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }))

export async function serveEditorial(page: Page) {
  await page.route('**/api/v1/inspiration**', route => {
    const path = new URL(route.request().url()).pathname
    const item = editorialIdeas.find(idea => path === `/api/v1/inspiration/${idea.id}`)
    return path === '/api/v1/inspiration' ? route.fulfill({ json: { items: editorialIdeas, total: 3, next_offset: null } }) : item ? route.fulfill({ json: item }) : route.fulfill({ status: 404, json: { error: { code: 'IDEA_NOT_FOUND', message: 'Идея недоступна' } } })
  })
}

export const staffPermissions = {
  admin: ['analytics', 'users', 'plans', 'moderation', 'system', 'editorial'],
  owner: ['analytics', 'users', 'plans', 'moderation', 'system', 'editorial', 'team'],
  moderator: ['moderation'], analyst: ['analytics'],
}
