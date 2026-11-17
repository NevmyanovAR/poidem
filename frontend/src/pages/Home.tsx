import { ArrowDown, ArrowRight, ArrowUpRight, CalendarHeart, Compass, Heart, Plus, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Glasses, Photo, PlanCard } from '../components/ui'
import { useDemo } from '../state/context'
import { DEMO_PLANS } from '../data/demo'

export function Home() {
  const { data, selectPlan } = useDemo()
  return <>
    <section className="home-hero"><div className="hero-copy"><span className="eyebrow"><span className="tiny-line" /> Для встреч, которые хочется вспоминать</span><p className="greeting">{data.profile ? `${data.profile.name}, какой у тебя план?` : 'Привет. Давай придумаем что-нибудь хорошее.'}</p><h1>Куда<br /><em>пойдём?</em><span className="title-star">✳</span></h1><p className="hero-description">На выставку, за кофе или навстречу<br className="desktop-break" /> чему-то новому. Главное — вместе.</p><Link className="button button-primary" to="/catalog">Найти свой план <ArrowUpRight size={21} /></Link><span className="hero-footnote">Сначала занятие. Потом человек. <Heart size={14} /></span></div>
      <Link to="/people/demo-gallery" onClick={() => selectPlan('demo-gallery')} className="hero-image" aria-label="Посмотреть план Выставка, потом кофе"><Photo src="/images/gallery.jpeg" alt="Встреча в художественной галерее" eager /><div className="hero-image-shade" /><span className="image-corner-note">Встретимся<br /><em>впечатлениями</em></span><div className="hero-image-bottom"><div><span className="eyebrow">План для красивого начала</span><h2>Выставка,<br />потом кофе</h2></div><span className="round-arrow"><ArrowUpRight size={28} /></span></div><span className="image-sticker"><Glasses /><span>вдвоём<br />интереснее</span></span></Link>
    </section>
    <div className="home-shortcuts"><Link to="/catalog"><Compass /><span><strong>Найти план</strong><small>Выбери настроение</small></span><ArrowUpRight /></Link><Link to="/create"><Plus /><span><strong>Создать свой</strong><small>У тебя есть идея?</small></span><ArrowUpRight /></Link><Link to="/plans"><CalendarHeart /><span><strong>Мои планы</strong><small>{data.ownPlans.length + data.selectedIds.length ? 'Всё хорошее — впереди' : 'Место для будущих встреч'}</small></span><ArrowUpRight /></Link><Link to="/inspiration"><Sparkles /><span><strong>Вдохновение</strong><small>Когда хочется нового</small></span><ArrowUpRight /></Link></div>
    <section className="section-space"><div className="section-header"><div><span className="eyebrow">Маленькие поводы стать ближе</span><h2>Есть идея <em>для двоих</em></h2></div><Link className="text-link" to="/catalog">Все планы <ArrowRight size={18} /></Link></div><div className="plan-grid home-plans">{DEMO_PLANS.slice(1, 4).map(plan => <PlanCard key={plan.id} plan={plan} onSelect={() => selectPlan(plan.id)} />)}</div></section>
    <section className="manifesto"><Glasses /><div><span className="eyebrow">Немного о нас</span><h2>Не идеальная анкета.<br /><em>Ваш общий момент.</em></h2><p>Мы верим, что узнать человека проще за любимым занятием.<br />Выбирай план, находи компанию, создавай свою историю.</p></div><ArrowDown className="manifesto-arrow" size={32} /></section>
  </>
}
