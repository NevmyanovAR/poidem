import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CATEGORIES } from '../data/catalogs'
import { EmptyState, PageHeading, PlanCard } from '../components/ui'
import { useAppData } from '../state/context'

export function Catalog() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'Все планы'
  const { publishedPlans, authorization, refreshPlans, plansLoading, plansError } = useAppData()
  useEffect(() => { if (authorization.status === 'verified') void refreshPlans() }, [authorization.status, refreshPlans])
  const filtered = publishedPlans.filter(p => category === 'Все планы' || p.category === category)
  return <><PageHeading eyebrow="Предложения для совместной встречи" title="Найти" italic="планы">Здесь появятся планы, опубликованные пользователями</PageHeading>
    <div className="filter-row" aria-label="Категории планов">{CATEGORIES.map(item => <button key={item} className={`chip ${category === item ? 'selected' : ''}`} aria-pressed={category === item} onClick={() => setParams(item === 'Все планы' ? {} : { category: item })}>{item}</button>)}</div>
    {authorization.status !== 'verified' ? <EmptyState title="Войди, чтобы увидеть планы" action="Моя анкета" to="/profile">Пользовательские планы доступны после входа через Telegram</EmptyState> : <>
    <button type="button" className="text-link" disabled={plansLoading} onClick={() => void refreshPlans()}>{plansLoading ? 'Обновляем…' : 'Обновить планы'}</button>
    {plansError && <p role="alert" className="field-error">{plansError}</p>}
    {plansLoading && !publishedPlans.length ? <p role="status">Загружаем планы…</p> : filtered.length ? <div className="plan-grid">{filtered.map(plan => <PlanCard key={plan.id} plan={plan} />)}</div> : !plansError &&
      <EmptyState title={publishedPlans.length ? 'В этой категории пока нет планов' : 'Пока нет опубликованных планов'} action="Создать первый план" to="/create">Предложи свою идею для встречи</EmptyState>}
    </>}
  </>
}
