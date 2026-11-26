import { useAutoRefresh } from '../lib/autoRefresh'
import { useSearchParams } from 'react-router-dom'
import { CATEGORIES } from '../data/catalogs'
import { EmptyState, PageHeading, PlanCard } from '../components/ui'
import { useAppData } from '../state/context'

export function Catalog() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'Все планы'
  const { publishedPlans, authorization, refreshPlans, plansLoading, plansError } = useAppData()
  useAutoRefresh(() => { void refreshPlans() }, authorization.status === 'verified')
  const filtered = publishedPlans.filter(p => category === 'Все планы' || p.category === category)
  return <><PageHeading eyebrow="Предложения для совместной встречи" title="Найти" italic="планы">Здесь появятся планы, опубликованные пользователями</PageHeading>
    <div className="filter-row" aria-label="Категории планов">{CATEGORIES.map(item => <button key={item} className={`chip ${category === item ? 'selected' : ''}`} aria-pressed={category === item} onClick={() => setParams(item === 'Все планы' ? {} : { category: item })}>{item}</button>)}</div>
    {authorization.status !== 'verified' ? <EmptyState title="Войди, чтобы увидеть планы" action="Моя анкета" to="/profile">Пользовательские планы доступны после входа через Telegram</EmptyState> : <>
    {plansError && <p role="alert" className="field-error">{plansError} <button type="button" className="text-link" disabled={plansLoading} onClick={() => void refreshPlans()}>Повторить загрузку</button></p>}
    {plansLoading && !publishedPlans.length ? <p role="status">Загружаем планы…</p> : filtered.length ? <div className="plan-grid">{filtered.map(plan => <PlanCard key={plan.id} plan={plan} />)}</div> : !plansError &&
      <EmptyState title={publishedPlans.length ? 'В этой категории пока нет планов' : 'Пока нет опубликованных планов'} action="Создать первый план" to="/create">Предложи свою идею для встречи</EmptyState>}
    </>}
  </>
}
