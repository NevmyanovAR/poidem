import { useCallback, useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { useAppData } from '../../state/context'
import type { AdminPeriod, AnalyticsReport } from '../../api/admin'
import { number, range, stamp, useResource } from './common'
import { Failure, Loading } from './States'

export function AnalyticsPanel({ detailed, period, onPeriod, onModeration }: { detailed: boolean; period: AdminPeriod; onPeriod: (period: AdminPeriod) => void; onModeration?: () => void }) {
  const { admin } = useAppData()
  const load = useCallback(() => admin.adminAnalytics(period), [admin, period])
  const report = useResource(JSON.stringify(period), load)
  const [draft, setDraft] = useState(period), [exporting, setExporting] = useState(false), [error, setError] = useState('')
  const data = report.data
  async function download() {
    if (exporting) return
    setExporting(true); setError('')
    try {
      const exported = await admin.adminExport(period)
      report.replace(exported.report)
      const url = URL.createObjectURL(new Blob([exported.csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = exported.filename; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось выгрузить CSV') }
    finally { setExporting(false) }
  }
  return <><fieldset className="admin-control-fieldset" disabled={exporting}>
    <div className="admin-toolbar"><div className="admin-presets" aria-label="Период аналитики">{[7, 30, 90].map(days => <button type="button" key={days} className={period.start_date === range(days).start_date && period.end_date === range(days).end_date ? 'selected' : ''} onClick={() => { const next = range(days); setDraft(next); onPeriod(next) }}>{days} дней</button>)}</div><button className="button button-outline admin-export" disabled={!data || exporting || report.loading} onClick={() => void download()}><Download size={16} />{exporting ? 'Готовим CSV…' : 'Экспорт CSV'}</button></div>
    <form className="admin-period" onSubmit={event => { event.preventDefault(); onPeriod(draft) }}><label>С<input type="date" required value={draft.start_date} max={draft.end_date} onChange={event => setDraft({ ...draft, start_date: event.target.value })} /></label><label>По<input type="date" required value={draft.end_date} min={draft.start_date} max={range(1).end_date} onChange={event => setDraft({ ...draft, end_date: event.target.value })} /></label><button className="button button-outline" type="submit">Применить</button><span>Europe/Moscow · до 366 дней</span></form>
    </fieldset>
    {(report.error || error) && <Failure error={report.error || error} retry={report.error ? report.refresh : () => void download()} />}
    {report.loading && !data && <Loading cards count={detailed ? 12 : 8} />}
    {data && <>
      <div className="admin-snapshot"><span>Снимок {stamp(data.generated_at)}</span><button className="text-link" disabled={report.loading} onClick={report.refresh}>{report.loading ? 'Обновляем…' : 'Обновить'}</button></div>
      <div className="admin-metrics">{data.metrics.filter(metric => detailed || !['retention', 'accepted_rate', 'plans_response_rate', 'pending_reports', 'published_response_rate_now'].includes(metric.id)).map(metric => <article className="admin-metric" key={metric.id}><h2>{metric.label}</h2><strong className={metric.value == null ? 'is-unavailable' : ''}>{metric.data_status === 'incomplete' ? 'Неполные данные' : number(metric.value)}{metric.value != null && metric.unit === '%' ? '%' : ''}</strong>{metric.change_percent != null ? <p>{metric.change_percent > 0 ? '+' : ''}{number(metric.change_percent)}% <span>к предыдущему периоду</span></p> : metric.previous != null ? <p>Предыдущий: {number(metric.previous)}</p> : null}{metric.reason && <small>{metric.reason}</small>}<details><summary>Как считается</summary><p>{metric.definition}</p></details></article>)}</div>
      {!detailed && onModeration && <button className="admin-attention" onClick={onModeration}><ShieldCheck size={20} /><span><strong>Очередь модерации · {number(data.metrics.find(metric => metric.id === 'pending_reports')?.value ?? null)}</strong><small>Открыть жалобы, требующие рассмотрения</small></span><span aria-hidden="true">→</span></button>}
      <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Аудитория по дням</h2><p>Регистрации и пользователи с действиями · {period.time_zone}</p></div></div><AudienceChart rows={data.daily} /></section>
      {detailed && <div className="admin-analysis-grid">
        <section className="admin-panel"><h2>Воронка знакомств</h2><p className="admin-method">{data.funnel.basis}</p><div className="admin-funnel">{data.funnel.stages.map((stage, i) => <div key={stage.label}><div><span>{stage.label}</span><strong>{stage.value == null && data.collection_started_at ? 'Неполные данные' : number(stage.value)}</strong></div><div className="admin-bar"><span style={{ width: `${stage.value == null ? 0 : 100 * stage.value / Math.max(1, ...data.funnel.stages.map(row => row.value ?? 0))}%` }} /></div>{i > 0 && <small>{stage.conversion == null ? 'Конверсия: нет данных' : `${number(stage.conversion)}% · ${stage.numerator} / ${stage.denominator}`}</small>}</div>)}</div><p className="admin-method">Учёт просмотров с {stamp(data.collection_started_at)}</p><p className="admin-method">Единица: {data.funnel.unit}. {data.funnel.note}</p></section>
        <section className="admin-panel"><h2>Итоги встреч</h2><p className="admin-method">По времени встречи в периоде, после открытия опроса (+2 часа)</p><div className="admin-breakdown">{data.meetings.map(row => <div key={row.id}><span>{{ mutual_yes: 'Оба подтвердили', mutual_no: 'Оба ответили «Нет»', conflicting: 'Ответы не совпали', insufficient: 'Ответил один участник', no_data: 'Нет завершённых ответов' }[row.id] ?? row.id}</span><strong>{number(row.value)}</strong></div>)}</div><p className="admin-method">Самоотчёты участников. Отсутствие ответа не означает неявку. Число встреч отличается от числа уникальных партнёров</p></section>
        <section className="admin-panel"><h2>Планы по категориям</h2>{!data.categories.length ? <p>За период нет созданных планов</p> : data.categories.map(category => <div className="admin-category" key={category.code}><div><span>{category.label}</span><strong>{number(category.value)}</strong></div><div className="admin-bar"><span style={{ width: `${100 * category.value / Math.max(1, ...data.categories.map(row => row.value))}%` }} /></div></div>)}</section>
        <section className="admin-panel"><h2>Границы данных</h2><p>Новый учёт: {stamp(data.collection_started_at)}</p><ul>{data.limitations.map(note => <li key={note}>{note}</li>)}</ul><p>Сопоставимый предыдущий период: {stamp(data.period.previous_from)} — {stamp(data.period.previous_to_exclusive)}</p></section>
      </div>}
      <details className="admin-methodology"><summary>Определения и источники всех показателей</summary>{data.metrics.map(metric => <p key={metric.id}><strong>{metric.label}:</strong> {metric.definition}</p>)}</details>
    </>}
  </>
}

function AudienceChart({ rows }: { rows: AnalyticsReport['daily'] }) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, rows.length - 1), chosen = rows[index]
  const maximum = Math.max(1, ...rows.flatMap(row => [row.registrations, row.active_users]))
  const x = (i: number) => 35 + 630 * i / Math.max(1, rows.length - 1)
  const y = (value: number) => 165 - 135 * value / maximum
  if (!chosen) return <p>Нет данных за выбранный период</p>
  return <div className="admin-chart"><div className="admin-chart-legend"><span className="series-registration">Регистрации</span><span className="series-active">Активные по действиям</span></div><svg viewBox="0 0 700 190" role="img" aria-label="Динамика регистраций и действий по дням" onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); setSelected(Math.max(0, Math.min(rows.length - 1, Math.round(((event.clientX - box.left) / box.width * 700 - 35) / 630 * (rows.length - 1))))) }}>
    {[0, maximum].map(value => <g key={value}><line x1="35" y1={y(value)} x2="665" y2={y(value)} className="chart-grid" /><text x="4" y={y(value) + 4}>{value}</text></g>)}
    <polyline className="series-registration-line" points={rows.map((row, i) => `${x(i)},${y(row.registrations)}`).join(' ')} /><polyline className="series-active-line" points={rows.map((row, i) => `${x(i)},${y(row.active_users)}`).join(' ')} />
    <line className="chart-selector" x1={x(index)} x2={x(index)} y1="20" y2="165" /><circle cx={x(index)} cy={y(chosen.registrations)} r="4" className="series-registration-dot" /><circle cx={x(index)} cy={y(chosen.active_users)} r="4" className="series-active-dot" />
    <text x="35" y="186">{rows[0].date}</text><text x="665" y="186" textAnchor="end">{rows.at(-1)?.date}</text>
  </svg><label className="admin-chart-slider">День на графике<input type="range" min="0" max={rows.length - 1} value={index} onChange={event => setSelected(Number(event.target.value))} /></label><output aria-live="polite">{chosen.date} · Регистрации: {number(chosen.registrations)} · Активные: {number(chosen.active_users)}</output></div>
}
