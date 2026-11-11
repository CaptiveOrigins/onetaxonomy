'use client'

import type { Id, Projection, ProjectedNode } from '@captiveorigins/onetaxonomy-core'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type TreeOutlineProps = {
  projection: Projection
  /** Accessible name of the tree. */
  label: string
  /** Expand or collapse a node (Enter on a branch, Left/Right arrows). */
  onToggle?: (id: Id) => void
  /** Choose a node (Space, click). `additive` (Shift/Ctrl/⌘) adds or removes it from a multiple selection. */
  onSelect?: (id: Id, options?: { additive: boolean }) => void
  /** Move a node among its siblings (Alt+Up/Down): a keyboard alternative to dragging. */
  onMove?: (id: Id, direction: -1 | 1) => void
  /** Extra text after a node's name, e.g. its rank. */
  renderMeta?: (node: ProjectedNode) => ReactNode
  hiddenLabel?: (count: number) => string
  /** Shown for nodes without a name (e.g. unlabelled internal nodes of a tree). */
  unnamedLabel?: string
  /** Read out in place of the † mark, which screen readers say as "dagger". Default "extinct". */
  extinctLabel?: string
}

const DEFAULT_HIDDEN = (n: number) => `${n} not shown`

/**
 * The same tree as an accessible outline (WAI-ARIA tree pattern): one tab stop,
 * arrows to move, Right/Left to open and close, Home/End, type-ahead, Space to
 * select, Alt+Up/Down to reorder. Screen-reader users get the whole structure;
 * everyone gets a keyboard path to every drawing interaction.
 */
export function TreeOutline({ projection, label, onToggle, onSelect, onMove, renderMeta, hiddenLabel = DEFAULT_HIDDEN, unnamedLabel = 'Unnamed node', extinctLabel = 'extinct' }: TreeOutlineProps) {
  const byId = useMemo(() => new Map(projection.nodes.map((n) => [n.id, n])), [projection])
  const order = useMemo(() => projection.nodes.map((n) => n.id), [projection]) // preorder = visual order
  const [active, setActive] = useState<Id | null>(projection.roots[0] ?? null)
  const refs = useRef(new Map<Id, HTMLLIElement>())
  const typed = useRef({ text: '', at: 0 })
  const current = active && byId.has(active) ? active : (projection.roots[0] ?? null)
  const [focusPending, setFocusPending] = useState(false)

  useEffect(() => {
    if (focusPending && current) {
      refs.current.get(current)?.focus()
      setFocusPending(false)
    }
  }, [focusPending, current])

  const go = (id: Id | undefined | null) => {
    if (!id) return
    setActive(id)
    setFocusPending(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, n: ProjectedNode) => {
    e.stopPropagation()
    const i = order.indexOf(n.id)
    const branch = !n.isTip
    const open = branch && !n.collapsed
    const siblings = n.parent ? byId.get(n.parent)!.children : projection.roots
    const handled = () => e.preventDefault()
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onMove && n.parent) {
      handled()
      onMove(n.id, e.key === 'ArrowUp' ? -1 : 1)
      setFocusPending(true)
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        handled()
        return go(order[i + 1])
      case 'ArrowUp':
        handled()
        return go(order[i - 1])
      case 'Home':
        handled()
        return go(order[0])
      case 'End':
        handled()
        return go(order.at(-1))
      case 'ArrowRight':
        handled()
        if (branch && !open) return onToggle?.(n.id)
        return go(n.children[0])
      case 'ArrowLeft':
        handled()
        if (open && onToggle) return onToggle(n.id)
        return go(n.parent)
      case 'Enter':
        handled()
        if (branch) onToggle?.(n.id)
        else onSelect?.(n.id)
        return
      case ' ':
        handled()
        return onSelect?.(n.id, { additive: e.shiftKey || e.ctrlKey || e.metaKey })
      case '*':
        handled()
        for (const s of siblings) if (byId.get(s)!.collapsed) onToggle?.(s)
        return
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now()
          typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
          const from = [...order.slice(i + 1), ...order.slice(0, i + 1)]
          go(from.find((id) => byId.get(id)!.label.toLowerCase().startsWith(typed.current.text)))
        }
    }
  }

  const item = (id: Id): ReactNode => {
    const n = byId.get(id)!
    const branch = !n.isTip
    const siblings = n.parent ? byId.get(n.parent)!.children : projection.roots
    return (
      <li
        key={id}
        ref={(el) => {
          if (el) refs.current.set(id, el)
          else refs.current.delete(id)
        }}
        role="treeitem"
        className="ot-outline-item"
        aria-level={n.depth + 1}
        aria-setsize={siblings.length}
        aria-posinset={siblings.indexOf(id) + 1}
        aria-expanded={branch ? !n.collapsed : undefined}
        aria-selected={n.selected}
        tabIndex={id === current ? 0 : -1}
        onKeyDown={(e) => onKeyDown(e, n)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setActive(id)
        }}
        data-status={n.status}
      >
        <span
          className="ot-outline-row"
          onClick={(e) => {
            setActive(id)
            onSelect?.(id, { additive: e.shiftKey || e.ctrlKey || e.metaKey })
          }}
        >
          {branch ? (
            <span
              className="ot-outline-twisty"
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation()
                onToggle?.(id)
              }}
            >
              {n.collapsed ? '▸' : '▾'}
            </span>
          ) : (
            <span className="ot-outline-twisty" aria-hidden="true" />
          )}
          <span className="ot-outline-label" data-unnamed={n.label ? undefined : ''}>
            {n.label || unnamedLabel}
            {n.status === 'extinct' && (
              <>
                <span aria-hidden="true"> †</span>
                <span className="ot-sr-only"> ({extinctLabel})</span>
              </>
            )}
          </span>
          {renderMeta?.(n)}
          {n.hiddenDescendants > 0 && <span className="ot-outline-hidden"> · {hiddenLabel(n.hiddenDescendants)}</span>}
        </span>
        {branch && !n.collapsed && n.children.length > 0 && <ul role="group">{n.children.map(item)}</ul>}
      </li>
    )
  }

  return (
    <ul className="ot-outline" role="tree" aria-label={label} aria-multiselectable={onSelect ? true : undefined}>
      {projection.roots.map(item)}
    </ul>
  )
}
