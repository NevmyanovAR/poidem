import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export function RecordMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return <details ref={ref} className="record-menu" onKeyDown={event => { if (event.key === 'Escape' && ref.current?.open) { event.preventDefault(); event.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary')?.focus() } }}>
    <summary aria-label="Действия со своим планом"><MoreHorizontal size={20} /></summary>
    <div className="record-menu-items" onClick={() => { if (ref.current) ref.current.open = false }}>{children}</div>
  </details>
}
