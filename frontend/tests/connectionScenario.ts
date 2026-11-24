import { expect, type Page } from '@playwright/test'

// Только контракт браузерного UI: синтетические ответы перехватываются в тесте.
// HMAC, SQL-транзакции и права отдельно проверяет pytest на PostgreSQL *_test.
export const author = '00000000-0000-4000-8000-000000000101'
export const responder = '00000000-0000-4000-8000-000000000202'
export const planId = '00000000-0000-4000-8000-000000001001'
export const matchId = '00000000-0000-4000-8000-000000002001'
const startsAt = new Date(Date.now() + 30 * 86400000).toISOString()
export const publicProfile = (id: string) => ({ name: id === author ? 'Тестовый автор' : 'Тестовый участник', age: 24,
  bio: 'Синтетическая анкета только для автоматизированного теста', interests: ['Искусство', 'Кофе', 'Прогулки'], photo: { url: '/images/gallery.jpeg' } })
type Attempt = { id: string; status: 'waiting' | 'rejected' | 'accepted' | 'closed'; version: number; displayStatus?: 'waiting' | 'expired' | 'accepted' | 'rejected' | 'closed'; createdAt?: string; responderId?: string }

export function scenario(options: { full?: boolean; matched?: boolean; noUsername?: boolean; archived?: boolean; long?: boolean; expired?: boolean; historyPageSize?: number } = {}) {
  const profileFor = (id: string) => ({ ...publicProfile(id), ...(options.long ? { name: publicProfile(id).name.repeat(3).slice(0, 60), bio: 'Длинное описание только для браузерной проверки '.repeat(5), interests: ['Длительное название интереса'.repeat(3), 'Кино', 'Прогулки'] } : {}) })
  const planTime = options.expired ? new Date(Date.now() - 3600000).toISOString() : startsAt
  const recordedAt = new Date().toISOString()
  const state = { attempts: [] as Attempt[], matched: options.matched ?? false, keys: [] as string[], full: options.full ?? false,
    archived: options.archived ?? false, hidden: new Set<string>(),
    messages: [] as { id: string; sequence: number; senderId: string; text: string; client_id: string; created_at: string }[],
    reads: new Map<string, number>(), messageKeys: [] as string[] }
  const plan = (viewer: string) => ({ id: planId, author: { id: author, name: profileFor(author).name },
    title: options.long ? 'Достопримечательности'.repeat(4).slice(0, 80) : 'Тестовый вечер в галерее', category_code: 'art', description: 'Синтетический план браузерного теста',
    starts_at: planTime, time_zone: 'Europe/Moscow', place: options.long ? 'Длинный адрес встречи '.repeat(7).slice(0, 160) : 'Тестовая галерея', publication_status: state.matched ? 'closed' : 'published',
    moderation_status: 'not_submitted', created_at: startsAt, version: state.matched ? 3 : 2, image: '/images/gallery.jpeg', own: viewer === author, archived: state.archived })
  const response = (attempt: Attempt, viewer: string) => {
    const display = attempt.displayStatus ?? (attempt.status === 'waiting' && options.expired ? 'expired' : attempt.status)
    return { ...attempt, plan_id: planId, plan: attempt.status === 'rejected' && viewer === responder ? null : plan(viewer), created_at: attempt.createdAt ?? recordedAt,
      status: attempt.status, display_status: display, decided_at: attempt.status === 'waiting' ? null : recordedAt, archived: state.archived,
      profile: display === 'waiting' || display === 'accepted' ? profileFor(viewer === author ? attempt.responderId ?? responder : author) : null,
      match_id: attempt.status === 'accepted' ? matchId : null, viewer_role: viewer === author ? 'author' : 'responder',
      history_context: { plan_title: plan(viewer).title, author_name: profileFor(author).name, responder_name: profileFor(attempt.responderId ?? responder).name, responder_age: 24, captured_at: recordedAt, source: 'response' },
      match: attempt.status === 'accepted' ? match(viewer) : null }
  }
  const unread = (viewer: string) => state.messages.filter(message => message.senderId !== viewer && message.sequence > (state.reads.get(viewer) ?? 0)).length
  const match = (viewer: string) => ({ id: matchId, plan_id: planId, title: options.long ? 'Достопримечательности'.repeat(4).slice(0, 80) : 'Тестовый вечер в галерее', image: '/images/gallery.jpeg',
    starts_at: planTime, time_zone: 'Europe/Moscow', place: options.long ? 'Длинный адрес встречи '.repeat(7).slice(0, 160) : 'Тестовая галерея', created_at: startsAt,
    participants: [{ role: 'author', profile: profileFor(author) }, { role: 'responder', profile: profileFor(responder) }], archived: state.archived, unread_count: unread(viewer), meeting_cancelled: false, viewer_role: viewer === author ? 'author' : 'responder' })
  const chat = (viewer: string) => ({ match_id: matchId, last_sequence: state.messages.length, last_read_sequence: state.reads.get(viewer) ?? 0,
    other_last_read_sequence: state.reads.get(viewer === author ? responder : author) ?? 0, unread_count: unread(viewer), can_send: true, meeting_cancelled: false, archived: state.archived })
  return {
    state, plan, match, response,
    async install(page: Page, viewer: string) {
      await page.route('https://telegram.org/js/telegram-web-app.js', route => route.abort())
      await page.route('**/api/v1/**', async route => {
        const req = route.request(), url = new URL(req.url()), path = url.pathname
        const json = (value: unknown, status = 200) => route.fulfill({ status, json: value })
        if (path === '/api/v1/auth/telegram') return json({ user: { id: viewer, account_status: 'active' }, csrf_token: 'synthetic-only',
          authorization: { method: 'telegram_init_data', verified_at: startsAt },
          profile: { user_id: viewer, name: profileFor(viewer).name, age: 24, gender_code: 'woman', preference_code: 'any', bio: 'Тест', photo: { id: viewer, url: '/images/gallery.jpeg' }, interest_ids: ['art', 'coffee', 'walks'], version: 1, moderation_status: 'not_submitted' } })
        if (path === '/api/v1/auth/csrf') return json({ user_id: viewer, csrf_token: 'synthetic-only' })
        expect(req.headers()['x-account-context']).toBe(viewer)
        if (path === '/api/v1/me/quotas') return json({ maximum: 3, used: 1, remaining: 2, day: '2099-01-01', time_zone: 'Europe/Moscow' })
        if (path === '/api/v1/me/plans') return json({ items: viewer === author ? [plan(viewer)] : [], next_cursor: null })
        const rejected = state.attempts.some(attempt => attempt.status === 'rejected' && (attempt.responderId ?? responder) === viewer)
        if (path === '/api/v1/plans') return json({ items: viewer !== author && !state.matched && !rejected ? [plan(viewer)] : [], next_cursor: null })
        if (path === '/api/v1/me/responses') {
          const incoming = url.searchParams.get('direction') === 'incoming'
          return json({ items: (incoming ? viewer === author : viewer !== author) ? [...state.attempts].reverse().filter(item => incoming || (item.responderId ?? responder) === viewer).map(item => response(item, viewer)) : [], next_cursor: null })
        }
        if (path === '/api/v1/me/matches') return json({ items: state.matched ? [match(viewer)] : [], next_cursor: null })
        if (path === '/api/v1/me/activity') {
          const archived = url.searchParams.get('scope') === 'archive', includeHidden = url.searchParams.get('include_hidden') === 'true'
          const items = []
          if (archived === state.archived && (!state.hidden.has(viewer) || includeHidden)) {
            const base = { plan_id: planId, archived, hidden: state.hidden.has(viewer), plan: null, response: null, match: null }
            if (state.matched) items.push({ ...base, key: `match:${matchId}`, kind: 'match', match: match(viewer) })
            else {
              if (viewer === author && !archived && !options.expired) for (const attempt of state.attempts.filter(item => item.status === 'waiting')) items.push({ ...base, key: `incoming:${attempt.id}`, kind: 'incoming', response: response(attempt, viewer) })
              if (viewer === author) items.push({ ...base, key: `plan:${planId}`, kind: 'plan', plan: plan(viewer) })
              else for (const attempt of state.attempts.filter(item => (item.responderId ?? responder) === viewer && (archived ? item.status !== 'accepted' : item.status === 'waiting' && !options.expired))) items.push({ ...base, key: `outgoing:${attempt.id}`, kind: 'outgoing', response: response(attempt, viewer) })
            }
          }
          return json({ items, next_cursor: null })
        }
        if (path === `/api/v1/me/archive/${planId}/visibility`) {
          if (req.postDataJSON().hidden) state.hidden.add(viewer); else state.hidden.delete(viewer)
          return route.fulfill({ status: 204 })
        }
        if (path === `/api/v1/matches/${matchId}/chat` && state.matched) return json(chat(viewer))
        if (path === `/api/v1/matches/${matchId}/read` && state.matched) {
          state.reads.set(viewer, req.postDataJSON().through_sequence); return json(chat(viewer))
        }
        if (path === `/api/v1/matches/${matchId}/messages` && state.matched) {
          const messageDTO = (message: typeof state.messages[number]) => ({ id: message.id, sequence: message.sequence, text: message.text,
            sender: message.senderId === viewer ? 'self' : 'other', client_id: message.senderId === viewer ? message.client_id : null, created_at: message.created_at })
          if (req.method() === 'POST') {
            const body = req.postDataJSON(); state.messageKeys.push(body.client_id)
            let message = state.messages.find(item => item.senderId === viewer && item.client_id === body.client_id)
            if (!message) { message = { id: crypto.randomUUID(), sequence: state.messages.length + 1, senderId: viewer, text: body.text, client_id: body.client_id, created_at: new Date().toISOString() }; state.messages.push(message) }
            return json({ message: messageDTO(message) }, 201)
          }
          const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER), after = Number(url.searchParams.get('after') ?? 0)
          const filtered = state.messages.filter(item => item.sequence < before && item.sequence > after)
          const page = url.searchParams.has('after') ? filtered.slice(0, 30) : filtered.slice(-30)
          return json({ items: page.map(messageDTO), has_more: filtered.length > 30, next_before: !url.searchParams.has('after') && filtered.length > 30 ? page[0].sequence : null })
        }
        if (viewer === responder && rejected && path.startsWith(`/api/v1/plans/${planId}`)) return json({ error: { code: 'PLAN_NOT_FOUND', message: 'Этот план не найден' } }, 404)
        if (path === `/api/v1/plans/${planId}`) return json({ plan: plan(viewer) })
        if (path.endsWith('/author')) return json({ profile: profileFor(author) })
        if (path.endsWith('/capacity')) {
          const waiting = state.attempts.find(attempt => attempt.status === 'waiting')
          const count = state.full ? 15 : waiting ? 1 : 0
          return json({ count, maximum: 15, remaining: 15 - count, can_respond: !waiting && !state.full && !state.matched,
            own_response_id: waiting?.id ?? null })
        }
        if (path === `/api/v1/plans/${planId}/responses` && req.method() === 'GET') {
          if (viewer !== author) return json({ error: { code: 'CONNECTION_NOT_FOUND', message: 'Эта запись недоступна' } }, 404)
          const offset = Number(url.searchParams.get('cursor') ?? 0), size = options.historyPageSize ?? 20
          return json({ items: state.attempts.slice(offset, offset + size).map(item => response(item, viewer)), next_cursor: offset + size < state.attempts.length ? String(offset + size) : null })
        }
        if (path === `/api/v1/plans/${planId}/responses` && req.method() === 'POST') {
          expect(req.postDataJSON()).toEqual({ expected_plan_version: 2 })
          state.keys.push(req.headers()['idempotency-key'])
          const attempt: Attempt = { id: crypto.randomUUID(), status: 'waiting', version: 1 }
          state.attempts.push(attempt)
          return json({ response: response(attempt, viewer) }, 201)
        }
        if (path.endsWith('/decision')) {
          expect(viewer).toBe(author)
          const attempt = state.attempts.find(item => path.includes(item.id))!
          attempt.status = req.postDataJSON().decision === 'accept' ? 'accepted' : 'rejected'
          attempt.version++
          if (attempt.status === 'accepted') state.matched = true
          return json({ response: response(attempt, viewer) })
        }
        if (path === `/api/v1/matches/${matchId}` && state.matched) return json({ match: match(viewer) })
        if (path === `/api/v1/matches/${matchId}/contact` && state.matched) return json({ available: !options.noUsername,
          telegram_url: options.noUsername ? null : 'https://t.me/Synthetic_Partner', reason: options.noUsername ? 'username_missing' : null })
        return json({ error: { code: 'TEST_NOT_FOUND', message: 'Тестовая запись недоступна' } }, 404)
      })
    },
  }
}

export async function launch(page: Page, path: string) {
  await page.goto(`${path}#tgWebAppData=synthetic-browser-contract`, { waitUntil: 'domcontentloaded' })
}

