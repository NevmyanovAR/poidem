import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Activity, ArrowLeft, BarChart3, LayoutDashboard, ListChecks, ShieldCheck, Users, Image, UsersRound, MapPin } from 'lucide-react'
import { useAppData } from '../state/context'
import { Brand, EmptyState } from '../components/ui'
import { PlacesPanel } from '../components/admin/Places'
import { PhotoVerificationQueue } from '../components/admin/PhotoVerificationQueue'
import { AdminModeration } from './AdminModeration'
import { AnalyticsPanel } from '../components/admin/Analytics'
import { Directory } from '../components/admin/Directory'
import { SystemPanel } from '../components/admin/System'
import { TeamPanel } from '../components/admin/Team'
import { EditorialPanel } from '../components/admin/Editorial'
import { roleLabels } from '../api/admin'
import { range, useResource } from '../components/admin/common'
import { Loading } from '../components/admin/States'
import '../admin.css'

const sections = [['overview', 'Обзор', LayoutDashboard], ['analytics', 'Аналитика', BarChart3], ['users', 'Пользователи', Users], ['plans', 'Планы', ListChecks], ['moderation', 'Модерация', ShieldCheck], ['system', 'Система', Activity], ['inspiration', 'Вдохновение', Image], ['team', 'Команда', UsersRound], ['places', 'Проверка мест', MapPin]] as const

export function Admin() {
  const { authorization } = useAppData()
  if (authorization.status === 'checking') return <Loading />
  if (authorization.status !== 'verified') return <EmptyState title="Войди через Telegram" action="Моя анкета" to="/profile">Этот раздел доступен только назначенному администратору</EmptyState>
  return <Workspace key={authorization.userId} />
}

function Workspace() {
  const { safety } = useAppData()
  const check = useCallback(() => safety.adminSession(), [safety])
  const [params, setParams] = useSearchParams()
  const access = useResource(params.get('section') ?? 'role', check)
  const refreshAccess = access.refresh
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') refreshAccess() }; window.addEventListener('focus', refresh); const timer = window.setInterval(refresh, 30000); return () => { window.removeEventListener('focus', refresh); clearInterval(timer) } }, [refreshAccess])
  const permissions = access.data?.permissions ?? []
  const available = sections.filter(([key]) => permissions.includes(key === 'overview' ? 'analytics' : key === 'inspiration' ? 'editorial' : key === 'places' ? 'moderation' : key))
  const section = available.find(([key]) => key === params.get('section'))?.[0] ?? available[0]?.[0]
  const [period, setPeriod] = useState(() => range(30))
  if (access.error) return <div className="admin-denied"><EmptyState title="Доступ ограничен" action="На главную" to="/home">{access.error}</EmptyState><button className="text-link" onClick={access.refresh}>Проверить доступ ещё раз</button></div>
  if (!access.data) return <Loading />
  return <div className="admin-workspace">
    <aside className="admin-sidebar"><Brand /><span className="admin-caption">Кабинет управления</span><nav aria-label="Разделы администратора">{available.map(([key, text, Icon]) => <button key={key} className={section === key ? 'selected' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => setParams({ section: key })}><Icon size={18} />{text}</button>)}</nav><Link className="admin-exit" to="/settings"><ArrowLeft size={16} />В приложение</Link></aside>
    <div className="admin-content"><header className="admin-page-header"><div><p className="admin-caption">Пойдём? / управление</p><h1>{sections.find(([key]) => key === section)?.[1]}</h1></div><span className="admin-role"><ShieldCheck size={15} />{roleLabels[access.data.role]}</span></header>
      {(section === 'overview' || section === 'analytics') && <AnalyticsPanel detailed={section === 'analytics'} period={period} onPeriod={setPeriod} onModeration={permissions.includes('moderation') ? () => setParams({ section: 'moderation' }) : undefined} />}
      {(section === 'users' || section === 'plans') && <Directory key={section} kind={section} />}
      {section === 'moderation' && <><div className="plans-tabs filter-row"><button className={params.get('tab') !== 'photos' ? 'chip selected' : 'chip'} onClick={() => setParams({ section: 'moderation' })}>Жалобы</button><button className={params.get('tab') === 'photos' ? 'chip selected' : 'chip'} onClick={() => setParams({ section: 'moderation', tab: 'photos' })}>Проверка фото</button></div>{params.get('tab') === 'photos' ? <PhotoVerificationQueue /> : <AdminModeration />}</>}
      {section === 'places' && <PlacesPanel />}
      {section === 'system' && <SystemPanel />}
      {section === 'inspiration' && <EditorialPanel />}
      {section === 'team' && <TeamPanel onChanged={access.refresh} />}
    </div>
  </div>
}
