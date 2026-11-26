import { useCallback, useState } from 'react'
import { useAppData } from '../../state/context'
import { stamp, useResource } from './common'
import { Failure, Loading } from './States'

const actionLabels: Record<string, string> = { server_assign_role: 'Роль назначена оператором', team_role_change: 'Изменение прав сотрудника', admin_analytics_read: 'Просмотр аналитики', admin_analytics_export: 'Выгрузка CSV', admin_user_read: 'Просмотр пользователя', admin_plan_read: 'Просмотр плана', editorial_create: 'Создание идеи', editorial_edit: 'Изменение идеи', editorial_publish: 'Публикация идеи', editorial_unpublish: 'Снятие идеи с публикации', editorial_delete: 'Удаление идеи', editorial_photo: 'Замена фото идеи', dismiss: 'Жалоба рассмотрена', hide_plan: 'План скрыт', admin_dismiss: 'Жалоба рассмотрена', admin_hide_plan: 'План скрыт' }

export function AuditPanel({ user, plan }: { user?: string; plan?: string }) {
  const { admin } = useAppData()
  const [kind, setKind] = useState('changes'), [offset, setOffset] = useState(0)
  const load = useCallback(() => admin.adminAudit({ kind, offset: String(offset), ...(user ? { user } : {}), ...(plan ? { plan } : {}) }), [admin, kind, offset, user, plan])
  const resource = useResource(JSON.stringify([kind, offset, user, plan]), load)
  return <section className="admin-panel"><h2>История административных действий</h2><label>Показывать<select aria-label="Показывать" value={kind} onChange={e => { setKind(e.target.value); setOffset(0) }}><option value="changes">Значимые действия и изменения</option><option value="reads">Просмотры данных</option><option value="all">Все записи</option></select></label>{resource.error && <Failure error={resource.error} retry={resource.refresh} />}{!resource.data && resource.loading && <Loading />}{resource.data && <>{!resource.data.items.length ? <p>Записей пока нет</p> : <ol className="admin-audit">{resource.data.items.map((row, i) => <li key={row.id ?? i}><strong>{actionLabels[row.action] ?? 'Административное действие'}</strong><time>{stamp(row.occurred_at)}</time><span>{row.target}</span>{row.reason && !row.action.endsWith('_read') && <span>{row.reason}</span>}</li>)}</ol>}<div className="admin-pagination"><button className="button button-outline" disabled={offset === 0 || resource.loading} onClick={() => setOffset(Math.max(0, offset - 25))}>Назад</button><span>Страница {offset / 25 + 1}</span><button className="button button-outline" disabled={resource.data.next_offset == null || resource.loading} onClick={() => setOffset(resource.data!.next_offset!)}>Далее</button></div></>}</section>
}
