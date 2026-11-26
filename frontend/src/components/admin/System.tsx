import { useCallback, useState } from 'react'
import { useAppData } from '../../state/context'
import { number, stamp, useResource } from './common'
import { Failure, Loading } from './States'
import { AuditPanel } from './Audit'

export function SystemPanel() {
  const { admin } = useAppData()
  const load = useCallback(() => admin.adminSystem(), [admin])
  const resource = useResource('system', load), data = resource.data
  const [category, setCategory] = useState(''), [offset, setOffset] = useState(0)
  const loadJobs = useCallback(() => admin.adminNotifications({ ...(category ? { category } : {}), offset: String(offset) }), [admin, category, offset])
  const jobs = useResource(`${category}:${offset}`, loadJobs)
  return <><button className="button button-outline" disabled={resource.loading || jobs.loading} onClick={() => { resource.refresh(); jobs.refresh() }}>Обновить состояние</button>
    {resource.error && <Failure error={resource.error} retry={resource.refresh} />}{!data && resource.loading && <Loading cards />}
    {data && <><p className="admin-snapshot">Проверено: {stamp(data.checked_at)}</p><div className="admin-metrics"><article className="admin-metric"><h2>API / PostgreSQL</h2><strong>Доступны</strong><small>Успешный ответ и запрос к БД сейчас</small></article>{['polling', 'worker'].map(key => <article className="admin-metric" key={key}><h2>{key === 'polling' ? 'Telegram-бот' : 'Обработчик уведомлений'}</h2><strong className={data.heartbeat?.[key]?.state === 'ok' ? '' : 'is-unavailable'}>{data.heartbeat?.[key]?.label ?? 'Нет данных'}</strong><small>Последний heartbeat: {stamp(data.heartbeat?.[key]?.last_seen_at ?? null)}</small></article>)}<article className="admin-metric"><h2>Последняя доставка</h2><p>{stamp(data.last_sent_at)}</p><small>Не заменяет heartbeat процесса</small></article></div>
      <details className="admin-methodology"><summary>Как проверяется состояние бота</summary><p>{data.worker_explanation}</p></details>
      <section className="admin-panel"><h2>Очередь уведомлений</h2><div className="admin-breakdown">{(data.categories ?? []).map(row => <div key={row.id}><button className="text-link" onClick={() => { setCategory(row.id); setOffset(0) }}>{row.label}</button><strong>{number(row.count)}</strong></div>)}</div><p>{data.oldest_due_at ? `Самое раннее задание, срок которого наступил: ${stamp(data.oldest_due_at)}` : 'Нет ожидающих задач с наступившим сроком отправки'}</p><p>Заданий с истёкшим сроком обработки: {data.expired_leases ?? 0}</p>{data.errors.map(row => <p key={row.code}>{row.code}: {row.count}</p>)}<p className="admin-method">Доставленные и намеренно пропущенные задачи не отправляются повторно</p></section>
    </>}
    <section className="admin-panel"><h2>Задачи уведомлений</h2><label>Категория<select value={category} onChange={e => { setCategory(e.target.value); setOffset(0) }}><option value="">Все задачи</option>{(data?.categories ?? []).map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>{jobs.error && <Failure error={jobs.error} retry={jobs.refresh} />}{jobs.loading && !jobs.data && <Loading />}{jobs.data && <><p>Найдено: {jobs.data.total}</p><div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Задачи уведомлений"><table><thead><tr><th>Тип</th><th>Создано / отправка</th><th>Состояние</th><th>Причина</th><th>Попытки</th></tr></thead><tbody>{jobs.data.items.map(row => <tr key={row.id}><td>{row.kind}</td><td>{stamp(row.created_at)}<small>Назначено: {stamp(row.due_at)}</small>{row.sent_at && <small>Отправлено: {stamp(row.sent_at)}</small>}</td><td>{row.state_label}{row.overdue && <small>Срок наступил — требуется проверка обработчика</small>}</td><td>{row.reason}</td><td>{row.attempts}</td></tr>)}</tbody></table></div>{!jobs.data.items.length && <p>Задач с такими условиями нет</p>}<div className="admin-pagination"><button className="button button-outline" disabled={offset === 0 || jobs.loading} onClick={() => setOffset(Math.max(0, offset - 25))}>Назад</button><span>Страница {offset / 25 + 1}</span><button className="button button-outline" disabled={jobs.data.next_offset == null || jobs.loading} onClick={() => setOffset(jobs.data!.next_offset!)}>Далее</button></div></>}</section>
    <AuditPanel />
  </>
}
