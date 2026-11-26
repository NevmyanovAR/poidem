import { CATEGORY_CODES, INTEREST_CODES } from '../data/catalogs'
import type { Plan, PlanInput, Profile, PublishedPlan, PlanResponse, PublicProfile, PairMatch, ResponseCapacity, MatchContact, ActivityPage, ActivityItem, ChatMessage, ChatState, MessagePage, ResponsePage } from '../types'
import type { CreationQuota } from '../lib/planRules'
import type { BlockedUser, ReportDetail, ReportReason, SafetyContext, SafetyReport, SafetyTarget } from './safety'
import type { Experience, FeedbackInput, SurveyState } from './feedback'
import type { DialogPage, NavigationSummary } from '../types'
import type { AdminPeriod, AnalyticsReport, AdminPage, AdminUser, AdminPlan, AdminSystem } from './admin'
import type { AdminAccess, StaffRole, StaffMember, OffsetPage, AuditEntry, NotificationTask, EditorialIdea, EditorialFields } from './admin'

interface PhotoDTO { id: string; url: string }
interface ProfileDTO {
  user_id: string; name: string; age: number; gender_code: Profile['gender']
  preference_code: Profile['preference']; bio: string; photo: PhotoDTO
  interest_ids: string[]; version: number
}
export interface AccountDTO {
  user: { id: string; account_status: string }
  authorization: { method: 'telegram_init_data'; verified_at: string }
  csrf_token: string
  profile: ProfileDTO | null
}
interface PlanDTO {
  id: string; author: { id: string; name: string }; title: string; category_code: string
  description: string; starts_at: string; time_zone: string; place: string
  publication_status: NonNullable<Plan['publicationStatus']>; moderation_status: NonNullable<Plan['moderation']>['status']
  created_at: string; version: number; image: string; own: boolean
  updated_at?: string; archived?: boolean
  allowed_actions?: ('edit' | 'cancel' | 'publish')[]
}
interface PublicProfileDTO { name: string; age: number; bio: string; interests: string[]; photo: { url: string }; experience?: Experience }
interface ResponseDTO {
  id: string; plan_id: string; plan: PlanDTO | null; status: PlanResponse['status']; version: number
  created_at: string; profile: PublicProfileDTO | null; match_id: string | null
  archived?: boolean
  display_status: PlanResponse['displayStatus']; decided_at?: string | null
  viewer_role: PlanResponse['viewerRole']
  history_context?: { plan_title: string; author_name: string; responder_name: string; responder_age: number; captured_at: string; source: 'response' | 'legacy' } | null
  match?: MatchDTO | null
}
interface MatchDTO {
  id: string; plan_id: string; title: string; image: string; starts_at: string; time_zone: string
  place: string; created_at: string; participants: { role: 'author' | 'responder'; profile: PublicProfileDTO | null }[]
  unread_count?: number; archived?: boolean; meeting_cancelled?: boolean
  viewer_role: PairMatch['viewerRole']
}
interface MessageDTO { id: string; sequence: number; sender: 'self' | 'other'; text: string; created_at: string; client_id: string | null }
interface ChatDTO { match_id: string; last_sequence: number; last_read_sequence: number; other_last_read_sequence: number; unread_count: number; can_send: boolean; meeting_cancelled: boolean; archived: boolean }
export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 0) { super(message); this.code = code; this.status = status }
}

const statusLabels: Record<NonNullable<Plan['publicationStatus']>, string> = {
  draft: 'Черновик', submitted: 'На проверке', published: 'Опубликован', closed: 'Закрыт', cancelled: 'Отменён',
}

function planFromDTO(dto: PlanDTO): PublishedPlan {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: dto.time_zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(dto.starts_at))
  const part = (name: string) => parts.find(entry => entry.type === name)?.value ?? ''
  const category = Object.entries(CATEGORY_CODES).find(([, code]) => code === dto.category_code)?.[0]
  if (!category) throw new ApiError('PLAN_CATEGORY_UNKNOWN', 'Категория плана недоступна — обнови страницу')
  return {
    id: dto.id, author: dto.author, title: dto.title, category: category as Plan['category'],
    description: dto.description, place: dto.place, image: dto.image, own: dto.own,
    date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}`,
    timeZone: dto.time_zone, startsAt: dto.starts_at, publicationStatus: dto.publication_status,
    label: statusLabels[dto.publication_status], published: dto.publication_status === 'published',
    createdAt: dto.created_at, serverVersion: dto.version,
    updatedAt: dto.updated_at, archived: dto.archived ?? false,
    allowedActions: dto.allowed_actions ?? [],
    moderation: { status: dto.moderation_status, source: 'server' },
  }
}

function planFields(plan: PlanInput) {
  const date = new Date(`${plan.date}T${plan.time}:00`)
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (!Number.isFinite(date.getTime()) || day !== plan.date || time !== plan.time) {
    throw new ApiError('PLAN_TIME_INVALID', 'Это местное время не существует — выбери другое время встречи')
  }
  return {
    title: plan.title.trim(), category_code: CATEGORY_CODES[plan.category], description: plan.description.trim(),
    starts_at: date.toISOString(), time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, place: plan.place.trim(),
  }
}

const configured = import.meta.env.VITE_API_BASE_URL?.trim()
const base = configured || (import.meta.env.DEV ? '/api/v1' : '')

export class ApiClient {
  adminTeam(filters: Record<string, string>, cursor?: string): Promise<AdminPage<StaffMember>> { return this.request(`/admin/team?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), ...(cursor ? { cursor } : {}) })}`) }
  adminRole(member: StaffMember, role: StaffRole, reason: string): Promise<{ changed: boolean }> { return this.track(() => this.request(`/admin/team/${encodeURIComponent(member.id)}/role`, { method: 'PUT', body: JSON.stringify({ role, version: member.version, confirm_user_id: member.id, reason }) })) }
  adminAudit(filters: Record<string, string>): Promise<OffsetPage<AuditEntry>> { return this.request(`/admin/audit?${new URLSearchParams(filters)}`) }
  adminNotifications(filters: Record<string, string>): Promise<OffsetPage<NotificationTask>> { return this.request(`/admin/notifications?${new URLSearchParams(filters)}`) }
  adminIdeas(filters: Record<string, string>): Promise<OffsetPage<EditorialIdea>> { return this.request(`/admin/inspiration?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)))}`) }
  adminCreateIdea(id: string, fields: EditorialFields): Promise<EditorialIdea> { return this.track(() => this.request('/admin/inspiration', { method: 'POST', body: JSON.stringify({ id, ...fields }) })) }
  adminEditIdea(idea: EditorialIdea, fields: EditorialFields): Promise<EditorialIdea> { return this.track(() => this.request(`/admin/inspiration/${encodeURIComponent(idea.id)}`, { method: 'PUT', body: JSON.stringify({ ...fields, version: idea.version }) })) }
  adminIdeaCommand(idea: EditorialIdea, action: 'publish' | 'unpublish' | 'delete'): Promise<EditorialIdea | { deleted: boolean }> { return this.track(() => this.request(`/admin/inspiration/${encodeURIComponent(idea.id)}/command`, { method: 'POST', body: JSON.stringify({ action, version: idea.version, confirm_id: idea.id }) })) }
  adminIdeaPhoto(idea: EditorialIdea, file: File): Promise<EditorialIdea> { const body = new FormData(); body.set('file', file); return this.track(() => this.request(`/admin/inspiration/${encodeURIComponent(idea.id)}/photo?version=${idea.version}`, { method: 'POST', body })) }
  ideas(offset = 0): Promise<OffsetPage<EditorialIdea>> { return this.request(`/inspiration?offset=${offset}`) }
  idea(id: string): Promise<EditorialIdea> { return this.request(`/inspiration/${encodeURIComponent(id)}`) }
  mediaUrl(path: string | null): string { return !path ? '' : path.startsWith('/api/') ? new URL(path, new URL(base || '/api/v1', window.location.origin).origin).toString() : path }
  adminAnalytics(period: AdminPeriod): Promise<AnalyticsReport> { return this.request(`/admin/analytics?${new URLSearchParams({ ...period })}`) }
  adminExport(period: AdminPeriod): Promise<{ report: AnalyticsReport; csv: string; filename: string }> { return this.track(() => this.request('/admin/analytics/export', { method: 'POST', body: JSON.stringify(period) })) }
  adminUsers(filters: Record<string, string>, cursor?: string): Promise<AdminPage<AdminUser>> { return this.request(`/admin/users?${new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) })}`) }
  adminUser(id: string): Promise<AdminUser> { return this.request(`/admin/users/${encodeURIComponent(id)}`) }
  adminPlans(filters: Record<string, string>, cursor?: string): Promise<AdminPage<AdminPlan>> { return this.request(`/admin/plans?${new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) })}`) }
  adminPlan(id: string): Promise<AdminPlan> { return this.request(`/admin/plans/${encodeURIComponent(id)}`) }
  adminSystem(): Promise<AdminSystem> { return this.request('/admin/system') }
  trackPlanView(id: string): Promise<{ recorded: boolean }> { return this.track(() => this.request(`/plans/${encodeURIComponent(id)}/view`, { method: 'POST' })) }
  report(context: SafetyContext, reason_code: ReportReason, comment: string): Promise<SafetyReport> {
    return this.track(() => this.request('/reports', { method: 'POST', body: JSON.stringify({ ...context, reason_code, comment: comment.trim() || null }) }))
  }
  block(context: SafetyContext): Promise<{ id: string; blocked: boolean }> {
    return this.track(() => this.request('/me/blocks', { method: 'POST', body: JSON.stringify(context) }))
  }
  async blocks(): Promise<{ items: BlockedUser[] }> {
    const page = await this.request<{ items: BlockedUser[] }>('/me/blocks')
    const origin = new URL(base || '/api/v1', window.location.origin).origin
    return { items: page.items.map(item => ({ ...item, photo_url: item.photo_url ? new URL(item.photo_url, origin).toString() : null })) }
  }
  unblock(id: string): Promise<void> { return this.track(() => this.request(`/me/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' })) }
  adminSession(): Promise<AdminAccess> { return this.request('/admin/session') }
  adminReports(state: string, target: string, cursor?: string, filters: { reason?: string; user?: string; plan?: string } = {}): Promise<{ items: SafetyReport[]; next_cursor: string | null }> {
    const params = new URLSearchParams()
    if (state) params.set('state', state)
    if (target) params.set('target_type', target as SafetyTarget)
    if (cursor) params.set('cursor', cursor)
    if (filters.reason) params.set('reason_code', filters.reason)
    if (filters.user) params.set('user_id', filters.user)
    if (filters.plan) params.set('plan_id', filters.plan)
    return this.request(`/admin/reports?${params}`)
  }
  adminReport(id: string): Promise<ReportDetail> { return this.request(`/admin/reports/${encodeURIComponent(id)}`) }
  adminDecision(id: string, action: 'dismiss' | 'hide_plan', reason: string): Promise<ReportDetail> {
    return this.track(() => this.request(`/admin/reports/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ action, reason }) }))
  }
  reportPhotoUrl(id: string): string { return `${base}/admin/reports/${encodeURIComponent(id)}/photo` }
  private csrf = ''
  private authFlight: Promise<AccountDTO | null> | null = null
  private authRaw = ''
  private pending = new Set<Promise<unknown>>()
  private uploaded = new WeakMap<File, PhotoDTO>()
  hasSession = false
  private hadSession = false
  private credentialEpoch = 0
  userId: string | null = null

  private publicProfile(value: PublicProfileDTO | null): PublicProfile | null {
    if (!value) return null
    const origin = new URL(base || '/api/v1', window.location.origin).origin
    return { ...value, photo: value.photo?.url ? new URL(value.photo.url, origin).toString() : '' }
  }
  private responseFromDTO(value: ResponseDTO): PlanResponse {
    const history = value.history_context
    return { id: value.id, planId: value.plan_id, plan: value.plan ? planFromDTO(value.plan) : null,
      status: value.status, version: value.version, createdAt: value.created_at,
      displayStatus: value.display_status ?? value.status, decidedAt: value.decided_at ?? null,
      profile: this.publicProfile(value.profile), matchId: value.match_id, archived: value.archived ?? false,
      viewerRole: value.viewer_role, match: value.match ? this.matchFromDTO(value.match) : null,
      historyContext: history ? { planTitle: history.plan_title, authorName: history.author_name,
        responderName: history.responder_name, responderAge: history.responder_age, capturedAt: history.captured_at, source: history.source } : null }
  }
  private matchFromDTO(value: MatchDTO): PairMatch {
    return { id: value.id, planId: value.plan_id, title: value.title, image: value.image, startsAt: value.starts_at,
      timeZone: value.time_zone, place: value.place, createdAt: value.created_at,
      unreadCount: value.unread_count ?? 0, archived: value.archived ?? false, meetingCancelled: value.meeting_cancelled ?? false,
      viewerRole: value.viewer_role,
      participants: value.participants.map(p => ({ role: p.role, profile: this.publicProfile(p.profile) })) }
  }

  async activity(scope: 'active' | 'archive', includeHidden: boolean, cursor?: string, planId?: string, view: 'all' | 'own' = 'all'): Promise<ActivityPage> {
    const page = await this.request<{ items: { key: string; kind: ActivityItem['kind']; plan_id: string; archived: boolean; hidden: boolean; plan: PlanDTO | null; response: ResponseDTO | null; match: MatchDTO | null; pending_response_count?: number; match_id?: string | null; history?: boolean }[]; next_cursor: string | null }>(`/me/activity?scope=${scope}&include_hidden=${includeHidden}&view=${view}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${planId ? `&plan_id=${encodeURIComponent(planId)}` : ''}`)
    return { nextCursor: page.next_cursor, items: page.items.map(item => ({ key: item.key, kind: item.kind, planId: item.plan_id,
      archived: item.archived, hidden: item.hidden, plan: item.plan ? planFromDTO(item.plan) : null,
      response: item.response ? this.responseFromDTO(item.response) : null, match: item.match ? this.matchFromDTO(item.match) : null,
      pendingResponseCount: item.pending_response_count ?? 0, matchId: item.match_id ?? null, history: item.history ?? false })) }
  }
  async navigation(): Promise<NavigationSummary> {
    const value = await this.request<{ pending_responses: number; unread_messages: number; unread_dialogs: number }>('/me/navigation')
    return { pendingResponses: value.pending_responses, unreadMessages: value.unread_messages, unreadDialogs: value.unread_dialogs }
  }
  async dialogs(cursor?: string): Promise<DialogPage> {
    const page = await this.request<{ items: { match: MatchDTO; last_message: Pick<MessageDTO, 'text' | 'sender' | 'created_at'> | null; last_activity_at: string }[]; next_cursor: string | null }>(`/me/chats${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
    return { nextCursor: page.next_cursor, items: page.items.map(value => ({ match: this.matchFromDTO(value.match), lastActivityAt: value.last_activity_at,
      lastMessage: value.last_message ? { text: value.last_message.text, sender: value.last_message.sender, createdAt: value.last_message.created_at } : null })) }
  }
  archiveVisibility(planId: string, hidden: boolean): Promise<void> {
    return this.track(() => this.request(`/me/archive/${encodeURIComponent(planId)}/visibility`, { method: 'POST', body: JSON.stringify({ hidden }) }))
  }
  private chatFromDTO(value: ChatDTO): ChatState {
    return { matchId: value.match_id, lastSequence: value.last_sequence, lastReadSequence: value.last_read_sequence,
      otherLastReadSequence: value.other_last_read_sequence, unreadCount: value.unread_count, canSend: value.can_send,
      meetingCancelled: value.meeting_cancelled, archived: value.archived }
  }
  private messageFromDTO(value: MessageDTO): ChatMessage {
    return { id: value.id, sequence: value.sequence, sender: value.sender, text: value.text, createdAt: value.created_at, clientId: value.client_id }
  }
  async chat(id: string): Promise<ChatState> { return this.chatFromDTO(await this.request(`/matches/${encodeURIComponent(id)}/chat`)) }
  async messages(id: string, direction?: { before?: number; after?: number }): Promise<MessagePage> {
    const params = new URLSearchParams()
    if (direction?.before !== undefined) params.set('before', String(direction.before))
    if (direction?.after !== undefined) params.set('after', String(direction.after))
    const page = await this.request<{ items: MessageDTO[]; next_before: number | null; has_more: boolean }>(`/matches/${encodeURIComponent(id)}/messages?${params}`)
    return { items: page.items.map(value => this.messageFromDTO(value)), nextBefore: page.next_before, hasMore: page.has_more }
  }
  sendMessage(id: string, text: string, clientId: string): Promise<ChatMessage> {
    return this.track(async () => { const value = await this.request<{ message: MessageDTO }>(`/matches/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ text, client_id: clientId }) }); return this.messageFromDTO(value.message) })
  }
  readChat(id: string, sequence: number): Promise<ChatState> {
    return this.track(async () => this.chatFromDTO(await this.request(`/matches/${encodeURIComponent(id)}/read`, { method: 'POST', body: JSON.stringify({ through_sequence: sequence }) })))
  }

  async plan(id: string): Promise<PublishedPlan> {
    const value = await this.request<{ plan: PlanDTO }>(`/plans/${encodeURIComponent(id)}`)
    return planFromDTO(value.plan)
  }
  async planAuthor(id: string): Promise<PublicProfile> {
    const value = await this.request<{ profile: PublicProfileDTO }>(`/plans/${encodeURIComponent(id)}/author`)
    return this.publicProfile(value.profile)!
  }
  async capacity(id: string): Promise<ResponseCapacity> {
    const value = await this.request<{ count: number; maximum: number; remaining: number; can_respond: boolean; own_response_id: string | null }>(`/plans/${encodeURIComponent(id)}/capacity`)
    return { count: value.count, maximum: value.maximum, remaining: value.remaining, canRespond: value.can_respond, ownResponseId: value.own_response_id }
  }
  async responses(direction: 'incoming' | 'outgoing'): Promise<PlanResponse[]> {
    const result: PlanResponse[] = []; let cursor: string | null = null
    const epoch = this.credentialEpoch
    do {
      if (epoch !== this.credentialEpoch || !this.userId) throw new ApiError('AUTH_CONTEXT_CHANGED', 'Аккаунт сменился')
      const page: { items: ResponseDTO[]; next_cursor: string | null } = await this.request(`/me/responses?direction=${direction}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      result.push(...page.items.map(value => this.responseFromDTO(value))); cursor = page.next_cursor
    } while (cursor)
    return result
  }
  async planResponses(planId: string, cursor?: string): Promise<ResponsePage> {
    const page = await this.request<{ items: ResponseDTO[]; next_cursor: string | null }>(`/plans/${encodeURIComponent(planId)}/responses?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    return { items: page.items.map(value => this.responseFromDTO(value)), nextCursor: page.next_cursor }
  }
  async matches(): Promise<PairMatch[]> {
    const result: PairMatch[] = []; let cursor: string | null = null
    const epoch = this.credentialEpoch
    do {
      if (epoch !== this.credentialEpoch || !this.userId) throw new ApiError('AUTH_CONTEXT_CHANGED', 'Аккаунт сменился')
      const page: { items: MatchDTO[]; next_cursor: string | null } = await this.request(`/me/matches?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      result.push(...page.items.map(value => this.matchFromDTO(value))); cursor = page.next_cursor
    } while (cursor)
    return result
  }
  sendResponse(plan: Plan, key: string): Promise<PlanResponse> {
    return this.track(async () => {
      const value = await this.request<{ response: ResponseDTO }>(`/plans/${plan.id}/responses`, {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ expected_plan_version: plan.serverVersion }),
      })
      return this.responseFromDTO(value.response)
    })
  }
  decideResponse(response: PlanResponse, decision: 'accept' | 'decline'): Promise<PlanResponse> {
    return this.track(async () => {
      const value = await this.request<{ response: ResponseDTO }>(`/responses/${response.id}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, expected_version: response.version }),
      })
      return this.responseFromDTO(value.response)
    })
  }
  async match(id: string): Promise<PairMatch> {
    const value = await this.request<{ match: MatchDTO }>(`/matches/${encodeURIComponent(id)}`)
    return this.matchFromDTO(value.match)
  }
  survey(id: string): Promise<SurveyState> { return this.request(`/matches/${encodeURIComponent(id)}/survey`) }
  saveFeedback(id: string, payload: FeedbackInput): Promise<SurveyState> {
    return this.track(() => this.request(`/matches/${encodeURIComponent(id)}/feedback`, { method: 'POST', body: JSON.stringify(payload) }))
  }
  reliability(): Promise<Experience> { return this.request('/me/reliability') }
  async contact(id: string): Promise<MatchContact> {
    const value = await this.request<{ available: boolean; telegram_url: string | null; reason: string | null }>(`/matches/${encodeURIComponent(id)}/contact`)
    // Контакт — только безопасная публичная ссылка Telegram, без произвольных схем/параметров.
    const url = value.telegram_url && /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(value.telegram_url) ? value.telegram_url : null
    return { available: value.available && !!url, telegramUrl: url, reason: value.reason }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const epoch = this.credentialEpoch
    if (!base) throw new ApiError('API_NOT_CONFIGURED', 'Сервер пока не подключён')
    const target = new URL(`${base.replace(/\/$/, '')}${path}`, window.location.origin)
    if (window.location.protocol === 'https:' && target.protocol !== 'https:') {
      throw new ApiError('API_HTTPS_REQUIRED', 'Для API нужен HTTPS-адрес')
    }
    const headers = new Headers(options.headers)
    // Привязка окна к ранее подтверждённому сервером аккаунту. Это не авторизация:
    // сервер по-прежнему проверяет cookie/CSRF и лишь отклоняет несовпадение.
    if (this.userId) headers.set('X-Account-Context', this.userId)
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    if (options.method && options.method !== 'GET' && this.csrf) headers.set('X-CSRF-Token', this.csrf)
    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try { response = await fetch(target, { ...options, headers, signal: controller.signal, credentials: 'include', cache: 'no-store' }) }
    catch { throw new ApiError('NETWORK_ERROR', 'Не удалось связаться с сервером. Попробуй ещё раз') }
    finally { clearTimeout(timeout) }
    if (response.status === 204) return undefined as T
    let payload: unknown
    try { payload = await response.json() } catch { throw new ApiError('API_UNAVAILABLE', 'Сервер недоступен. Проверь адрес API', response.status) }
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } })?.error
      if (response.status === 401 && epoch === this.credentialEpoch) { this.hasSession = false; this.csrf = ''; this.userId = null }
      throw new ApiError(error?.code ?? 'REQUEST_FAILED', error?.message ?? 'Не удалось выполнить запрос', response.status)
    }
    return payload as T
  }

  private track<T>(action: () => Promise<T>): Promise<T> {
    const task = action()
    this.pending.add(task)
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task))
    return task
  }

  authenticate(getRaw: () => string): Promise<AccountDTO | null> {
    const raw = getRaw()
    if (this.authFlight && this.authRaw === raw) return this.authFlight
    const previous = this.authFlight
    const epoch = ++this.credentialEpoch
    this.userId = null; this.csrf = ''; this.hasSession = false
    const task = this.track(async () => {
      // Сериализация разных запусков: запоздалый Set-Cookie от A не перекроет B.
      if (previous) await previous.catch(() => undefined)
      // Один повтор на весь вход, только при временном сбое транспорта.
      // Подпись/срок, отказ в доступе, лимиты и смена аккаунта не повторяются.
      let retryAvailable = true
      const authRequest = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
        try { return await this.request<T>(path, options) }
        catch (error) {
          const transient = error instanceof ApiError && (error.code === 'NETWORK_ERROR' || [502, 503, 504].includes(error.status))
          if (!retryAvailable || !transient || epoch !== this.credentialEpoch) throw error
          retryAvailable = false
          return this.request<T>(path, options)
        }
      }
      let account: AccountDTO
      // Cookie из другого Telegram-аккаунта не определяет пользователя запуска.
      try {
        account = raw
          ? await authRequest<AccountDTO>('/auth/telegram', { method: 'POST', body: JSON.stringify({ init_data: raw }) })
          : await authRequest<AccountDTO>('/me')
      }
      catch (error) {
        if (!raw && error instanceof ApiError && error.status === 401) return null
        throw error
      }
      if (raw) {
        // Set-Cookie может быть заблокирован браузером для стороннего API.
        // Проверяем сессию без чтения анкеты владельца старого cookie.
        let current: { user_id: string; csrf_token: string }
        try { current = await authRequest('/auth/csrf') }
        catch (error) {
          if (error instanceof ApiError && error.status === 401) throw new ApiError('SESSION_COOKIE_UNAVAILABLE', 'Не удалось сохранить сессию. Открой Mini App заново')
          throw error
        }
        if (current.user_id !== account.user.id) throw new ApiError('SESSION_CONTEXT_MISMATCH', 'Сессия другого аккаунта. Открой Mini App заново')
        account.csrf_token = current.csrf_token
      }
      this.hadSession = true
      if (epoch === this.credentialEpoch) {
        this.csrf = account.csrf_token; this.hasSession = true; this.userId = account.user.id
      }
      return account
    })
    this.authRaw = raw; this.authFlight = task
    const clear = () => { if (this.authFlight === task) { this.authFlight = null; this.authRaw = '' } }
    void task.then(clear, clear)
    return task
  }

  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  async logout(): Promise<void> {
    if (this.hadSession) {
      try {
        // Cookie мог сменить другой Telegram-запуск; завершаем текущую сессию.
        const current = await this.request<{ csrf_token: string }>('/auth/csrf')
        this.csrf = current.csrf_token
        await this.request('/auth/logout', { method: 'POST' })
      }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error }
    }
    this.clear()
  }

  clear() { this.credentialEpoch++; this.userId = null; this.csrf = ''; this.hasSession = false; this.hadSession = false; this.uploaded = new WeakMap() }

  profile(dto: ProfileDTO | null): Profile | null {
    if (!dto) return null
    const apiOrigin = new URL(base || '/api/v1', window.location.origin).origin
    return {
      userId: dto.user_id, photoId: dto.photo.id, serverVersion: dto.version,
      name: dto.name, age: String(dto.age), gender: dto.gender_code,
      preference: dto.preference_code, bio: dto.bio,
      photo: new URL(dto.photo.url, apiOrigin).toString(),
      interests: dto.interest_ids.map(id => INTEREST_CODES[id] ?? id),
    }
  }

  saveProfile(profile: Profile, file?: File | null): Promise<Profile> {
    const epoch = this.credentialEpoch, userId = this.userId
    const sameActor = () => {
      if (!userId || epoch !== this.credentialEpoch || this.userId !== userId) throw new ApiError('AUTH_CONTEXT_CHANGED', 'Аккаунт сменился. Открой анкету заново')
    }
    return this.track(async () => {
      sameActor()
      let photoId = profile.photoId
      if (file) {
        let uploaded = this.uploaded.get(file)
        if (!uploaded) {
          const form = new FormData(); form.append('file', file)
          uploaded = await this.request<PhotoDTO>('/me/photos', { method: 'POST', body: form })
          sameActor()
          this.uploaded.set(file, uploaded)
        }
        photoId = uploaded.id
      }
      if (!photoId) throw new ApiError('PHOTO_REQUIRED', 'Выбери свою фотографию')
      const interests = profile.interests.map(title => Object.keys(INTEREST_CODES).find(code => INTEREST_CODES[code] === title))
      if (interests.some(value => !value)) throw new ApiError('INTEREST_INVALID', 'Выбери интересы из списка')
      sameActor()
      const result = await this.request<{ profile: ProfileDTO }>('/me/profile', {
        method: 'PUT', body: JSON.stringify({
          expected_version: profile.serverVersion ?? 0, name: profile.name, age: Number(profile.age),
          gender_code: profile.gender, preference_code: profile.preference, bio: profile.bio,
          photo_id: photoId, interest_ids: interests,
        }),
      })
      return this.profile(result.profile)!
    })
  }

  deleteAccount(expectedUserId: string): Promise<{ deleted: boolean; media_cleanup_pending: boolean }> {
    return this.track(async () => {
      if (this.userId !== expectedUserId) throw new ApiError('AUTH_CONTEXT_CHANGED', 'Аккаунт сменился. Открой анкету заново')
      const result = await this.request<{ deleted: boolean; media_cleanup_pending: boolean }>('/me', { method: 'DELETE' })
      this.clear()
      return result
    })
  }

  async plans(own: boolean): Promise<PublishedPlan[]> {
    const epoch = this.credentialEpoch, userId = this.userId
    const result: PublishedPlan[] = []
    let cursor: string | null = null
    do {
      if (!userId || epoch !== this.credentialEpoch) throw new ApiError('AUTH_CONTEXT_CHANGED', 'Аккаунт сменился')
      const page: { items: PlanDTO[]; next_cursor: string | null } = await this.request(
        `${own ? '/me/plans' : '/plans'}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      result.push(...page.items.map(planFromDTO)); cursor = page.next_cursor
    } while (cursor)
    return result
  }

  async quota(): Promise<CreationQuota> {
    const dto = await this.request<{ used: number; remaining: number; maximum: number; day: string; time_zone: string }>('/me/quotas')
    return { used: dto.used, remaining: dto.remaining, maximum: dto.maximum, day: dto.day, timeZone: dto.time_zone, ready: true }
  }

  createPlan(plan: PlanInput, key: string): Promise<PublishedPlan> {
    return this.track(async () => {
      const result = await this.request<{ plan: PlanDTO }>('/plans', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(planFields(plan)),
      })
      return planFromDTO(result.plan)
    })
  }

  editPlan(plan: Plan, fields: PlanInput): Promise<PublishedPlan> {
    return this.track(async () => {
      const result = await this.request<{ plan: PlanDTO }>(`/plans/${plan.id}`, {
        method: 'PATCH', body: JSON.stringify({ ...planFields(fields), expected_version: plan.serverVersion }),
      })
      return planFromDTO(result.plan)
    })
  }

  planCommand(plan: Plan, command: 'publish' | 'cancel'): Promise<PublishedPlan> {
    return this.track(async () => {
      const result = await this.request<{ plan: PlanDTO }>(`/plans/${plan.id}/${command}`, {
        method: 'POST', body: JSON.stringify({ expected_version: plan.serverVersion }),
      })
      return planFromDTO(result.plan)
    })
  }
}
