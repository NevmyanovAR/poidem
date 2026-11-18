import { ArrowUpRight, Heart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDemo } from '../state/context'

export function Home() {
  const { data } = useDemo()
  return <section className="home-hero home-hero-compact"><div className="hero-copy">
    <span className="eyebrow"><span className="tiny-line" /> Для встреч, которые хочется вспоминать</span>
    <p className="greeting">{data.profile ? `${data.profile.name}, какой у тебя план?` : 'Привет. Давай придумаем что-нибудь хорошее'}</p>
    <h1>Куда<br /><em>пойдем?</em><span className="title-star">✳</span></h1>
    <p className="hero-description">На выставку, за кофе или навстречу<br className="desktop-break" /> чему-то новому. Главное — вместе</p>
    <Link className="button button-primary" to="/catalog">Найти свой план <ArrowUpRight size={21} /></Link>
    <span className="hero-footnote">Сначала занятие. Потом человек <Heart size={14} /></span>
  </div></section>
}
