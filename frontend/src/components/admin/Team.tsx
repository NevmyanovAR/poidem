import { useCallback, useState } from 'react'
import { useAppData } from '../../state/context'
import { roleLabels } from '../../api/admin'
import type { StaffMember, StaffRole } from '../../api/admin'
import { Modal } from '../ui'
import { stamp, useResource } from './common'
import { Failure, Loading } from './States'

export function TeamPanel({ onChanged }: { onChanged: () => void }) {
  const { admin } = useAppData()
  const [filters, setFilters] = useState<Record<string, string>>({}), [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors.at(-1)
  const load = useCallback(() => admin.adminTeam(filters, cursor), [admin, filters, cursor])
  const resource = useResource(JSON.stringify([filters, cursor]), load)
  const [selected, setSelected] = useState<StaffMember | null>(null), [role, setRole] = useState<StaffRole>('user'), [reason, setReason] = useState(''), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function apply() {
    if (!selected || busy) return
    setBusy(true); setError('')
    try { await admin.adminRole(selected, role, reason.trim()); setNotice('Права сотрудника сохранены'); setConfirm(false); setSelected(null); resource.refresh(); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось изменить права') }
    finally { setBusy(false) }
  }
  return <><p className="admin-method">Сотрудники — существующие пользователи Telegram. Первый владелец назначается доверенным оператором через CLI</p>
    <form className="admin-directory-filters" onSubmit={e => { e.preventDefault(); const values = new FormData(e.currentTarget); setFilters({ q: String(values.get('q') ?? ''), role: String(values.get('role') ?? '') }); setCursors([undefined]); setSelected(null) }}><label className="admin-search">Поиск пользователя<input name="q" maxLength={100} placeholder="Имя или полный UUID" /></label><label>Роль<select name="role"><option value="">Все роли</option>{Object.entries(roleLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><button className="button button-outline">Найти</button></form>
    {notice && <p role="status">{notice}</p>}{resource.error && <Failure error={resource.error} retry={resource.refresh} />}{!resource.data && resource.loading && <Loading />}
    {resource.data && <><p>Найдено: {resource.data.total}</p><div className="admin-table-scroll" role="region" aria-label="Команда" tabIndex={0}><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Регистрация</th><th /></tr></thead><tbody>{resource.data.items.map(member => <tr key={member.id}><td>{member.name ?? 'Анкета не заполнена'}<small>{member.id}</small></td><td>{roleLabels[member.role]}</td><td>{stamp(member.created_at)}</td><td><button className="text-link" disabled={member.state !== 'active'} onClick={() => { setSelected(member); setRole(member.role); setReason(''); setError(''); setNotice('') }}>Изменить права</button></td></tr>)}</tbody></table></div>{!resource.data.items.length && <p>Пользователи не найдены</p>}<div className="admin-pagination"><button className="button button-outline" disabled={cursors.length === 1 || resource.loading} onClick={() => setCursors(values => values.slice(0, -1))}>Назад</button><span>Страница {cursors.length}</span><button className="button button-outline" disabled={!resource.data.next_cursor || resource.loading} onClick={() => setCursors(values => [...values, resource.data!.next_cursor!])}>Далее</button></div></>}
    {selected && <section className="admin-panel"><h2>Права: {selected.name ?? 'Пользователь'}</h2><p className="admin-id">{selected.id}</p><form className="admin-editor-fields" onSubmit={e => { e.preventDefault(); setConfirm(true) }}><label>Новая роль<select aria-label="Новая роль" value={role} onChange={e => setRole(e.target.value as StaffRole)}>{Object.entries(roleLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><label>Причина изменения<textarea required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label><p className="admin-method">Роль «Пользователь» отзывает доступ к кабинету. Последнего владельца снять нельзя</p><button className="button button-outline" disabled={role === selected.role || reason.trim().length < 3}>Проверить изменение</button><button className="text-link" type="button" onClick={() => setSelected(null)}>Отмена</button></form></section>}
    {confirm && selected && <Modal title="Изменить права сотрудника?" decoration={false} onClose={() => { if (!busy) setConfirm(false) }}><p>{selected.name ?? 'Пользователь'} · {selected.id}</p><p>{roleLabels[selected.role]} → {roleLabels[role]}</p><p>{reason}</p><p>Изменение вступит в силу при следующем запросе сотрудника и попадёт в журнал</p>{error && <p role="alert">{error}</p>}<button className="button button-outline" disabled={busy} onClick={() => void apply()}>{busy ? 'Сохраняем…' : 'Подтвердить изменение прав'}</button></Modal>}
  </>
}
