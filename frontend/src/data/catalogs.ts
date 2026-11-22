import type { Category } from '../types'

export const CATEGORIES: Category[] = ['Все планы', 'Искусство', 'Кофе и еда', 'Прогулки', 'Впечатления']

// Общие неперсональные справочники формы.
export const INTEREST_CODES: Record<string, string> = {
  art: 'Искусство', concerts: 'Концерты', coffee: 'Кофе', bars: 'Бары',
  walks: 'Прогулки', cinema: 'Кино', food: 'Еда', sport: 'Спорт',
}
export const INTERESTS = Object.values(INTEREST_CODES)
