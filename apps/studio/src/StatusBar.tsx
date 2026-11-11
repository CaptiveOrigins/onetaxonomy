/**
 * The line under the toolbar. It's a status region, so a screen reader announces what changes in it without
 * moving focus. The seal notice sits outside the collapsed list of notes, so it's seen and heard on opening.
 * Errors go to a separate alert region, which is announced at once; both are always mounted, so the first
 * message in each is announced too.
 */
export function StatusBar({ status, seal, notices, error = '' }: { status: string; seal: string; notices: string[]; error?: string }) {
  return (
    <>
      <div className="app-status" role="status">
        {status}
        {seal && <p className="app-seal">{seal}</p>}
        {notices.length > 0 && (
          <details>
            <summary>{notices.length} notes about this data</summary>
            <ul>{notices.slice(0, 200).map((n, i) => <li key={i}>{n}</li>)}</ul>
          </details>
        )}
      </div>
      <p className="app-error" role="alert">{error}</p>
    </>
  )
}
