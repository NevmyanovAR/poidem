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
