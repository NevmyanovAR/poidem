import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppData } from '../../state/context'
import type { EditorialIdea, EditorialFields } from '../../api/admin'
import { CATEGORY_CODES } from '../../data/catalogs'
import { Modal } from '../ui'
import { InspirationCard } from '../InspirationCard'
import { stamp, useResource } from './common'
import { Failure, Loading } from './States'

const fieldsOf = (idea?: EditorialIdea): EditorialFields => ({ title: idea?.title ?? '', subtitle: idea?.subtitle ?? '', category_code: idea?.category_code ?? 'food', place: idea?.place ?? '', plan_title: idea?.plan_title ?? '', tag: idea?.tag ?? '', sort_order: idea?.sort_order ?? 0 })

export function EditorialPanel() {
  const { admin } = useAppData()
  const [filters, setFilters] = useState<Record<string, string>>({}), [offset, setOffset] = useState(0)
  const load = useCallback(() => admin.adminIdeas({ ...filters, offset: String(offset) }), [admin, filters, offset])
  const result = useResource(JSON.stringify([filters, offset]), load)
  const [editing, setEditing] = useState<EditorialIdea | 'new' | null>(null), [revision, setRevision] = useState(0)
  function open(idea: EditorialIdea | 'new') { setEditing(idea); setRevision(value => value + 1) }
  return <><div className="admin-toolbar"><p className="admin-method">Редакционные идеи отдельно от пользовательских планов</p><button className="button button-outline" onClick={() => open('new')}>Новая идея</button></div>
    <form className="admin-directory-filters" onSubmit={e => { e.preventDefault(); const values = new FormData(e.currentTarget); setFilters({ q: String(values.get('q') ?? ''), state: String(values.get('state') ?? '') }); setOffset(0) }}><label className="admin-search">Название идеи<input name="q" maxLength={100} /></label><label>Публикация<select name="state"><option value="">Все идеи</option><option value="draft">Черновики</option><option value="published">Опубликованные</option></select></label><button className="button button-outline">Найти</button></form>
    {result.error && <Failure error={result.error} retry={result.refresh} />}{!result.data && result.loading && <Loading />}
    {result.data && <><div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Редакционные идеи"><table><thead><tr><th>Идея / адрес</th><th>Состояние</th><th>Порядок</th><th>Обновлена</th><th /></tr></thead><tbody>{result.data.items.map(idea => <tr key={idea.id}><td><strong>{idea.title}</strong><small>{idea.id}</small></td><td>{idea.state === 'published' ? 'Опубликована' : 'Черновик'}</td><td>{idea.sort_order}</td><td>{stamp(idea.updated_at)}</td><td><button className="text-link" onClick={() => open(idea)}>Редактировать</button></td></tr>)}</tbody></table></div>{!result.data.items.length && <p>Идей с такими фильтрами нет</p>}<div className="admin-pagination"><button className="button button-outline" disabled={!offset || result.loading} onClick={() => setOffset(Math.max(0, offset - 25))}>Назад</button><span>Страница {offset / 25 + 1}</span><button className="button button-outline" disabled={result.data.next_offset == null || result.loading} onClick={() => setOffset(result.data!.next_offset!)}>Далее</button></div></>}
    {editing && <IdeaEditor key={revision} initial={editing === 'new' ? undefined : editing} onSaved={result.refresh} onClose={() => setEditing(null)} />}
  </>
}

function IdeaEditor({ initial, onSaved, onClose }: { initial?: EditorialIdea; onSaved: () => void; onClose: () => void }) {
  const { admin } = useAppData()
  const editorRef = useRef<HTMLElement>(null)
  useEffect(() => {
    editorRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true })
    editorRef.current?.scrollIntoView({ block: 'start' })
  }, [])
  const [idea, setIdea] = useState(initial), [fields, setFields] = useState(() => fieldsOf(initial)), [id, setId] = useState(initial?.id ?? `idea-${crypto.randomUUID()}`)
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [preview, setPreview] = useState(false), [action, setAction] = useState<'publish' | 'unpublish' | 'delete' | null>(null)
  const dirty = !idea || JSON.stringify(fields) !== JSON.stringify(fieldsOf(idea))
  const previewIdea: EditorialIdea = { id, state: 'draft', image: null, version: 1, created_at: '', updated_at: '', ...idea, ...fields }
  function update<K extends keyof EditorialFields>(key: K, value: EditorialFields[K]) { setFields(old => ({ ...old, [key]: value })); setNotice(''); setError('') }
  async function save() {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { const saved = idea ? await admin.adminEditIdea(idea, fields) : await admin.adminCreateIdea(id, fields); setIdea(saved); setFields(fieldsOf(saved)); setNotice('Идея сохранена'); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить идею') }
    finally { setBusy(false) }
  }
  async function upload() {
    if (!file || !idea || busy) return
    if (file.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Выбери JPG, PNG или WebP до 3 МБ'); return }
    setBusy(true); setError('')
    try { const saved = await admin.adminIdeaPhoto(idea, file); setIdea(saved); setFile(null); setNotice('Фотография сохранена'); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить фотографию') }
    finally { setBusy(false) }
  }
  async function command() {
    if (!idea || !action || busy) return
    setBusy(true); setError('')
    try { const value = await admin.adminIdeaCommand(idea, action); if ('deleted' in value) { onSaved(); onClose() } else { setIdea(value); setFields(fieldsOf(value)); setNotice(value.state === 'published' ? 'Идея опубликована' : 'Идея снята с публикации'); onSaved() }; setAction(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие') }
    finally { setBusy(false) }
  }
  return <section ref={editorRef} className="admin-panel admin-editor"><div className="admin-panel-heading"><h2>{idea ? 'Редактирование идеи' : 'Новая идея'}</h2><button className="text-link" disabled={busy} onClick={onClose}>Закрыть редактор</button></div>
    {error && !action && <p role="alert" className="field-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <form className="admin-editor-fields" onSubmit={e => { e.preventDefault(); void save() }}><fieldset disabled={busy} className="admin-control-fieldset">
      <label>Адрес идеи<input aria-label="Адрес идеи" aria-describedby="idea-address-hint" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} disabled={!!idea} value={id} onChange={e => setId(e.target.value)} /><small id="idea-address-hint">Существующий адрес сохраняется для прежних ссылок</small></label>
      <label>Название<input required maxLength={80} value={fields.title} onChange={e => update('title', e.target.value)} /></label>
      <label>Описание<textarea maxLength={500} value={fields.subtitle} onChange={e => update('subtitle', e.target.value)} /></label>
      <label>Категория<select value={fields.category_code} onChange={e => update('category_code', e.target.value)}>{Object.entries(CATEGORY_CODES).map(([label, code]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label>Место<input maxLength={160} value={fields.place} onChange={e => update('place', e.target.value)} /></label>
      <label>Название будущего плана<input maxLength={80} value={fields.plan_title} onChange={e => update('plan_title', e.target.value)} /></label>
      <label>Подпись на фотографии<input maxLength={80} value={fields.tag} onChange={e => update('tag', e.target.value)} /></label>
      <label>Порядок отображения<input aria-label="Порядок отображения" aria-describedby="idea-order-hint" type="number" min={0} max={1000000} step={1} required value={fields.sort_order} onChange={e => update('sort_order', Number(e.target.value))} /><small id="idea-order-hint">Меньшее число — раньше; при равенстве сортировка по адресу</small></label>
      <p className="admin-method">{idea?.state === 'published' ? 'Сохранённые изменения и замена фото опубликованной идеи сразу видны пользователям' : 'Сохранение оставляет идею в черновиках до явной публикации'}</p>
      <button className="button button-outline" disabled={!dirty}>Сохранить{idea?.state !== 'published' ? ' черновик' : ' изменения'}</button>
    </fieldset></form>
    {idea ? <div className="admin-editor-photo"><label>Фотография идеи<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={e => { setFile(e.target.files?.[0] ?? null); setError('') }} /></label><button className="button button-outline" disabled={!file || busy} onClick={() => void upload()}>Загрузить фотографию</button><p className="admin-method">JPG, PNG или WebP до 3 МБ. Сервер проверяет содержимое и удаляет метаданные</p></div> : <p className="admin-method">Сначала сохрани черновик, затем загрузи фотографию</p>}
    <div className="admin-editor-actions"><button className="button button-outline" disabled={busy} onClick={() => setPreview(value => !value)}>{preview ? 'Скрыть предпросмотр' : 'Предпросмотр'}</button>{idea && <><button className="button button-outline" disabled={busy || dirty} onClick={() => { setError(''); setAction(idea.state === 'published' ? 'unpublish' : 'publish') }}>{idea.state === 'published' ? 'Снять с публикации' : 'Опубликовать'}</button><button className="text-link" disabled={busy} onClick={() => { setError(''); setAction('delete') }}>Удалить идею</button></>}</div>
    {preview && <div className="admin-editor-preview"><p className="admin-method">Предварительный вид{dirty ? ' · есть несохранённые изменения' : ''}</p><InspirationCard idea={previewIdea} image={admin.mediaUrl(previewIdea.image)} preview /></div>}
    {action && idea && <Modal title={{ publish: 'Опубликовать идею?', unpublish: 'Снять идею с публикации?', delete: 'Удалить редакционную идею?' }[action]} decoration={false} onClose={() => { if (!busy) setAction(null) }}><p>{idea.title}</p><p>{action === 'delete' ? 'Идея и её загруженная фотография будут удалены. Пользовательские планы сохранят свои сведения; прежняя ссылка на идею станет недоступна' : action === 'publish' ? 'Идея появится в разделе «Вдохновение»' : 'Идея останется в черновиках и перестанет отображаться пользователям'}</p>{error && <p role="alert">{error}</p>}<button className="button button-outline" disabled={busy} onClick={() => void command()}>{busy ? 'Сохраняем…' : 'Подтвердить'}</button></Modal>}
  </section>
}
