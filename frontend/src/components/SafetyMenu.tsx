import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Flag, MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './ui'
import { useAppData } from '../state/context'
import { reportReasons } from '../api/safety'
import type { ReportReason, SafetyContext } from '../api/safety'

export function SafetyMenu({ context, allowBlock = false, onBlocked, label = 'Действия безопасности', personName }: { context: SafetyContext; allowBlock?: boolean; onBlocked?: () => void; label?: string; personName?: string }) {
  const { safety, notify, refreshPlans, refreshConnections } = useAppData()
  const navigate = useNavigate(), id = useId()
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null)
  const fromEnd = useRef(false)
  const [open, setOpen] = useState(false), [dialog, setDialog] = useState<'report' | 'block' | null>(null)
  const [reason, setReason] = useState<ReportReason>('content'), [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const closeMenu = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }, [])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const panel = popup.current, button = trigger.current, layer = overlay.current
      if (!panel || !button || !layer) return
      const view = window.visualViewport
      const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight
      const x = view?.offsetLeft ?? 0, y = view?.offsetTop ?? 0
      const padding = getComputedStyle(layer), mobile = innerWidth <= 680
      const left = x + parseFloat(padding.paddingLeft), right = x + width - parseFloat(padding.paddingRight)
      const top = y + parseFloat(padding.paddingTop)
      const navigation = document.querySelector<HTMLElement>('.mobile-nav')?.getBoundingClientRect()
      const bottom = Math.min(y + height, navigation?.height ? navigation.top : y + height) - parseFloat(padding.paddingBottom)
      const size = Math.min(mobile ? 360 : 232, right - left)
      panel.style.width = `${size}px`; panel.style.maxHeight = `${Math.max(80, bottom - top)}px`
      const rect = button.getBoundingClientRect(), panelHeight = panel.getBoundingClientRect().height
      panel.style.left = `${mobile ? left + (right - left - size) / 2 : Math.max(left, Math.min(rect.right - size, right - size))}px`
      panel.style.top = `${mobile ? Math.max(top, bottom - panelHeight) : Math.max(top, Math.min(rect.bottom + 8, bottom - panelHeight))}px`
      panel.style.visibility = 'visible'
    }
    place()
    const items = popup.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')
    items?.[fromEnd.current ? items.length - 1 : 0]?.focus({ preventScroll: true })
    const scrolled = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) closeMenu() }
    window.addEventListener('resize', place); window.addEventListener('scroll', scrolled, true)
    window.visualViewport?.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scrolled, true); window.visualViewport?.removeEventListener('resize', place) }
  }, [open, closeMenu])
  function choose(value: 'report' | 'block') { closeMenu(); setError(''); setDialog(value) }
  return <div className="safety-menu">
    <button ref={trigger} type="button" className="quiet-button safety-trigger" aria-label={label} aria-expanded={open} aria-haspopup="menu" aria-controls={open ? `${id}-menu` : undefined} disabled={busy} onClick={() => { fromEnd.current = false; setOpen(value => !value) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); fromEnd.current = event.key === 'ArrowUp'; setOpen(true) } }}><MoreHorizontal size={21} /></button>
    {open && createPortal(<div ref={overlay} className="safety-overlay" onPointerDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); closeMenu() } }}>
      <div ref={popup} id={`${id}-menu`} role="menu" aria-label={label} className="safety-popup" style={{ visibility: 'hidden' }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return }
        if (event.key === 'Tab') { closeMenu(); return }
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]')]
        const position = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (position + 1) % items.length : event.key === 'ArrowUp' ? (position + items.length - 1) % items.length : -1
        if (next >= 0) { event.preventDefault(); items[next]?.focus({ preventScroll: true }) }
      }}><button type="button" role="menuitem" onClick={() => choose('report')}><Flag size={18} />Пожаловаться</button>{allowBlock && <button type="button" role="menuitem" onClick={() => choose('block')}><Ban size={18} />Заблокировать</button>}</div>
    </div>, document.body)}
    {dialog && <Modal title={dialog === 'report' ? 'Пожаловаться' : `Заблокировать ${personName || 'участника'}?`} className="safety-dialog" decoration={false} closeLabel="Отмена" onClose={() => { if (!busy) setDialog(null) }}>
      {dialog === 'report' ? <form className="safety-form" onSubmit={async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError('')
        try { await safety.report(context, reason, comment); setDialog(null); setComment(''); notify('Жалоба отправлена') }
        catch (error) { setError(error instanceof Error ? error.message : 'Не удалось отправить жалобу') }
        finally { setBusy(false) }
      }}><label htmlFor={`${id}-reason`}>Причина</label><select id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value as ReportReason)}>{Object.entries(reportReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label htmlFor={`${id}-comment`}>Комментарий · необязательно</label><textarea id={`${id}-comment`} rows={3} maxLength={1000} value={comment} onChange={event => setComment(event.target.value)} /><button type="submit" className="button button-outline" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить жалобу'}</button></form> : <><p>Вы больше не сможете обмениваться сообщениями и откликами внутри «Пойдём?»</p><button type="button" className="button button-outline" disabled={busy} onClick={async () => {
        if (busy) return; setBusy(true); setError('')
        try {
          await safety.block(context); setDialog(null); notify('Участник заблокирован')
          void refreshPlans(); void refreshConnections()
          if (onBlocked) onBlocked(); else if (context.context_type === 'plan') navigate('/catalog', { replace: true })
        } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось заблокировать') }
        finally { setBusy(false) }
      }}>{busy ? 'Сохраняем…' : 'Заблокировать'}</button></>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>}
  </div>
}
