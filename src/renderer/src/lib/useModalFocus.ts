import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal focus management: remembers what opened the dialog, keeps Tab inside it
 * while it's up, and hands focus back on close.
 *
 * The opener is captured in the ref initialiser, not in an effect — React
 * applies autoFocus during the commit phase, which runs before passive effects,
 * so reading document.activeElement from useEffect returns the dialog's own
 * autofocused control instead of whatever the user was on.
 */
export function useModalFocus<T extends HTMLElement>(): RefObject<T> {
  const ref = useRef<T>(null)
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !el.contains(active)
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    const opened = opener.current
    return () => {
      el.removeEventListener('keydown', onKey)
      // the opener can be gone if the dialog deleted what launched it
      if (opened && document.contains(opened)) opened.focus()
    }
  }, [])

  return ref
}
