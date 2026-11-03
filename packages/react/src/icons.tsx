import type { SVGProps } from 'react'

/**
 * The brand family's line icons (brand/README.md): 24 × 24, 1.75 stroke, round
 * caps and joins, currentColor. The same drawings ship in OnePedigree and
 * OneTaxonomy. Decorative by default (aria-hidden): put the words in the button's
 * text or aria-label.
 */
export const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  print: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  expand: 'm7 15 5 5 5-5M7 9l5-5 5 5',
  collapse: 'm7 20 5-5 5 5M7 4l5 5 5-5',
  flip: 'M7 4v16M4 7l3-3 3 3M17 20V4m-3 13 3 3 3-3',
  focus: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v4M12 18v4M2 12h4M18 12h4',
  unfocus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 12h6',
  layout: 'M4 12h4M8 6v12M8 6h5M8 18h5M8 12h9M15 4v4M15 16v4',
  filter: 'M4 5h16l-6 8v6l-4 2v-8z',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-1 .2-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  close: 'M6 6l12 12M18 6 6 18',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
} as const

export type IconName = keyof typeof ICON_PATHS

export function Icon({ name, size = 16, className, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={["ot-icon", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}
