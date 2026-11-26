import { listSize, saveListSize } from '../lib/scrollMemory'
import { RefreshGate, useAutoRefresh } from '../lib/autoRefresh'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { useAppData } from '../state/context'
import { EmptyState, PageHeading } from '../components/ui'
import { matchPartner } from '../lib/recordActions'
import type { Dialog } from '../types'

function PartnerPhoto({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false)
  return <span className="dialog-photo">{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <UserRound aria-hidden="true" />}</span>
}
function activityLabel(value: string) {
  const date = new Date(value), now = new Date()
  return date.toLocaleDateString() === now.toLocaleDateString()
    ? date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}
export function Chats() {
  const { authorization } = useAppData()
  if (authorization.status === 'checking') return <p role="status">Загружаем чаты…</p>
  if (authorization.status !== 'verified') return <EmptyState title="Войди, чтобы открыть чаты" action="Моя анкета" to="/profile">Переписки доступны только участникам мэтча</EmptyState>
  return <DialogList key={authorization.userId} />
}
function DialogList() {
  const { loadDialogs, activityRevision, refreshNavigation } = useAppData()
  const [items, setItems] = useState<Dialog[]>([]), [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const live = useRef(false), flight = useRef(0), shown = useRef(listSize('/chats'))
  const gate = useRef(new RefreshGate())
  const invalidate = useCallback(() => { flight.current++; gate.current.invalidate() }, [])
  const refresh = useCallback((more?: string) => {
    const turn = ++flight.current
    return gate.current.run(async () => {
      if (!live.current) return
      setLoading(true)
      try {
        let next = more, following: string | null
        const result: Dialog[] = []
        do {
          const page = await loadDialogs(next)
          result.push(...page.items); following = page.nextCursor; next = following ?? undefined
        } while (!more && next && result.length < shown.current)
        if (!live.current || turn !== flight.current) return
        setItems(previous => more ? [...previous.filter(item => !result.some(entry => entry.match.id === item.match.id)), ...result] : result)
        setCursor(following); setError(''); void refreshNavigation()
      } catch (reason) { if (live.current && turn === flight.current) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить чаты') }
      finally { if (live.current && turn === flight.current) setLoading(false) }
    })
  }, [loadDialogs, refreshNavigation])
  useEffect(() => {
    live.current = true
    return () => { live.current = false; invalidate() }
  }, [refresh, invalidate])
  useAutoRefresh(() => { void refresh() }, true, activityRevision)
  return <section className="dialogs-page">
    <PageHeading eyebrow="На связи" title="Ваши" italic="разговоры" />
    {error && <p className="field-error" role="alert">{error} <button type="button" className="text-link" disabled={loading} onClick={() => void refresh()}>Повторить загрузку</button></p>}
    {!items.length && loading && <p role="status">Загружаем переписки…</p>}
    <div className="dialogs-list">{items.map(item => {
      const pair = item.match, partner = matchPartner(pair)
      return <article className="dialog-card" key={pair.id}>
        <Link className="dialog-open" to={`/match/${pair.id}/chat`} state={{ returnTo: '/chats' }}>
          <PartnerPhoto key={partner?.photo} src={partner?.photo} />
          <div className="dialog-content"><div className="dialog-heading"><h2>{partner ? <>{partner.name}<span>, {partner.age}</span></> : 'Анкета недоступна'}</h2><time dateTime={item.lastActivityAt}>{activityLabel(item.lastActivityAt)}</time></div>
            <p className="dialog-plan">{pair.title}</p>
            <div className="dialog-preview"><p>{item.lastMessage ? `${item.lastMessage.sender === 'self' ? 'Вы: ' : ''}${item.lastMessage.text}` : 'Начните общение'}</p>{pair.unreadCount > 0 && <span className="count-badge" aria-label={`Непрочитанных сообщений: ${pair.unreadCount}`}>{pair.unreadCount > 99 ? '99+' : pair.unreadCount}</span>}</div>
          </div>
        </Link>
        <Link className="text-link dialog-details" to={`/match/${pair.id}`} state={{ returnTo: '/chats' }}>О встрече</Link>
      </article>
    })}</div>
    {cursor && <button className="button button-outline" disabled={loading} onClick={() => { shown.current = items.length + 20; saveListSize('/chats', shown.current); void refresh(cursor) }}>Показать ещё</button>}
    {!items.length && !loading && !error && <EmptyState title="Здесь начнётся общение" action="Найти план" to="/catalog">Переписки появятся после первого мэтча</EmptyState>}
  </section>
}
