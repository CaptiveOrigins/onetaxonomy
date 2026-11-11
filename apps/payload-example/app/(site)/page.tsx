import config from '@payload-config'
import Link from 'next/link'
import { getPayload } from 'payload'

// Read on each request: what is published can change at any time.
export const dynamic = 'force-dynamic'

type ViewDoc = { id: string | number; title: string; view: { target: { kind: string; id: string } } }

export default async function Home() {
  const payload = await getPayload({ config })
  // As an anonymous visitor (`overrideAccess: false`, no user): the plugin's read rule decides, so only published views come back.
  const { docs } = await payload.find({ collection: 'taxonomy-views' as never, overrideAccess: false, depth: 0, limit: 50, sort: 'title' })
  const views = docs as unknown as ViewDoc[]
  return (
    <>
      <h1>Published views</h1>
      <p className="lede">Each view is a saved way of looking at one sealed snapshot. This page lists what a visitor who isn't signed in may read.</p>
      {views.length === 0 ? (
        <p>Nothing is published yet.</p>
      ) : (
        <ul className="view-list">
          {views.map((v) => (
            <li key={v.id}>
              <Link href={`/views/${v.id}`}>{v.title}</Link>
              <p>{v.view.target.kind === 'phylogeny' ? 'A tree hypothesis' : 'A classification'}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
