import '@extantape/onetaxonomy-react/styles.css'
import './site.css'

import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: { default: 'OneTaxonomy example', template: '%s · OneTaxonomy example' },
  description: 'A small Payload site that uses the OneTaxonomy plugin.',
}

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="site-name">
            OneTaxonomy example
          </Link>
          <nav aria-label="Site">
            <Link href="/">Views</Link>
            <a href="/admin">Curator sign-in</a>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>The data on this site is made up to show the plugin. Don't cite it.</p>
        </footer>
      </body>
    </html>
  )
}
