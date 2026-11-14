import { projectedView } from '@extantape/payload-plugin-onetaxonomy'
import config from '@payload-config'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { createLocalReq, getPayload } from 'payload'

import { ViewFigure, type StoredView } from './ViewFigure'

export const dynamic = 'force-dynamic'

type Args = { params: Promise<{ id: string }> }

/** A source's address is data someone typed: only http and https addresses become links. */
function webAddress(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/**
 * One published view, read as an anonymous visitor: the plugin's own function (the one behind
 * `GET /api/taxonomy-views/:id/projection`) answers with the nodes to draw, the snapshot it is pinned to and what the
 * drawing leaves out. Anything the visitor may not read is "not found".
 */
const load = cache(async (id: string) => {
  const payload = await getPayload({ config })
  const req = await createLocalReq({}, payload)
  req.user = null
  const result = await projectedView(req, id)
  if (!result.ok) return null
  const doc = (await payload.findByID({ collection: 'taxonomy-views' as never, id, overrideAccess: false, depth: 0, disableErrors: true })) as unknown as { view: StoredView } | null
  return doc ? { ...result.body, stored: doc.view } : null
})

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const found = await load((await params).id)
  return { title: found ? found.view.title : 'Not found' }
}

export default async function ViewPage({ params }: Args) {
  const found = await load((await params).id)
  if (!found) notFound()
  const { view, source, projection, disclosure, stored } = found
  return (
    <>
      <h1>{view.title}</h1>
      <p className="lede">
        Drawn from snapshot <strong>{source.id}</strong>, version {source.version}.
      </p>
      {source.withdrawn ? (
        <p className="notice" role="note">
          The snapshot behind this view has been withdrawn. The view is kept so links to it still work.
        </p>
      ) : null}
      {disclosure.illustrative ? (
        <p className="notice" role="note">
          Illustrative data: made up to show how the plugin works.
        </p>
      ) : null}
      <ViewFigure projection={projection} stored={stored} title={view.title} />
      <h2>About this view</h2>
      <ul className="about">
        {disclosure.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {disclosure.citations.length > 0 ? (
        <>
          <h2>Sources</h2>
          <ul className="about">
            {disclosure.citations.map((c) => {
              const url = webAddress(c.url)
              return (
                <li key={c.source}>
                  {c.text}
                  {c.version ? ` Version ${c.version}.` : ''}
                  {c.license ? ` License: ${c.license}.` : ''}
                  {c.illustrative ? ' Illustrative: not a real source.' : ''}
                  {url ? (
                    <>
                      {' '}
                      <a href={url}>{url}</a>
                    </>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </>
  )
}
