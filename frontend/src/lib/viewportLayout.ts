import { useEffect } from 'react'

// Presentation only: keep controls out of an iOS/WebView visual keyboard.
export function useViewportLayout() {
  useEffect(() => {
    const viewport = window.visualViewport, root = document.documentElement
    const update = () => {
      const focused = document.activeElement
      const editing = focused instanceof HTMLElement && focused.matches('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]')
      const covered = viewport && viewport.scale <= 1.05 && window.innerHeight - viewport.height - viewport.offsetTop > 150
      root.toggleAttribute('data-visual-keyboard', !!editing && !!covered)
    }
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    update()
    return () => {
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', update)
      root.removeAttribute('data-visual-keyboard')
    }
  }, [])
}
