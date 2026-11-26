import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { EditorialIdea } from '../api/admin'
import { CATEGORY_CODES } from '../data/catalogs'
import { Photo } from './ui'

export function InspirationCard({ idea, image, index = 0, preview = false }: { idea: EditorialIdea; image: string; index?: number; preview?: boolean }) {
  const category = Object.entries(CATEGORY_CODES).find(([, code]) => code === idea.category_code)?.[0] ?? idea.category_code
  const picture = <><Photo src={image || '/fallback.svg'} alt={idea.title} eager={index === 0} />{idea.tag && <span className="photo-tag">{idea.tag}</span>}{!preview && <span className="photo-arrow"><ArrowUpRight size={21} /></span>}</>
  return <article className={`inspiration-card inspiration-${index}`}>
    {preview ? <div className="inspiration-photo">{picture}</div> : <Link className="inspiration-photo" to={`/create?idea=${idea.id}`} aria-label={`Создать план: ${idea.title}`}>{picture}</Link>}
    <div className="inspiration-copy"><span className="eyebrow">{String(index + 1).padStart(2, '0')} / {category}</span><h2>{idea.title}</h2><p>{idea.subtitle}</p>{!preview && <Link className="text-link" to={`/create?idea=${idea.id}`}>Создать план здесь<ArrowUpRight size={18} /></Link>}</div>
  </article>
}
