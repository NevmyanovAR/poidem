export const placeCategories = { cafe: 'Кафе и кофейня', restaurant: 'Ресторан', bar: 'Бар', museum: 'Музей', gallery: 'Галерея', cinema: 'Кинотеатр', theatre: 'Театр', park: 'Парк и общественное пространство', culture: 'Культурное пространство' }
export const placeStatuses = { pending: 'Ожидает модерации', approved: 'Одобрено', rejected: 'Отклонено', hidden: 'Скрыто' }
export interface PlaceFields { name: string; address: string; city: string; category: keyof typeof placeCategories }
export interface CataloguePlace extends PlaceFields { id: string; status: keyof typeof placeStatuses; version: number; category_label: string; created_at: string; updated_at: string; reviewed_at: string | null; reason: string | null; possible_duplicates?: CataloguePlace[] }
export interface CataloguePage { items: CataloguePlace[]; total: number; next_offset: number | null }

export interface PlaceCheck { id: string; plan_id: string; plan_title: string; author_name: string; name: string | null; address: string | null; legacy_place: string; status: 'pending' | 'confirmed' | 'unconfirmed'; revision: number; version: number; reason: string | null; checked_at: string | null; publication_status: string }
export interface PlaceCheckPage { items: PlaceCheck[]; total: number; next_offset: number | null }
