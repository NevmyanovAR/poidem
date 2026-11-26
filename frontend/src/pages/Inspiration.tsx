import { useCallback, useState } from 'react'
import { PageHeading } from '../components/ui'
import { InspirationCard } from '../components/InspirationCard'
import { useResource } from '../components/admin/common'
import { useAppData } from '../state/context'

export function Inspiration() {
  const { editorial } = useAppData()
  const [offset, setOffset] = useState(0)
  const load = useCallback(() => editorial.ideas(offset), [editorial, offset])
  const resource = useResource(String(offset), load)
  return <><PageHeading eyebrow="Когда хочется чего-то особенного" title="А что, если" italic="вместе?">Места, впечатления и маленькие приключения<br />Сохрани настроение — и преврати его в план</PageHeading>
    {resource.loading && !resource.data && <p role="status">Загружаем идеи…</p>}
    {resource.error && <div role="alert"><p>{resource.error}</p><button className="text-link" onClick={resource.refresh}>Повторить загрузку</button></div>}
    {resource.data && <><div className="inspiration-grid">{resource.data.items.map((idea, i) => <InspirationCard key={idea.id} idea={idea} image={editorial.mediaUrl(idea.image)} index={offset + i} />)}</div>{!resource.data.items.length && <p>Новые идеи скоро появятся</p>}{(offset > 0 || resource.data.next_offset != null) && <div className="form-actions"><button className="button button-outline" disabled={offset === 0 || resource.loading} onClick={() => setOffset(Math.max(0, offset - 25))}>Назад</button><button className="button button-outline" disabled={resource.data.next_offset == null || resource.loading} onClick={() => setOffset(resource.data!.next_offset!)}>Далее</button></div>}</>}
  </>
}
