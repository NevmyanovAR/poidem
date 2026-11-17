import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand, Glasses, Photo } from '../components/ui'

export function Welcome() {
  return <div className="welcome"><div className="welcome-photo"><Photo src="/images/gallery.jpeg" alt="Двое в художественной галерее — иллюстрация из презентации" eager /><div className="welcome-photo-caption"><span>Меньше переписок.</span><em>Больше историй.</em></div></div>
    <div className="welcome-body"><div className="welcome-top"><Brand to="/" /><span className="age-badge">18+</span></div><div className="welcome-copy"><Glasses className="welcome-glasses" /><span className="eyebrow">Знакомства по сценарию</span><h1>Всё начинается<br />с простого<br /><em>«пойдём?»</em></h1><p>Сначала выбери, что делать вместе.<br />А потом — с кем разделить этот момент.</p><Link className="button button-primary" to="/profile">Начать знакомство <ArrowRight size={20} /></Link><Link className="welcome-secondary-link" to="/home">Посмотреть планы <ArrowRight size={16} /></Link></div></div>
  </div>
}
