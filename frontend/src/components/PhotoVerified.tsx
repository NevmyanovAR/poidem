import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Modal } from './ui'

export function PhotoVerified({ value }: { value?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!value) return null
  return <><button type="button" className="photo-verified" onClick={() => setOpen(true)}><BadgeCheck size={15} />Фото подтверждено</button>{open && <Modal title="Фото подтверждено" decoration={false} closeLabel="Закрыть пояснение" onClose={() => setOpen(false)}><p>Фотография анкеты сверена с проверочным селфи модератором. Это не проверка личности по документам</p></Modal>}</>
}
