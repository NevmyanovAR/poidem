import { EmptyState } from '../components/ui'

// Мэтчи появятся только после подключения защищённого серверного API.
export function Match() {
  return <EmptyState title="Для встречи нужны двое" action="К моим планам" to="/plans">Совпадение не найдено. Вернись к своим планам</EmptyState>
}
