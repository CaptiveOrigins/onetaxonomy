'use client'

import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'

const ITEMS = 'button:not(:disabled):not([role="menuitem"]), select:not(:disabled), input:not(:disabled)'

const itemsIn = (root: HTMLElement | null): HTMLElement[] => (root ? [...root.querySelectorAll<HTMLElement>(ITEMS)].filter((el) => !el.closest('[role="menu"]')) : [])

/** Whether an arrow key belongs to the control itself: a text field moves its caret unless it is at the end it points to. */
function keepsArrow(el: HTMLElement, key: string) {
  if (!(el instanceof HTMLInputElement)) return false
  if (el.type === 'number') return true
  const at = el.selectionStart
  if (at === null) return true
  return key === 'ArrowLeft' ? at > 0 || el.selectionEnd !== at : at < el.value.length || el.selectionEnd !== at
}

/**
 * The WAI-ARIA toolbar pattern for a `role="toolbar"` element: one Tab stop (the control
 * last used), Left and Right move between its controls and wrap, Home and End go to the
 * first and last. Disabled controls are skipped, and if the remembered one becomes
 * disabled the first enabled one takes the Tab stop. In a number field the arrows stay
 * with the field; in a text field they move focus only from its start or end.
 */
export function useRovingToolbar(ref: RefObject<HTMLElement | null>) {
  const active = useRef<HTMLElement | null>(null)
  // After every render: controls come and go (a disabled Undo, a menu), so the one Tab stop is set again.
  useEffect(() => {
    const items = itemsIn(ref.current)
    if (!items.length) return
    const current = active.current && items.includes(active.current) ? active.current : items[0]!
    for (const el of items) el.tabIndex = el === current ? 0 : -1
    active.current = current
  })
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const items = itemsIn(ref.current)
    const el = e.target as HTMLElement
    if (!items.includes(el)) return
    for (const x of items) x.tabIndex = x === el ? 0 : -1
    active.current = el
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
    const items = itemsIn(ref.current)
    const el = e.target as HTMLElement
    const i = items.indexOf(el)
    if (i < 0) return
    if ((e.key === 'Home' || e.key === 'End') && el instanceof HTMLInputElement) return
    if (keepsArrow(el, e.key)) return
    e.preventDefault()
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    items[j]!.focus()
  }
  return { onKeyDown, onFocus }
}
