import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { returnTarget } from '../lib/navigation'
import { ArrowLeft, Send } from 'lucide-react'
import { useAppData } from '../state/context'
import { EmptyState } from '../components/ui'
import { SafetyMenu } from '../components/SafetyMenu'
import { matchPartner } from '../lib/recordActions'
import type { ChatMessage, ChatState } from '../types'

function mergeMessages(previous: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map(previous.map(message => [message.id, message]))
  next.forEach(message => byId.set(message.id, message))
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence)
}

export function Chat() {
  const { inviteId = '' } = useParams()
  const { authorization } = useAppData()
  if (authorization.status === 'checking') return <p role="status">Загружаем переписку…</p>
  if (authorization.status !== 'verified') return <EmptyState title="Войди, чтобы открыть переписку" action="Моя анкета" to="/profile">Чат доступен только участникам мэтча</EmptyState>
  return <ChatConversation key={`${authorization.userId}:${inviteId}`} id={inviteId} />
}

function ChatConversation({ id }: { id: string }) {
  const location = useLocation()
  const fromMatch = location.state?.fromMatch === true
  const backTo = returnTarget(location.state, '/chats')
  const { loadChat, loadMessages, sendMessage, readChat, matches } = useAppData()
  const currentMatch = matches.find(pair => pair.id === id)
  const partner = currentMatch ? matchPartner(currentMatch) : null
  const [state, setState] = useState<ChatState | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [before, setBefore] = useState<number | null>(null)
  const [draft, setDraft] = useState(''), [error, setError] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false), [olderLoading, setOlderLoading] = useState(false)
  const live = useRef(false), initialized = useRef(false), latest = useRef(0), polling = useRef(false), lastRead = useRef(0)
  const list = useRef<HTMLDivElement>(null), pending = useRef<{ id: string; text: string } | null>(null)
  const atBottom = () => !list.current || list.current.scrollHeight - list.current.scrollTop - list.current.clientHeight < 80
  const scrollBottom = useCallback(() => requestAnimationFrame(() => { if (live.current && list.current) list.current.scrollTop = list.current.scrollHeight }), [])
  const refresh = useCallback(async () => {
    if (polling.current || !live.current || document.visibilityState !== 'visible') return
    polling.current = true
    const shouldScroll = atBottom()
    try {
      let more = true, received: ChatMessage[] = []
      while (more && live.current) {
        const page = await loadMessages(id, initialized.current ? { after: latest.current } : undefined)
        if (!live.current) return
        received = mergeMessages(received, page.items)
        if (!initialized.current) { setBefore(page.nextBefore); more = false; initialized.current = true }
        else more = page.hasMore
        if (page.items.length) latest.current = page.items[page.items.length - 1].sequence
      }
      const current = await loadChat(id)
      if (!live.current) return
      lastRead.current = Math.max(lastRead.current, current.lastReadSequence)
      setMessages(previous => mergeMessages(previous, received)); setState(current); setError('')
      if (shouldScroll) {
        scrollBottom()
        if (latest.current > lastRead.current) {
          const read = await readChat(id, latest.current)
          if (live.current) { setState(read); lastRead.current = read.lastReadSequence }
        }
      }
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Не удалось обновить переписку') }
    finally { polling.current = false }
  }, [id, loadMessages, loadChat, readChat, scrollBottom])
  useEffect(() => {
    live.current = true
    queueMicrotask(() => { if (live.current) void refresh() })
    const interval = window.setInterval(() => void refresh(), 3000)
    const foreground = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', foreground)
    return () => { live.current = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', foreground) }
  }, [refresh])
  return <section className="chat-page">
    <div className="chat-navigation"><Link className="back-link" to={fromMatch ? `/match/${id}` : backTo} state={{ returnTo: backTo }}><ArrowLeft size={16} />{fromMatch ? 'К вашему мэтчу' : backTo === '/chats' ? 'К чатам' : 'К моим планам'}</Link>{!fromMatch && <Link className="text-link" to={`/match/${id}`} state={{ returnTo: backTo }}>О встрече</Link>}</div>
    <div className="screen-heading"><h1>Ваша <em>переписка</em></h1>{state && <SafetyMenu personName={partner?.name ?? 'участника этой переписки'} context={{ target_type: 'chat', context_type: 'match', context_id: id }} allowBlock onBlocked={() => void refresh()} />}</div>
    {state?.meetingCancelled && <p className="waiting-panel" role="status">Встреча отменена. Переписка сохранена</p>}
    {state?.archived && <p className="small-note">План в архиве. Ваша история сообщений сохранена</p>}
    {error && <div role="alert" className="field-error">{error} <button className="text-link" type="button" onClick={() => void refresh()}>Повторить загрузку</button></div>}
    {!state && !error && <p role="status">Загружаем переписку…</p>}
    <div className="chat-messages" ref={list} aria-label="История сообщений" onScroll={() => {
      if (state && atBottom() && latest.current > lastRead.current && !polling.current) void refresh()
    }}>
      {before !== null && <button className="text-link chat-older" type="button" disabled={olderLoading} onClick={async () => {
        setOlderLoading(true)
        const height = list.current?.scrollHeight ?? 0
        try {
          const page = await loadMessages(id, { before })
          if (!live.current) return
          setMessages(previous => mergeMessages(previous, page.items)); setBefore(page.nextBefore)
          requestAnimationFrame(() => { if (live.current && list.current) list.current.scrollTop += list.current.scrollHeight - height })
        } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'История недоступна') }
        finally { if (live.current) setOlderLoading(false) }
      }}>{olderLoading ? 'Загружаем…' : 'Ранние сообщения'}</button>}
      {state && !messages.length && <p className="small-note">Поздоровайтесь и договоритесь о деталях встречи</p>}
      {messages.map(message => <article className={`chat-message ${message.sender === 'self' ? 'chat-own' : ''}`} key={message.id}>
        <p>{message.text}</p><small><time dateTime={message.createdAt}>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>{message.sender === 'self' && state && message.sequence <= state.otherLastReadSequence ? ' · Прочитано' : ''}</small>
      </article>)}
    </div>
    {!!state?.unreadCount && <button className="text-link" type="button" onClick={() => { scrollBottom(); void refresh() }}>Новых сообщений: {state.unreadCount}</button>}
    <form className="chat-compose" onSubmit={async event => {
      event.preventDefault()
      if (sending || !state?.canSend || !draft.trim() || draft.length > 2000) return
      const request = pending.current?.text === draft ? pending.current : { id: crypto.randomUUID(), text: draft }
      pending.current = request
      setSending(true); setSendError('')
      try {
        const message = await sendMessage(id, request.text, request.id)
        if (!live.current) return
        setMessages(previous => mergeMessages(previous, [message])); setDraft(''); pending.current = null
        scrollBottom(); await refresh()
      } catch (reason) { if (live.current) setSendError(reason instanceof Error ? reason.message : 'Не удалось отправить. Повтори отправку') }
      finally { if (live.current) setSending(false) }
    }}>
      <label htmlFor="chat-text" className="small-note">Сообщение</label>
      <textarea id="chat-text" value={draft} maxLength={2000} rows={3} disabled={!state?.canSend || sending} placeholder="Напиши что-нибудь…" onChange={event => setDraft(event.target.value)} />
      <div className="chat-compose-actions"><span className="small-note">{draft.length} / 2000</span><button className="button button-primary" type="submit" disabled={sending || !state?.canSend || !draft.trim()}><Send size={17} />{sending ? 'Отправляем…' : 'Отправить'}</button></div>
      {sendError && <p role="alert" className="field-error">{sendError}</p>}
      {state && !state.canSend && <p className="small-note">Переписка недоступна</p>}
    </form>
  </section>
}
