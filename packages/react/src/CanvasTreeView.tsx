import type { Id } from '@captiveorigins/onetaxonomy-core'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { describeLod, drawPlan, hitTest, LIGHT_COLORS, planCanvas, prepareTree, readColors, type CanvasPlan, type LodCounts } from './canvasPlan.js'
import { treeViewBox, type TreeViewProps } from './TreeView.js'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** The plan each mounted canvas last drew, for hit-testing and PNG export from outside the component. */
const drawn = new WeakMap<Element, CanvasPlan>()

/** Size used on the server and until the canvas is measured, in CSS pixels. */
export const DEFAULT_CANVAS_SIZE = { width: 800, height: 600 } as const

/**
 * The tree drawn on a canvas, for trees too large for SVG (chosen by `TreeView`
 * above its threshold). Same layout, same highlight shapes and colors, same title and
 * description; the canvas is one `role="img"`, and the outline stays the keyboard
 * path (ADR 0010). Level of detail and what it leaves out: see `planCanvas`. What it
 * leaves out is said in the description and in a visible note under the drawing.
 */
export function CanvasTreeView(props: TreeViewProps) {
  const { projection, layout, highlights = [], title, padding = 16 } = props
  const titleId = useId()
  const descId = useId()
  const noteId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>(props.canvasSize ?? DEFAULT_CANVAS_SIZE)
  const [scheme, setScheme] = useState(0)
  const box = props.viewBox ?? treeViewBox(layout, { padding, ...(props.labelWidth !== undefined ? { labelWidth: props.labelWidth } : {}) })
  const prepared = useMemo(() => prepareTree(projection, layout), [projection, layout])
  const plan = useMemo(
    () =>
      planCanvas(prepared, {
        box,
        width: size.width,
        height: size.height,
        highlights,
        ...(props.overlays ? { overlays: props.overlays } : {}),
        ...(props.traitShapes ? { traitShapes: props.traitShapes } : {}),
        ...(props.badges ? { badges: props.badges } : {}),
        drag: props.drag ?? null,
        dropTarget: props.dropTarget ?? null,
        ...(props.hiddenLabel ? { hiddenLabel: props.hiddenLabel } : {}),
        ...(props.mergedLabel ? { mergedLabel: props.mergedLabel } : {}),
        ...(props.lod ?? {}),
      }),
    // box is compared by value: a new object with the same numbers doesn't replan.
    [prepared, box.x, box.y, box.width, box.height, size.width, size.height, highlights, props.overlays, props.traitShapes, props.badges, props.drag, props.dropTarget, props.hiddenLabel, props.mergedLabel, props.lod],
  )
  const note = (props.lodNote ?? ((c: LodCounts) => describeLod(c)))(plan.counts)

  // Follow the element's size; on the server and in tests without layout, keep the given size.
  useIsoLayoutEffect(() => {
    const el = wrap.current
    if (!el || props.canvasSize) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.canvasSize])

  // Repaint when the color scheme changes: the colors come from the stylesheet's custom properties.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setScheme((n) => n + 1)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  useIsoLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    const w = Math.max(1, Math.round(plan.width * dpr))
    const h = Math.max(1, Math.round(plan.height * dpr))
    if (el.width !== w) el.width = w
    if (el.height !== h) el.height = h
    drawn.set(el, plan)
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = el.getContext('2d')
    } catch {
      ctx = null // jsdom without a canvas package: nothing to paint on
    }
    if (ctx) drawPlan(ctx, plan, readColors(el), { scale: dpr })
  }, [plan, scheme])

  const onClick = props.onNodeClick
    ? (e: MouseEvent<HTMLCanvasElement>) => {
        const id = canvasNodeAt(e.currentTarget, e.clientX, e.clientY)
        if (id) props.onNodeClick!(id, e)
      }
    : undefined

  return (
    <div
      ref={wrap}
      className={['ot-root', 'ot-canvas-tree', props.className].filter(Boolean).join(' ')}
      data-renderer="canvas"
      data-diagram={layout.diagram}
      data-layout={layout.kind}
      data-fixed-size={props.canvasSize ? '' : undefined}
      style={props.canvasSize ? { width: `${props.canvasSize.width}px` } : undefined}
    >
      <canvas
        ref={canvas}
        className="ot-tree-canvas"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={note ? `${descId} ${noteId}` : descId}
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        onClick={onClick}
      />
      <span id={titleId} className="ot-sr-only">
        {title}
      </span>
      <span id={descId} className="ot-sr-only">{`${layout.notice} ${projection.counts.shown} of ${projection.counts.total} shown.`}</span>
      {note && (
        <p id={noteId} className="ot-lod-note">
          {note}
        </p>
      )}
    </div>
  )
}

/** The node under a point in page coordinates, if `target` is a tree canvas; `null` otherwise or over nothing. */
export function canvasNodeAt(target: EventTarget | null, clientX: number, clientY: number): Id | null {
  const el = target instanceof Element ? target.closest('canvas.ot-tree-canvas') : null
  const plan = el ? drawn.get(el) : undefined
  if (!el || !plan) return null
  const r = el.getBoundingClientRect()
  // The canvas is drawn at its CSS size; scale if the page shows it at another size.
  const fx = r.width > 0 ? plan.width / r.width : 1
  const fy = r.height > 0 ? plan.height / r.height : 1
  return hitTest(plan, (clientX - r.left) * fx, (clientY - r.top) * fy)
}

/** The plan a mounted tree canvas last drew (for tests and exports). */
export const canvasPlanOf = (el: Element | null): CanvasPlan | undefined => (el ? drawn.get(el) : undefined)

/**
 * A PNG of what a tree canvas shows, in the light colors on white, at `scale` times
 * its size, with the disclosure lines written underneath (as `standaloneSvg` does),
 * so the picture can't travel without saying what it is and what it leaves out.
 */
export async function canvasPng(el: HTMLCanvasElement, lines: string[], { scale = 2, lineHeight = 15, fontSize = 11 }: { scale?: number; lineHeight?: number; fontSize?: number } = {}): Promise<Blob> {
  const plan = drawn.get(el)
  if (!plan) throw new Error('This canvas has not been drawn yet')
  const out = document.createElement('canvas')
  const extra = 12 + lines.length * lineHeight + 8
  out.width = Math.round(plan.width * scale)
  out.height = Math.round((plan.height + extra) * scale)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw on a canvas')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  drawPlan(ctx, plan, LIGHT_COLORS, { scale, background: '#ffffff' })
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = LIGHT_COLORS.node
  ctx.font = `${fontSize}px ${LIGHT_COLORS.font}`
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
  lines.forEach((line, i) => ctx.fillText(line, 8, plan.height + 12 + (i + 1) * lineHeight))
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be made'))), 'image/png'))
}
