import { useEffect, useRef } from 'react'

export const FOREGROUND_REFRESH = 'poidem:foreground-refresh'

// Один выполняющийся запрос и не больше одного отложенного обновления.
export class RefreshGate {
  private running = false
  private next: (() => Promise<void>) | null = null
  async run(operation: () => Promise<void>): Promise<void> {
    if (this.running) { this.next = operation; return }
    this.running = true
    try { await operation() }
    finally {
      this.running = false
      const next = this.next; this.next = null
      if (next) void this.run(next)
    }
  }
  invalidate() { this.next = null }
}

export function useAutoRefresh(refresh: () => void, enabled = true, revision: number | string = 0) {
  const callback = useRef(refresh)
  useEffect(() => { callback.current = refresh }, [refresh])
  useEffect(() => {
    if (!enabled) return
    let live = true
    const invoke = () => { if (live && document.visibilityState === 'visible') callback.current() }
    queueMicrotask(invoke)
    window.addEventListener(FOREGROUND_REFRESH, invoke)
    return () => { live = false; window.removeEventListener(FOREGROUND_REFRESH, invoke) }
  }, [enabled, revision])
}
