import { useCallback, useState } from 'react'
import { useAppData } from '../../state/context'
import { useAutoRefresh } from '../../lib/autoRefresh'
import { useResource } from './common'
import { Modal } from '../ui'
import { placeCategories, placeStatuses } from '../../api/places'
import type { CataloguePlace, PlaceFields } from '../../api/places'

function CataloguePanel() {
  const { places } = useAppData()
  const [state, setState] = useState('pending'), [q, setQ] = useState(''), [offset, setOffset] = useState(0)
  const [chosen, setChosen] = useState<CataloguePlace | null>(null)
  const [fields, setFields] = useState<PlaceFields>({ name: '', address: '', city: '', category: 'cafe' })
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [action, setAction] = useState<'approve' | 'reject' | 'hide' | 'edit' | 'import' | null>(null)
  const [csv, setCsv] = useState(''), [csvConfirmed, setCsvConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const load = useCallback(() => places.cataloguePlaces(state, q, offset), [places, state, q, offset])
  const resource = useResource(`${state}:${q}:${offset}`, load)
  useAutoRefresh(resource.refresh, !busy && !chosen && !action)
  async function open(id: string) {
    setBusy(true); setError(''); setMessage('')
    try { const place = await places.cataloguePlace(id); setChosen(place); setFields(place); setReason(''); setConfirmed(false) } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось открыть место') } finally { setBusy(false) }
  }
  async function submit() {
    if (busy || !action) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (action === 'import') { const result = await places.importCatalogue(csv, csvConfirmed); setMessage(`Добавлено: ${result.created} · Уже в каталоге: ${result.skipped}`); setCsv(''); setCsvConfirmed(false) }
      else if (chosen) {
        if (action === 'edit') await places.editCataloguePlace(chosen, { name: fields.name, address: fields.address, city: fields.city, category: fields.category }, reason, confirmed)
        else await places.decideCataloguePlace(chosen, action, reason, confirmed)
        setChosen(null); setMessage('Изменения сохранены')
      }
      setAction(null); resource.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить') } finally { setBusy(false) }
  }
  const canDecide = reason.trim().length >= 3
  return <section className="admin-panel"><h2>Каталог общественных мест</h2>
    <p className="small-note">Проверяй реальное существование и публичную доступность объекта. Предложение пользователя само по себе не подтверждает эти сведения</p>
    <div className="admin-filters"><label className="field">Поиск места<input value={q} maxLength={100} onChange={e => { setQ(e.target.value); setOffset(0) }} /></label><label className="field">Статус места<select value={state} onChange={e => { setState(e.target.value); setOffset(0); setChosen(null) }}><option value="">Все места</option>{Object.entries(placeStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {resource.loading && <p role="status">Загружаем места…</p>}{resource.error && <p role="alert">{resource.error}<button className="text-link" onClick={resource.refresh}>Повторить</button></p>}{error && <p role="alert" className="field-error">{error}</p>}{message && <p role="status">{message}</p>}
    {!resource.loading && resource.data?.items.length === 0 && <p>Мест в этом списке пока нет</p>}
    <div className="admin-list">{resource.data?.items.map(place => <article className="admin-panel" key={place.id}><h3>{place.name}</h3><p>{place.city}, {place.address}</p><p className="small-note">{place.category_label} · {placeStatuses[place.status]}</p><button className="text-link" disabled={busy} onClick={() => void open(place.id)}>Рассмотреть место</button></article>)}</div>
    <div className="verification-actions">{offset > 0 && <button className="text-link" onClick={() => setOffset(Math.max(0, offset - 20))}>Назад</button>}{resource.data?.next_offset != null && <button className="text-link" onClick={() => setOffset(resource.data!.next_offset!)}>Следующие места</button>}</div>
    {chosen && <section className="admin-panel"><h3>Сведения о месте</h3><p>{placeStatuses[chosen.status]}</p>
      {(chosen.possible_duplicates?.length ?? 0) > 0 && <div className="admin-panel"><strong>Возможные совпадения</strong><p className="small-note">Сравни объекты и филиалы. Они не объединяются автоматически</p>{chosen.possible_duplicates?.map(p => <p key={p.id}>{p.name} · {p.city}, {p.address} · {placeStatuses[p.status]} <button className="text-link" onClick={() => void open(p.id)}>Открыть совпадение</button></p>)}</div>}
      <div className="place-proposal-fields">{(['name', 'address', 'city'] as const).map(key => <label className="field" key={key}>{({ name: 'Название места', address: 'Адрес места', city: 'Город' })[key]}<input value={fields[key]} disabled={busy} maxLength={key === 'name' ? 160 : key === 'address' ? 240 : 100} onChange={e => setFields(current => ({ ...current, [key]: e.target.value }))} /></label>)}<label className="field">Категория места<select value={fields.category} disabled={busy} onChange={e => setFields(current => ({ ...current, category: e.target.value as PlaceFields['category'] }))}>{Object.entries(placeCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <label className="field">Причина решения или изменения<textarea value={reason} disabled={busy} maxLength={300} onChange={e => setReason(e.target.value)} /></label>
      <label className="verification-agree place-review-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Я проверил существование объекта, адрес и публичную доступность</label>
      {chosen.reason && <p className="small-note">Предыдущее решение: {chosen.reason}</p>}
      <div className="verification-actions">{chosen.status !== 'approved' && <button className="button button-primary" disabled={busy || !canDecide || !confirmed} onClick={() => setAction('approve')}>Одобрить место</button>}{chosen.status === 'pending' && <button className="button button-outline" disabled={busy || !canDecide} onClick={() => setAction('reject')}>Отклонить место</button>}{chosen.status === 'approved' && <button className="button button-outline" disabled={busy || !canDecide} onClick={() => setAction('hide')}>Скрыть место</button>}<button className="button button-outline" disabled={busy || !canDecide || chosen.status === 'approved' && !confirmed} onClick={() => setAction('edit')}>Сохранить сведения</button><button className="text-link" disabled={busy} onClick={() => setChosen(null)}>Закрыть место</button></div>
    </section>}
    <details className="admin-panel"><summary>Наполнить каталог из CSV</summary><p className="small-note">Только предварительно проверенные объекты. Существующие места не перезаписываются</p><a className="text-link" href="/templates/places.csv" download>Скачать шаблон CSV</a><label className="field">CSV с проверенными местами<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => { setError(''); const file = e.target.files?.[0]; if (!file) return; if (file.size > 65536) { setError('CSV должен быть не больше 64 КиБ'); return }; setCsv(await file.text()); setCsvConfirmed(false) }} /></label><label className="verification-agree place-review-check"><input type="checkbox" checked={csvConfirmed} onChange={e => setCsvConfirmed(e.target.checked)} />Все объекты в CSV проверены мной</label><button className="button button-outline" disabled={busy || !csv || !csvConfirmed} onClick={() => setAction('import')}>Импортировать CSV</button></details>
    {action && <Modal title={action === 'import' ? 'Импортировать проверенные места?' : 'Сохранить решение по месту?'} decoration={false} closeLabel="Отмена" onClose={() => { if (!busy) setAction(null) }}><p>{action === 'import' ? 'В каталог попадут только строки с допустимыми полями и категориями' : 'Решение будет записано в аудит. Исторические адреса планов и встреч не изменятся'}</p><button className="button button-primary" disabled={busy} onClick={() => void submit()}>Подтвердить</button>{error && <p role="alert">{error}</p>}</Modal>}
  </section>
}


export function PlacesPanel() {
  const { places } = useAppData()
  const [state, setState] = useState('pending'), [offset, setOffset] = useState(0)
  const load = useCallback(() => places.placeChecks(state, offset), [places, state, offset])
  const resource = useResource(`${state}:${offset}`, load)
  const [chosen, setChosen] = useState<import('../../api/places').PlaceCheck | null>(null), [reason, setReason] = useState(''), [evidence, setEvidence] = useState(false), [decision, setDecision] = useState<'confirmed' | 'unconfirmed' | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useAutoRefresh(resource.refresh, !chosen && !busy)
  async function submit() {
    if (!chosen || !decision || busy) return
    setBusy(true); setError('')
    try { await places.decidePlaceCheck(chosen, decision, reason, evidence); setChosen(null); setDecision(null); resource.refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить решение') }
    finally { setBusy(false) }
  }
  const labels = { pending: 'Ожидает проверки', confirmed: 'Подтверждено', unconfirmed: 'Не удалось подтвердить' }
  return <section className="admin-panel"><h2>Проверка мест</h2><p className="small-note">Необязательная сверка названия и адреса. Публикация не зависит от решения; отметка не гарантирует безопасность и часы работы</p>
    <label className="field">Статус проверки<select value={state} onChange={e => { setState(e.target.value); setOffset(0) }}>{Object.entries(labels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}<option value="">Все</option></select></label>
    {resource.loading && <p role="status">Загружаем очередь…</p>}{resource.error && <p role="alert">{resource.error}<button type="button" className="text-link" onClick={resource.refresh}>Повторить</button></p>}
    {resource.data?.items.map(value => <article className="admin-panel" key={value.id}><h3>{value.name ?? value.legacy_place}</h3>{value.address && <p>{value.address}</p>}<p>{value.plan_title} · {value.author_name}</p><div className="place-review-row-actions"><span className="small-note">{labels[value.status]}</span><button className="text-link" type="button" onClick={() => { setChosen(value); setReason(''); setEvidence(false); setError('') }}>Проверить сведения</button></div></article>)}
    {resource.data && !resource.data.items.length && <p>Нет мест с этим статусом</p>}
    <div className="plan-actions">{offset > 0 && <button type="button" className="text-link" onClick={() => setOffset(Math.max(0, offset-20))}>Назад</button>}{resource.data?.next_offset != null && <button type="button" className="text-link" onClick={() => setOffset(resource.data!.next_offset!)}>Далее</button>}</div>
    {chosen && <section className="admin-panel"><h3>{chosen.plan_title}</h3><p>Автор: {chosen.author_name}</p><p>{chosen.name ?? chosen.legacy_place}{chosen.address ? ` · ${chosen.address}` : ''}</p><label className="field">Основание решения<textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label><label className="verification-agree place-review-check"><input type="checkbox" checked={evidence} onChange={e => setEvidence(e.target.checked)} />Название и адрес сверены по доступным источникам</label><div className="plan-actions"><button type="button" className="button button-primary" disabled={busy || !evidence || reason.trim().length < 3} onClick={() => setDecision('confirmed')}>Подтвердить место</button><button type="button" className="button button-outline" disabled={busy || reason.trim().length < 3} onClick={() => setDecision('unconfirmed')}>Не удалось подтвердить</button><button className="text-link" type="button" disabled={busy} onClick={() => setChosen(null)}>Закрыть проверку</button></div></section>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {decision && <Modal title="Сохранить решение по месту?" onClose={() => { if (!busy) setDecision(null) }}><p>Решение относится к показанным названию и адресу. План продолжит работать</p><button type="button" className="button button-primary" disabled={busy} onClick={() => void submit()}>Сохранить решение</button></Modal>}
    <details><summary>Сохранённый каталог</summary><p className="small-note">Прежние сведения сохранены. Каталог и его одобрения не обязательны для новых планов и не подтверждают адрес автоматически</p><CataloguePanel /></details>
  </section>
}
