export function localDate(offset = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 'Дата не указана'
  return new Intl.DateTimeFormat('ru-RU', options ?? { day: 'numeric', month: 'long' }).format(date)
}

export function isFuture(date: string, time: string): boolean {
  const value = new Date(`${date}T${time}:00`).getTime()
  return Number.isFinite(value) && value > Date.now()
}

export function meetingDateLabel(value: { startsAt?: string; timeZone?: string; date?: string; time?: string }, now = new Date()): string {
  if (value.startsAt && value.timeZone) {
    const stamp = new Date(value.startsAt)
    if (!Number.isFinite(stamp.getTime())) return 'Дата не указана'
    const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: value.timeZone, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(stamp)
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
    const currentYear = new Intl.DateTimeFormat('ru-RU', { timeZone: value.timeZone, year: 'numeric' }).format(now)
    return `${part('day')} ${part('month')}${part('year') !== currentYear ? ` ${part('year')}` : ''}, ${part('hour')}:${part('minute')}`
  }
  if (!value.date) return 'Дата не указана'
  const year = value.date.slice(0, 4)
  return `${dateLabel(value.date)}${year !== String(now.getFullYear()) ? ` ${year}` : ''}${value.time ? `, ${value.time}` : ''}`
}
