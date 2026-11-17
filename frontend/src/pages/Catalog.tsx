import { useSearchParams } from 'react-router-dom'
import { CATEGORIES, DEMO_PLANS } from '../data/demo'
import { EmptyState, PageHeading, PlanCard } from '../components/ui'
import { useDemo } from '../state/context'

export function Catalog() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'Все планы'
  const { selectPlan } = useDemo()
  const filtered = DEMO_PLANS.filter(p => category === 'Все планы' || p.category === category)
  return <><PageHeading eyebrow="Сначала — что делать вместе" title="Найдём ваш" italic="общий план?">Выбери то, что откликается. Компания найдётся на следующем шаге.</PageHeading><div className="filter-row" aria-label="Категории планов">{CATEGORIES.map(item => <button key={item} className={`chip ${category === item ? 'selected' : ''}`} aria-pressed={category === item} onClick={() => setParams(item === 'Все планы' ? {} : { category: item })}>{item}</button>)}</div><div className="catalog-note"><span>Москва</span><span>{filtered.length} идей для встречи</span></div>{filtered.length ? <div className="plan-grid">{filtered.map(plan => <PlanCard key={plan.id} plan={plan} onSelect={() => selectPlan(plan.id)} />)}</div> : <EmptyState title="Здесь пока тихо" action="Все планы" to="/catalog">В этой категории ещё нет планов. Попробуй другое настроение.</EmptyState>}</>
}
