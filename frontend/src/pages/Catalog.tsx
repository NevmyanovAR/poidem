import { useSearchParams } from 'react-router-dom'
import { CATEGORIES } from '../data/demo'
import { EmptyState, PageHeading, PlanCard } from '../components/ui'
import { useDemo } from '../state/context'

export function Catalog() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'Все планы'
  const { publishedPlans, selectPlan, fixtureMode } = useDemo()
  const filtered = publishedPlans.filter(p => category === 'Все планы' || p.category === category)
  return <><PageHeading eyebrow="Предложения для совместной встречи" title="Найти" italic="планы">{fixtureMode ? 'Вымышленные планы для знакомства с приложением' : 'Здесь появятся планы, опубликованные пользователями'}</PageHeading>
    <div className="filter-row" aria-label="Категории планов">{CATEGORIES.map(item => <button key={item} className={`chip ${category === item ? 'selected' : ''}`} aria-pressed={category === item} onClick={() => setParams(item === 'Все планы' ? {} : { category: item })}>{item}</button>)}</div>
    {filtered.length ? <div className="plan-grid">{filtered.map(plan => <PlanCard key={plan.id} plan={plan} onSelect={() => selectPlan(plan.id)} />)}</div> :
      <EmptyState title={publishedPlans.length ? 'В этой категории пока нет планов' : 'Пока нет опубликованных планов'} action="Создать первый план" to="/create">Предложи свою идею для встречи</EmptyState>}
  </>
}
