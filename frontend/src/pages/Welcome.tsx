import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Glasses, Photo } from '../components/ui'

export function Welcome() {
  return <div className="welcome"><div className="welcome-photo"><Photo src="/images/gallery.jpeg" alt="Двое в художественной галерее — иллюстрация из презентации" eager /></div>
    <div className="welcome-body"><div className="welcome-top"><Link className="brand welcome-brand" to="/" aria-label="Пойдём? — на главную"><picture><source media="(min-width: 681px)" srcSet="/brand/logo_full.png" width={1774} height={887} /><img src="/brand/logo_text.png" width={2048} height={682} alt="Пойдём? — знакомства по сценарию" /></picture></Link><span className="age-badge">18+</span></div><div className="welcome-copy"><Glasses className="welcome-glasses" /><h1>Всё начинается<br />с простого<br /><em>«пойдем?»</em></h1><p>Сначала выбери, что делать вместе<br />А потом — с кем разделить этот момент</p><Link className="button button-primary" to="/profile">Начать знакомство <ArrowRight size={20} /></Link><Link className="welcome-secondary-link" to="/home">Посмотреть планы <ArrowRight size={16} /></Link></div></div>
  </div>
}
