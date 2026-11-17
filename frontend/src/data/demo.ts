import type { Category, DemoPerson, Plan, Profile } from '../types'
import { localDate } from '../lib/date'

// Static fixtures only. These are fictional profiles, not Telegram users.
// Photographs are illustrations extracted from the supplied presentation.
export const INTERESTS = ['Искусство', 'Концерты', 'Кофе', 'Бары', 'Прогулки', 'Кино', 'Еда', 'Спорт']
export const CATEGORIES: Category[] = ['Все планы', 'Искусство', 'Кофе и еда', 'Прогулки', 'Впечатления']

export const DEMO_PROFILE: Profile = {
  name: 'Маша', age: '24', gender: 'woman', preference: 'any',
  photo: '/images/portrait-anya.jpeg',
  bio: 'Собираю маленькие впечатления: хороший кофе, новые выставки и прогулки без маршрута.',
  interests: ['Искусство', 'Кофе', 'Прогулки'],
}

export const DEMO_PLANS: Plan[] = [
  { id: 'demo-gallery', title: 'Выставка, потом кофе', category: 'Искусство', date: localDate(4), time: '19:00', place: 'Галерея на Волхонке · Москва', description: 'Немного искусства, любимая картина и разговор за чашкой кофе. Без спешки и неловкого «ну, расскажи о себе».', image: '/images/gallery.jpeg', label: 'Для красивого начала' },
  { id: 'demo-dinner', title: 'Ужин без повода', category: 'Кофе и еда', date: localDate(2), time: '20:00', place: 'Cavita · Москва', description: 'Найти столик у окна, заказать что-нибудь новое и забыть посмотреть на часы.', image: '/images/dinner.jpeg', label: 'Вечер вдвоём' },
  { id: 'demo-art', title: 'Рисовать и влюбляться', category: 'Впечатления', date: localDate(5), time: '18:30', place: 'Творческая мастерская · Москва', description: 'Необязательно уметь рисовать. Достаточно любопытства, пары кисточек и хорошей компании.', image: '/images/art.jpeg', label: 'Попробовать новое' },
  { id: 'demo-coffee', title: 'Разговоры за кофе', category: 'Кофе и еда', date: localDate(1), time: '12:00', place: 'Кофейня у Патриарших · Москва', description: 'Встретиться днём, выбрать кофе и позволить разговору самому придумать продолжение.', image: '/images/coffee.jpeg', label: 'Маленький хороший план' },
  { id: 'demo-walk', title: 'Город на двоих', category: 'Прогулки', date: localDate(6), time: '15:00', place: 'Бульварное кольцо · Москва', description: 'Уйти с привычного маршрута. По дороге — красивые дворики, случайные открытия и, конечно, кофе.', image: '/images/museum.jpeg', label: 'Без спешки' },
  { id: 'demo-chess', title: 'Твой следующий ход', category: 'Впечатления', date: localDate(3), time: '19:30', place: 'Уютное кафе · Москва', description: 'Шахматы, что-нибудь вкусное и разговор между ходами. Победитель выбирает десерт.', image: '/images/chess.jpeg', label: 'Всё начинается с хода' },
]

export const DEMO_PEOPLE: DemoPerson[] = [
  { id: 'demo-sasha', name: 'Саша', age: 23, gender: 'woman', preference: 'any', photo: '/images/portrait-sasha.jpeg', bio: 'Могу долго смотреть на одну картину и спорить о том, что хотел сказать художник. А потом долго выбирать десерт.', interests: ['Искусство', 'Кофе', 'Кино'], scenarios: ['demo-gallery', 'demo-dinner', 'demo-art', 'demo-coffee'] },
  { id: 'demo-lev', name: 'Лев', age: 25, gender: 'man', preference: 'any', photo: '/images/portrait-lev.jpeg', bio: 'За прогулки без навигатора, маленькие кофейни и большие разговоры. Иногда беру с собой плёночный фотоаппарат.', interests: ['Прогулки', 'Кофе', 'Концерты'], scenarios: ['demo-gallery', 'demo-dinner', 'demo-walk', 'demo-chess', 'demo-coffee'] },
  { id: 'demo-anya', name: 'Аня', age: 22, gender: 'woman', preference: 'any', photo: '/images/portrait-anya.jpeg', bio: 'Ищу компанию для маленьких приключений. Люблю придумывать планы и делать первый шаг к чему-то новому.', interests: ['Искусство', 'Еда', 'Прогулки'], scenarios: ['demo-gallery', 'demo-art', 'demo-walk', 'demo-chess'] },
]

export const INSPIRATION = [
  { id: 'art-evening', title: 'Искусство быть рядом', subtitle: 'Красивое свидание не требует сценария. Но иногда с ним проще.', image: '/images/art.jpeg', category: 'Впечатления' as const, place: 'Творческая мастерская · Москва', planTitle: 'Арт-свидание вдвоём', tag: 'Делать что-то впервые' },
  { id: 'slow-dinner', title: 'Вечер со вкусом', subtitle: 'Приглушённый свет, любимая еда и ещё один повод задержаться.', image: '/images/wine.jpeg', category: 'Кофе и еда' as const, place: 'Cavita · Москва', planTitle: 'Вечер в Cavita', tag: 'Для разговоров обо всём' },
  { id: 'gallery-date', title: 'Смотреть в одну сторону', subtitle: 'Найти свою картину. А может быть, и своего человека.', image: '/images/gallery.jpeg', category: 'Искусство' as const, place: 'Галерея на Волхонке · Москва', planTitle: 'Вместе на выставку', tag: 'Вдохновляться вдвоём' },
]
