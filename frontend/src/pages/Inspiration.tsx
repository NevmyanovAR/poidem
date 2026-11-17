import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { INSPIRATION } from '../data/demo'
import { PageHeading, Photo } from '../components/ui'

export function Inspiration() {
  return <><PageHeading eyebrow="Когда хочется чего-то особенного" title="А что, если" italic="вместе?">Места, впечатления и маленькие приключения.<br />Сохрани настроение — и преврати его в план.</PageHeading><div className="inspiration-grid">{INSPIRATION.map((idea, i) => <article className={`inspiration-card inspiration-${i}`} key={idea.id}><div className="inspiration-photo"><Photo src={idea.image} alt={idea.title} eager={i === 0} /><span className="photo-tag">{idea.tag}</span></div><div className="inspiration-copy"><span className="eyebrow">0{i + 1} / {idea.category}</span><h2>{idea.title}</h2><p>{idea.subtitle}</p><Link className="text-link" to={`/create?idea=${idea.id}`}>Создать план здесь<ArrowUpRight size={18} /></Link></div></article>)}</div></>
}
