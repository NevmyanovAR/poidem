import { INTEREST_CODES } from '../data/catalogs'
import type { Profile } from '../types'

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
export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 0) { super(message); this.code = code; this.status = status }
}

const configured = import.meta.env.VITE_API_BASE_URL?.trim()
const base = configured || (import.meta.env.DEV ? '/api/v1' : '')

export class ApiClient {
  private csrf = ''
  private authFlight: Promise<AccountDTO | null> | null = null
  private authRaw = ''
  private pending = new Set<Promise<unknown>>()
  private uploaded = new WeakMap<File, PhotoDTO>()
  hasSession = false
  private hadSession = false
  private credentialEpoch = 0
  userId: string | null = null

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const epoch = this.credentialEpoch
    if (!base) throw new ApiError('API_NOT_CONFIGURED', 'Сервер пока не подключён')
    const target = new URL(`${base.replace(/\/$/, '')}${path}`, window.location.origin)
    if (window.location.protocol === 'https:' && target.protocol !== 'https:') {
      throw new ApiError('API_HTTPS_REQUIRED', 'Для API нужен HTTPS-адрес')
    }
    const headers = new Headers(options.headers)
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
}
