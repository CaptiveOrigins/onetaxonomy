# Test audit

Each audit lists what this repo promises, the tests that prove it, and the gaps: those closed in the same pass and those left, with why. Audits run after each feature or fix, and at least every 14 days while the repo has commits. Newest first.

## 2026-11-11: a snapshot's content only on request

Scope: `packages/payload`: the `contentOnRequest` hook and the content field's admin condition (`src/collections.ts`), the panels reading again after Payload's own Save (`src/client/wired.tsx`); and `apps/payload-example`. ADR 0012 point 17. Plugin tests went from 237 to 247, all unit tests from 621 to 631, the example's smoke checks from 55 to 58.

### Covered

- **No read carries the content unless it names it** (`snapshots.test.ts`, 5 new tests on a real Payload with an in-memory MongoDB): what storing answers; a read, a list, an update's answer and a delete's answer, for a manager and for trusted code; a select that names the content gets it exactly as sealed, and a caller's own select is left alone, whether it names fields or only leaves some out; the update lock (below); the content field is shown in the admin on the new-snapshot form only.
- **The same over REST and GraphQL** (`http.test.ts`, `view-reads.test.ts`, 3 new tests): a snapshot, a list, a manager's `PATCH` and a view with its snapshot filled in answer without the content; `?select[snapshot]=true` and GraphQL's `select: true` give it; a plain GraphQL query answers `null` and no error.
- **The lock on sealed content still holds** (`snapshots.test.ts`, one of the 5): an update that changes the content is refused when the caller read and selected nothing of it, because the comparison is with the stored document. The earlier lock tests ran unchanged.
- **Everything in the plugin that needs the content still gets it**: views, imports, proposals, the summary, the export and the read API all ran their existing tests after `test/helpers.ts` stopped reading whole documents by default.
- **The panels follow Payload's own Save** (`panels-wired.test.tsx`, 2 new tests in jsdom): the snapshot panel reads its summary again, and the view panel its view and drawing, when Payload reports the document saved, and not otherwise.
- **Over HTTP, in the example site** (`scripts/smoke.mjs`, 3 new checks): a visitor's plain read and list hold no content and a select gets it; the curator's stored-snapshot admin page is sent without the content and without the field; the new-snapshot form still has the field.

### Checked by breaking it

Five deliberate breaks, one at a time, each failing at least one test: the hook taken off the collection (6 tests); the admin condition removed (2, one of them GraphQL, where the condition is what lets a plain query answer `null`); the hook changing a caller's own select (52); the view hook no longer selecting the content it checks (7); the panels ignoring Payload's Save (2).

### Gaps left

- **The browser run is still a scratch script, not in CI.** 28 checks in headless Chrome on the example site as the made-up curator: a stored snapshot's page is sent without content and has no editor; a sealed fixture pasted into the new-snapshot form is stored with the same checksum; Payload's own Save sends one `PATCH` under 4 kB with the status and no content, and the stored content is untouched; the panel then says the new status.
- **One thing in that run isn't explained.** After a snapshot was made through the form and its page loaded again, Payload's read-only Counts group showed its heading with no fields under it, and they didn't appear after two seconds, a scroll or a Save. Payload draws a group's fields only once the group is in view. Four shorter runs of the same steps on the same build drew them, as did seeded snapshots and ones made through the API. It may be headless Chrome and Payload's lazy drawing, and it may not: the cause wasn't found, and it hasn't been looked at in a browser with a window.
- **Hooks a host adds** that run after a read or a change get the document without `snapshot`. That is documented, not tested with a host's hook.
- **Postgres and SQLite:** as before, not run.

### Left out as overkill

- Every operation with every kind of select: the hook is one line, and the tests cover no select, a select naming the content, an include-mode select naming other fields and an exclude-mode one.
- Timing a 15 MB snapshot's admin page before and after. The test checks the content isn't sent, which is the cause.

## 2026-11-11: Payload plugin part 5, admin panels

Scope: `packages/payload`: the panels (`src/client/`), a snapshot's summary (`src/summary.ts`), the `admin.panels` option and the panel field on each collection; and `apps/payload-example`, which now shows the panels. ADR 0012 point 16. Plugin tests went from 143 to 237, all unit tests from 527 to 621, the example's smoke checks from 47 to 55.

### Covered

- **The summary keeps the read API's access rules** (`summary.test.ts`, 9 tests on a real Payload with an in-memory MongoDB): a manager gets counts, capped lists and sources and never the content; lists are cut to the limit and say so; a visitor, another tenant, a reader of a staged snapshot, a throwing access check, a missing id and an id that isn't one all get the same 404; a snapshot changed in the database is refused.
- **Names for sealed ids go to signed-in people only, and are never stored** (`summary.test.ts`): a signed-in reader gets `authorName` and `acceptedByName` from the host's lookup; a visitor allowed to read the snapshot gets the two ids and no names; the stored document holds neither name.
- **The panels have no powers of their own** (`panels-wired.test.tsx`, 25 tests in jsdom with `fetch` and Payload's hooks replaced by stand-ins): each request goes to the site's own API with the person's cookie; publishing is one `PATCH` that asks back only the fields shown; a run, an accept and a decline are one `POST` each; accept carries the checksum the panel showed; no buttons for someone Payload says may not save; a manager-only field is left out of the form for someone the site didn't send it to.
- **Nothing is sent before the confirm, and a refusal is never reported as done** (`panels.test.tsx`, `panels-wired.test.tsx`): each of publish, withdraw, run, accept and decline sends nothing until confirmed; a refusal reads "Nothing was changed." with the site's reason and leaves the form alone; a confirm stays open when the action fails or throws.
- **What gets sealed is said before accepting** (`panels.test.tsx`): the warning lists the title, notes, the manager's note, the date and the two ids, and asks to check for personal details; Accept needs a version name; a declining manager is told the author sees the note.
- **Each role sees only its next steps** (`panels.test.tsx`, 49 tests): a manager gets only the step each status allows; someone who may not manage gets none; Publish on a view is held with its reason while the form is unsaved or the snapshot isn't published; a running import can't be started twice, and one running past the limit is called probably interrupted.
- **An import's progress** (`panels-wired.test.tsx`): the panel looks again every 3 seconds while the job runs, stops when it doesn't, and stops when the page is left.
- **Keyboard and screen-reader wiring, as far as jsdom shows it** (`panels.test.tsx`): Escape and Cancel close a confirm and put the focus back on its button; Escape is ignored while it works; a held button's reason is tied to it; a problem is announced at once; a running job is in a live region; the view's drawing has the same tree as an outline.
- **Contrast, and status without colour** (`panels-css.test.ts`, 11 tests): colours are read from the installed `@payloadcms/ui` stylesheets. Text and muted text are at least 4.5:1 on the panel and on raised boxes, and control edges at least 3:1, in Payload's light and dark themes. The drawing colours equal the React package's. State colours are used only for borders.
- **Browser code stays out of the server entry, and server code out of the browser** (`panels-wired.test.tsx`, "what runs where").
- **Over HTTP, in the example site** (`scripts/smoke.mjs`, 8 new checks): the curator's built edit pages carry the panel; the staged version's summary is "not found" for a visitor and for the member; the member can't publish it; the curator's publish answers without the snapshot's content; once published a visitor reads the summary with the ids and no names.

### Checked by breaking it

Nineteen deliberate breaks, one at a time. Eighteen failed at least one test. In `src/client/`: no cookie sent; a publish not put into the form; the import poll never stopping; accept sending no checksum, or an empty one; a manager-only field always written to the form; the preview not bounded; a refused accept reported as a success; Escape closing a confirm while it works; focus not returned; Publish allowed with unsaved changes; decide buttons shown to non-managers; the seal warning shortened; a state colour put on text. In `src/summary.ts`: the head read with access skipped; the author's name given to visitors; the manager's name given to visitors; lists not clamped.

The one that no test caught: taking out the `catch` around the summary's first read. Payload answers nothing for a missing or malformed id, and the plugin's access wrapper turns a throw into a no before that line, so no test reaches it. It stays, as the same guard the other endpoints have, and it is not counted as covered.

### Gaps left

- **No browser run in CI.** The snapshot, view and proposal panels were clicked through once in headless Chrome on the example site, signed in as the made-up curator, in light and dark: 18 checks, from a scratch script that isn't in the repo. A Payload upgrade that changes its hooks is caught by TypeScript and by the smoke test's "page carries the panel" checks, not by a click.
- **The import panel hasn't run in a real admin.** The example site has no imports. Its logic is covered in jsdom only.
- **No screen reader, Safari, Firefox, phone or custom Payload theme.** The jsdom tests check roles, labels and focus, which is not the same as hearing it.
- **Payload's hooks are stand-ins in the jsdom tests.** `useDocumentInfo`, `useForm`, `useFormModified` and `useConfig` are replaced, so what Payload really gives them is seen only in the example site.
- **Postgres and SQLite:** as before, not run.

### Left out as overkill

- Every status with every role: each transition and each role's refusal has a test, and the server's own rules are tested in `snapshots.test.ts`, `views.test.ts` and `proposals.test.ts`.
- Payload's `PATCH` route and its access: the plugin's hooks behind it are tested already, over HTTP in `http.test.ts`.
- How the tree is drawn: the React package's tests cover `TreeView`; the panel test checks that it is drawn, bounded and has its outline.
- Pixel positions and screenshots of the panels.

## 2026-11-11: browser benchmark, and moving a departed person's proposals

Scope: `apps/playground/bench.tsx` and `bench.html`, `scripts/bench-browser.mjs`, `docs/benchmarks-browser.md`, and the "When someone leaves" paragraph of `packages/payload/README.md`. Plugin tests went from 142 to 143, all unit tests from 526 to 527.

### Covered

- **A host can move an accepted proposal's `author` and `decidedBy` to another account in its own database code without breaking what was sealed** (README, ADR 0012 point 15). `proposals.test.ts`, "keeps the sealed record whole when the site moves an accepted proposal's two links to another account in its own database code": through Payload the change is refused for both fields, trusted code included; after an `updateOne` on the adapter's own collection the proposal still carries its author's person id and matches its checksum, the version made from it has the same checksum, verifies and names both people by id, readers still see it with the name looked up from that id, and it can still be neither edited nor deleted. MongoDB only, as the rest of the plugin's tests.

### Gaps left

- **The benchmark page and script have no tests.** They are measuring tools that ship in no package. What they print was checked by hand: the summary lines against the tables of the run in the doc, and two full runs under an hour apart agreed on which sizes kept up, with median frame times within one display frame of each other. The summary's rules are small (on time means under 5% late frames in every motion; the motion named is the one with the most late frames), and a wrong one would show against the table beside it. Worth a test if the script grows.
- **Nothing here is measured in Safari, the Mac app's web view, Firefox, a window on a real screen, or on a real slow device.** The doc says so above its numbers. The WebKit section, added later the same day, is Playwright's headless build of the engine, run once by hand with a runner that isn't in this repo; the doc says how. The script's whole-millisecond rule (no decimal places, and a line saying so) was checked by hand against that section, and the Chrome section came out byte for byte the same when regenerated from its saved numbers. A Safari run is on the owner's test list.
- **The README's advice to try `canvasThreshold={500}` on slow devices rests on Chrome's throttle alone.** It is worded as something to try, and the default wasn't changed.

### Left out as overkill

- Testing that headless Chrome starts and is cleaned up. The script deletes its throwaway profile in a `finally`, and a run that failed to start says so and exits non-zero.

## 2026-11-11: people by id in proposals

Scope: `packages/payload` (`src/proposals.ts`, `src/types.ts`) and `apps/payload-example`. The plugin promised that an accepted proposal sealed a name the host chose. It now promises that only an opaque person id is stored and sealed, and that a name is looked up when shown and never kept. This replaces the lines about handles in the two audits below ("example Payload site" and "Payload plugin part 4"). Plugin tests went from 139 to 142, all unit tests from 523 to 526, the example's smoke checks from 46 to 47.

### Covered

- **Only the id is stored** (`proposals.test.ts`, "making a proposal"): a new proposal's author is the person id the site gives, whatever the request sent, including a forged `authorName`. The document read straight from the database has no `authorName` and none of the test's made-up names.
- **A name or an email address is never an id:** fourteen values are refused on create (empty, spaces, a full name, an email address, leading or trailing space, a leading hyphen, a slash, a no-break space, 65 characters, a number, null, undefined, an object), and a throw too. Each stores nothing, and the log line for each doesn't repeat the value.
- **Names are looked up, not kept:** a name changed at the site shows on the next read, for the author and for another reader, with the proposal's checksum unchanged; one list asks once per person per request; a lookup that throws or gives nothing shows the id alone; the preview carries the same name.
- **Accepting seals ids:** the new version's source record and `derivedFrom.proposal` hold the author's and the manager's ids, and the whole stored snapshot document matches none of the made-up names and has no `@`. Accepting is refused, and stores nothing, when the manager's id throws or is a name.
- **When someone leaves:** after the site stops giving a name, an accepted proposal still reads, under the id alone, and nothing stored or sealed names the person; open proposals are taken back and deleted by server code as before.
- **Over HTTP** (`http.test.ts`): a proposal posted with a forged author is stored under the sender's id; the accepted snapshot's record holds the two ids.
- **No tenants, defaults** (`proposals-plain.test.ts`): with no `personId`, the id is the user document's id, and with no `displayName` no name is shown.
- **The example site** (`scripts/smoke.mjs`): a member's proposal is stored under their account id and shows their handle; another member reads the handle and no email address; version 2 records both people by id and holds no handle and no email address; a handle changed by the curator shows on the accepted proposal at once, and version 2's checksum is unchanged and still verifies. Passed on `next dev` and on the built site.

### Checked by breaking it

Eight deliberate breaks in `src/proposals.ts`, one at a time, each failed at least one test: the pattern not checked; the refused value added to the log line; `authorName` made a stored field; accept and create each taking the host's value unchecked; a failed name lookup not caught; no per-request cache; the preview without the name.

### Gaps left

- **A one-word handle passes the pattern.** "morgan" is a valid id. The plugin can't tell, the README says so, and no test can close it.
- **Free text is sealed as written:** the title, the moves' notes and the manager's note. Nothing screens them for names. The README says so.
- **More than one auth collection:** the default id is the user document's id, which two collections can share. The README says to give your own; not tested.
- **The link to the user document:** an accepted proposal keeps its `author` and `decidedBy` relationships, and no code can change them. What a site does with the user document afterwards is its own; not tested here.
- **Postgres and SQLite:** as before, not run.

### Left out as overkill

- Every character class of the pattern: the fourteen refused values cover each rule it has, and the accepted forms are used throughout the tests.

## 2026-11-11: where names go in the drawing

Scope: a defect found while looking at the example site's pages. In rectangular layouts an inner node's name was drawn 6 units above the node, and a child's branch one row apart ran through it ("Reptilia" in the amniotes classes view). A folded branch's name started on top of its triangle. Both are fixed in `packages/react/src/labelPlace.ts`, used by the SVG and the canvas. React tests went from 119 to 132.

### Covered

- **The rule itself** (`label-place.test.tsx`): the node's own row when no child's branch leaves there, above when one does, below when the row and the space above are both taken, and, across nine arrangements of children at the default row spacing, no name crossed by a branch. When rows are closer than a name is tall, the place with the most room is chosen, the same one every time.
- **The case that was wrong** is pinned from the fixture: Reptilia midway between two of its four children's rows, with the old place shown to be struck through.
- **SVG:** no inner node's name in the classes view is crossed by a branch to one of its children, and a leaf's name is where it was.
- **Canvas and SVG agree:** Reptilia's name at two zooms, and every inner node of the checklist fixture.
- **Folded branches:** in SVG the name starts at or past the triangle's far edge plus 4 units, with the edge read from the drawn path; an open leaf's name still starts 8 units out. On canvas the name clears the triangle at three zooms, including 0.25 pixels a unit, where the triangle is held at 6 px.
- **Nothing else moved:** the whole-markup snapshots in `svg-unchanged.test.tsx` differ from the first ones in four `<text>` tags (three inner names, one folded name) and nowhere else; the test's comment says which.

### Gaps left

- Looked at in headless Chrome as SVG only, in light. The canvas placement is tested through its plan, not by looking at painted pixels.
- A long name can still cross a branch further down the tree: only the node's own children are looked at. No test, because it isn't fixed.
- Radial drawings: a folded branch's triangle points right whatever the branch's angle. Its name is tested in rectangular layouts only.

### Left out as overkill

- Every combination of row spacing and child count: the rule is three places and one comparison, and each branch of it is tested.

## 2026-11-11: example Payload site

Scope: `apps/payload-example` (new) and the React package's client-module change that it needed. The example is a real Payload 3.93 site behind Next.js 16 with a throwaway in-memory MongoDB, on this machine only. Its test is `scripts/smoke.mjs` (`pnpm smoke`, 46 checks): it builds the site, starts it on a free port with its own database and password, and sends requests over HTTP with sign-in cookies and the headers a browser sends. It passed on `next dev` and on the built site. CI runs it after the unit tests. The React change has `packages/react/test/client-modules.test.ts` (4 new; react 115 to 119, all unit tests 506 to 510).

What the example promises is in its README. This closes "a real site" from the audit below: a web server, Next.js, cookies and Payload's CSRF rule.

### Covered

- **A visitor reads only what is published:** the home page lists the two published views; each view page answers 200 with one SVG tree, its outline, the illustrative-data line and its sources; a view that doesn't exist is 404. Through REST and GraphQL a visitor sees the one published snapshot and not the staged one, can search it and read a view's projection.
- **A visitor changes nothing:** storing a snapshot and making a proposal are 403; accounts and proposals can't be listed.
- **Sign-in:** each account signs in and gets an `HttpOnly` cookie; a wrong password is 401; the cookie is the person it was given to.
- **Cookies count only from this site:** a read with the cookie marked as coming from another site, or with no word on where it came from, is anonymous; a proposal posted with the member's cookie and another site's `Origin` is 403.
- **Roles:** a member's PATCH of their own role leaves them a member; a member lists only their own account; `/api/access` opens the admin to the curator and not to the member or a visitor; the admin's sign-in page loads, the admin loads for the curator, and the member is redirected to its "unauthorized" page.
- **Staged work is the curator's:** the curator lists both snapshots; a visitor and the member get 404 for the staged one and its export.
- **Proposals carry a handle and no email address:** a member's proposal is stored private under their handle whatever author the body names, and the stored document holds no email address; it is 404 to the curator while private and to a visitor once shared; a second member, added by the curator, reads the shared proposal by handle without the author's email address.
- **Accepting:** the author and another member get 404; the curator's preview says it can be accepted; accepting makes version 2, staged; its export verifies against its checksum, names the proposer and the curator by handle, holds no email address, and is 404 to a visitor, who still lists one snapshot. Neither the author nor the curator can delete the accepted proposal, and it is still there.
- **Server Components** (`client-modules.test.ts`): the files that call client hooks say `'use client'`, the list of client files is pinned, and `layoutFor` and the server-safe exports come from files that don't.

### Gaps left

- **A person in the admin:** the smoke test loads the admin's pages and reads their status; nobody has clicked through creating, publishing or deciding there. No browser ran the pages' JavaScript in a test.
- **How the pages look:** looked at once in headless Chrome (light, dark, 520 px wide); no picture is compared in a test. No screen reader was used, and no phone.
- **A member's sign-up or password reset:** the example has no email, so neither exists.
- **Publishing version 2 and the page changing:** the test stops at the staged version. The plugin's own tests cover publishing.
- **Your own database:** `DATABASE_URI` and the "first account is the curator" rule were not run by the smoke test, which always uses its own in-memory database. Postgres and SQLite, as before.
- **CI on Linux:** the smoke test has run on a Mac. Its first CI run is the pull request that adds it.
- **A canvas-size tree from a Server Component.**

### Left out as overkill

- Repeating the plugin's 139 tests against the site: the smoke test takes one pass per kind of reader and per kind of refusal, and the plugin's tests hold the rest.
- Unit tests for the seed and the page components: the smoke test reads their output through the running site.

## 2026-11-11: Payload plugin over HTTP

Scope: `packages/payload`, tests only. Parts 1 to 4 each left "HTTP routing" as a gap: their tests call the endpoint handlers and the Local API directly, with the user handed in. `test/http.test.ts` (12 new; payload 127 to 139, all tests 494 to 506) sends real `Request`s through Payload's own REST router, `handleEndpoints`, and signs in through `/api/users/login`, so the user comes from a token the way it does for a browser. Same real Payload 3.93 and in-memory MongoDB, two tenants, no web server and no network. No plugin code changed: every test passed against the code as it was, once the test's own expectations matched the documented behaviour.

### Covered

- **Who you are comes from the token:** a reader's list of snapshots is their tenant's published ones; a manager's adds the staged one; another tenant's reader and manager get an empty list; an anonymous request gets 403 and no data. A staged snapshot by its id is 404 to a reader. A token that isn't one, or is a real one with its signature changed, is anonymous.
- **Standard routes refuse a reader's writes:** create, update and delete of a snapshot are 403, another tenant's manager and an anonymous request are refused too, and the stored snapshots are unchanged.
- **Every read endpoint is routed:** search, ancestors, descendants, MRCA, coverage, a view's projection and a view's export each answer 200 with the right body to a reader in the tenant, and 404 with no data in the body to another tenant's reader and manager and to an anonymous request.
- **Parameters come from the URL:** a missing `q` or `classification` is 400; `limit=1` is honoured; a limit that isn't a number falls back to the default; a staged snapshot and a draft view are 404 to a reader and 200 to a manager; an id that isn't one is 404.
- **Export:** a published snapshot downloads exactly as sealed (it verifies), with a JSON content type and an attachment file name.
- **A read route takes no write:** POST, PUT and DELETE on search, export and projection are refused, and nothing changed.
- **Imports:** a reader and an anonymous request can't make a job (403), and a reader can't list jobs; a manager's POST makes one that ends `done` with a staged snapshot; `POST …/:id/run` is 404 to a reader, another tenant and an anonymous request, 200 to the manager without another attempt; a GET of the run path runs nothing.
- **Proposals:** an anonymous POST is refused; a decision written into a new proposal is refused; a new proposal is its sender's, private, with the plugin's own id and name, whatever the body says, and one that asks to start shared or accepted is refused. While private it can't be listed, read or previewed by anyone else, managers included. Forged PATCHes (status accepted, who decided, another author) are refused. Shared, it can be previewed by a reader in the tenant and by nobody outside it. Accept and decline are 404 to its author, other readers, another tenant and anonymous requests; a manager's accept with a body that isn't JSON, no body, or the wrong checksum stores nothing; a GET of the accept path does nothing. A manager's accept makes a staged version that a reader can't list, read or export, with both names in it; readers see "accepted" without who decided; the accepted proposal takes no PATCH or DELETE, and a second accept is 409. Decline takes its note from the body (a note that isn't text is 400) and the author reads it.

### Gaps left

- **A real site:** no web server, no Next.js, no cookies or CSRF (the tests send the token in the `Authorization` header), no admin. `apps/payload-example` will cover these.
- **GraphQL** over HTTP: part 3 runs GraphQL queries against the schema directly, not through the router.
- **Uploads over HTTP:** the import here reads a URL through the host's `fetch`; a multipart upload wasn't sent through the router.
- **Postgres and SQLite**, as before.

### Left out as overkill

- Repeating every case from the other files over HTTP: the router hands the same request to the same handlers, so one pass per route and per kind of refusal is enough.

## 2026-11-11: Payload plugin part 4

Scope: proposals (M7 part 4, ADR 0012 point 15). In `packages/core`: `acceptIntoSnapshot` (`src/proposal.ts`), `derivedFrom.proposal` in the model and the JSON Schema. In `packages/payload`: the `taxonomy-proposals` collection and its three endpoints (`src/proposals.ts`), `access.propose`, and the hook that reopens a proposal when its staged version is deleted. Tests went from 457 to 494: core 106 to 111, payload 95 to 127 (`proposals.test.ts` 27 new, `proposals-plain.test.ts` 4 new, `tenants.test.ts` 9 to 10, and the plugin-shape test in `snapshots.test.ts` widened). Same setup as before: a real Payload 3.93 with an in-memory MongoDB, no network. `proposals.test.ts` runs with tenants on a replica set, so with transactions; `proposals-plain.test.ts` runs without tenants on a single MongoDB, so without them. Endpoints were called through their handlers with a local request.

### Covered

- **Core, accepting** (`core/test/proposal.test.ts`): the new version carries the moves, a source record naming who proposed and who accepted, each moved placement's provenance with where it was before, and `derivedFrom` pinning the base and the proposal; the base isn't changed; the same proposal, version and date give the same snapshot every time. Refused: a phylogeny (with the reason), an unsealed or changed base, the base's own version, a proposal that moves nothing, one already accepted into the dataset. A second proposal is accepted only over the new version. The accepted snapshot validates against the JSON Schema (`schema.test.ts`).
- **Whose it is** (`proposals.test.ts`, "making a proposal"): a new proposal is its author's and private, and its id, author name, date and checksum are the plugin's, whatever the request sent. Anonymous visitors, people `access.propose` refuses and checks that throw make nothing. A proposal that doesn't fit its snapshot is refused with the reason. A snapshot that is missing, hidden or in another tenant gives one and the same answer. No name from the site, no proposal. `maxPerUser` holds.
- **Who sees it** ("private and shared"): a private proposal is invisible to everyone but its author, managers included, in and out of its tenant. A shared one is seen by its tenant's readers and by nobody else: not anonymous visitors, not another tenant's reader or manager, not a user with no tenant.
- **Sharing locks it:** sharing needs a move and a published snapshot; nobody edits or deletes a shared proposal; only its author unshares it; taken back, it can be revised (under the author's current name) and shared again.
- **Nothing forged:** the author, the snapshot, the tenant, the decision, who decided and the version it went into can't be set through an update, by the author, a manager or server code.
- **Preview:** what would change, the checksum to accept, and whether it can be accepted; its lists are bounded and say so.
- **Accepting:** a request that doesn't name the version and the checksum last seen is refused and stores nothing; accepting makes a new staged version with both names in its record and leaves the published one as it was (same `updatedAt`, same checksum); readers see that it was accepted, not the staged version or who decided; a second accept, a decline and every later change or delete are refused, for server code too; a version already stored is refused and the proposal stays open; deleting the staged version opens the proposal again; a phylogeny is refused with the reason.
- **Races:** a proposal changed between the manager's look and the claim accepts nothing (409, no snapshot left); two managers accepting at once store one version. Both also without transactions (`proposals-plain.test.ts`), where the plugin removes the snapshot it just wrote instead of rolling back.
- **Declining:** with a note; hidden from other readers afterwards, still seen by managers and the author; the author can revise and share again; a proposal taken back a moment before is not declined.
- **When someone leaves:** server code with no user takes a departed person's shared proposal back to private and deletes it, and a private one, even when the site can no longer give their name. The stored name isn't touched on the way.
- **A withdrawn snapshot** can't be proposed on, shared on or accepted from.
- **No tenants:** names default to "User <id>", any signed-in reader may propose, anonymous visitors see nothing, and the whole path from private to a staged version works (`proposals-plain.test.ts`).
- **Plugin shape:** no proposals collection unless asked; a taken slug is refused only when proposals are on (`snapshots.test.ts`).

### Gaps added

- **A view's `source` across tenants** (`tenants.test.ts`): the gap part 3 left for "the next part". A reader in the view's tenant gets its `source`; another tenant's reader and manager, a user with no tenant and a throwing tenant lookup get "not found".
- **When someone leaves** (above): written after the README promised it, before this was merged.

### Checked by breaking it

30 deliberate breaks were made in `src/proposals.ts` and `src/access.ts`, one at a time (an access rule loosened, a status check dropped, a tenant filter removed, the conditional write made unconditional, and so on), and the plugin's tests run against each. 28 failed a test. Two didn't, and each is held by a second layer that is tested:

- Delete access without its status filter: the `beforeDelete` hook refuses an accepted or shared proposal anyway, and the tests for that pass through the hook.
- The plugin's own check that refuses a phylogeny before calling core: core refuses it with the same reason (`core/test/proposal.test.ts`).

A third, the check that a proposal's snapshot is in the proposal's tenant, survived at first. A test with server code in both directions was added, and the break now fails three tests.

### Gaps left

- **Postgres and SQLite:** the accept and decline claims are one conditional write on MongoDB. Not run on a SQL adapter.
- **A crash between the two writes without transactions:** the snapshot is stored, then the proposal is claimed. A process killed in between leaves a staged version nobody accepted, to delete by hand. Not simulated; the README and ADR say so. With transactions both writes roll back together, and that is tested through the lost race.
- **HTTP routing and the admin:** the endpoints were called through their handlers, not over HTTP, and a proposal in the admin is a JSON field nobody has looked at. `apps/payload-example` will cover both.
- **A real site:** `nameOf`, `access.propose` and the tenant lookup were test doubles.
- **More than one accepted proposal in one version:** each acceptance starts from the published snapshot alone. Core's test accepts a second proposal over the first's version; the plugin has no path that combines two, and none is tested.
- **Large proposals:** `maxMoves` is tested at a small number, not at its default of 500 on a large classification, and accept time wasn't measured.

### Left out as overkill

- Every pair of statuses for every role: the transitions that are allowed are each tested, and the forged-field test covers setting a status directly.
- Racing more than two accepts: one winner out of two shows the claim.
- Payload's own behaviour: field validation of the relationship, pagination of `find`.

## 2026-11-11: Payload plugin part 3

Scope: `packages/payload` only (M7 part 3, ADR 0012 points 12 and 14): the atomic claim in `runImport` (`src/imports.ts`), and the `source` field on views (`src/collections.ts`, `src/views-api.ts`). No other package changed. Tests went from 442 to 457: payload 80 to 95 (`imports.test.ts` 20 to 24, and the new `view-reads.test.ts` with 11). Same setup as parts 1 and 2: a real Payload 3.93 with an in-memory MongoDB replica set, no network. `@payloadcms/graphql` was added as a dev dependency so a real GraphQL query could be run against the plugin's schema.

### Covered

- **One run at a time** (`imports.test.ts`, "claiming a job"): three runs of a queued job started together give one `done` and two 409s, one attempt on the job and one snapshot; a stale job taken over by two runs at once counts one more attempt, not two; a job whose `attempts` was never set can still be claimed, once; inside two transactions the loser's write conflict is answered with the same 409. Each of the four failed on the old read-then-write code before the change, and all passed five runs in a row afterwards.
- **A view's `source` equals the endpoints'** (`view-reads.test.ts`): for a current and a withdrawn snapshot, a reader's `findByID` of the view carries exactly the `source` the projection endpoint answers with.
- **Lists:** every view in a page is flagged, and a page of four views over two snapshots reads the snapshots twice, not four times.
- **The withdrawn snapshot stays hidden:** at depth 2 the view's `snapshot` is still a bare id for a reader, and reading the snapshot directly is "not found", while `source.withdrawn` is true.
- **Selection:** `select: { source: true }` answers the source without the snapshot reference; a selection without it leaves it out.
- **No source without the view:** a reader gets "not found" for a draft view and an anonymous request is refused; a manager sees a staged snapshot's status.
- **Never stored, never taken from input:** a forged `source` on create (as a manager and as server code) and on update is ignored, the true one is answered, and the stored document has no `source`.
- **Fresh in one request:** a withdrawal earlier in the same request is seen by the next read of the view in that request.
- **Gone snapshot:** `source` is null, not a guess.
- **GraphQL:** a list and a single view answer `source`, with and without `select: true`; an anonymous query is refused.
- **Generated types:** the JSON schema describes `source` as the object or null, with its six required keys and the three statuses.

### Gaps left

- **Postgres and SQLite:** the claim is one statement only on MongoDB as far as these tests show. On SQL adapters the unique index on id and version is the backstop, as before.
- **A run overtaken after `staleAfterMinutes`** still writes its own progress when it wakes; the claim guards the start only. Not simulated, since it needs a run held for 15 minutes or a fake clock inside a run.
- **HTTP routing:** REST wasn't called over HTTP; the Local API runs the same operations. `apps/payload-example` will cover it.
- **The admin:** how `source` renders in the edit view wasn't looked at.
- **Tenants:** `source` wasn't read in a tenant setup. It is only worked out for a view the requester could already read, and views and their snapshots share a tenant (part 1's tests), so no new path crosses tenants; a direct test is small and goes with the next part.

### Left out as overkill

- Racing more than three runs: one winner out of three shows the claim; more adds time, not coverage.
- Every GraphQL argument: the field resolves through the same `afterRead` hook as the Local API.

## 2026-11-11: Payload plugin part 2

Scope: `packages/payload` only (M7 part 2, ADR 0012 points 12 to 14): import jobs (`src/imports.ts`), coverage and snapshot export (`src/api.ts`), view projection and export (`src/views-api.ts`). No other package changed; the plugin now depends on `@captiveorigins/onetaxonomy-import`. Tests went from 395 to 429: payload 46 to 80 (`imports.test.ts` 20 new, `api.test.ts` 15 to 27, `tenants.test.ts` 7 to 9, and the plugin-shape test in `snapshots.test.ts` widened). All on a real Payload 3.93 with an in-memory MongoDB replica set, no network: the host `fetch` in the tests answers from memory and the upload collection writes to a temporary folder that is deleted afterwards. Endpoints were called through their handlers with a local request, as in part 1.

### Covered

- **Each format imports into a staged, sealed snapshot** (`imports.test.ts`): the CSV checklist upload, with the settings `examples/build-fixtures.mjs` uses, gives `fixtures/checklist.json` exactly, checksum and all; a Darwin Core Archive (ZIP of the same checklist) gives the same concepts; a Newick tree read through the host's `fetch`; NEXUS with its skipped-block warning and line recorded; phyloXML with its skipped `sequence` element recorded; a sealed OneTaxonomy JSON kept exactly as sealed. Each snapshot is `staged`, and the job records its five progress steps, input SHA-256 and checksum.
- **Idempotent:** the same file and settings in a new job ends `already-imported`, links the same snapshot and stores nothing; running a finished job again changes nothing (attempts unchanged); the same id and version with different content fails ("a changed dataset needs a new version") and stores nothing. With tenants, the same file in another tenant is that tenant's own snapshot, and again in the first tenant is `already-imported` (`tenants.test.ts`).
- **Refused input stores nothing:** malformed Newick (with position), malformed NEXUS (with line), a CSV missing its required columns (named), a dataset with a dangling reference (core's diagnostic code), a sealed JSON changed after sealing, a URL the host's `fetch` refuses, and a file over `maxBytes` each fail the job with the reason, and the snapshot count is unchanged. Settings that can't make a snapshot (no `createdAt`, no source, a tree without its id and version, both or neither input, adapter keys the plugin sets) and jobs that claim results or a status at creation are refused before a job exists.
- **Resume:** a job left `running` while parsing is refused (409) while fresh and starts again from the file once stale, saying where the last run stopped (attempts 2); a job that stopped after storing finishes `done` with its own snapshot and stores nothing new; a failed job can be run again; server code needs `overrideAccess` to run one (404 without).
- **Import access:** readers, anonymous requests and throwing host checks can't make jobs, and get the same 404 from `run` as for a missing job; readers can't list jobs; a job's settings and results can't be edited even by server code, its title can; another tenant's manager, a reader, a user with no tenant and a throwing tenant lookup can't see or run a job, can't make one in another tenant, and the tenant can't change. An imported snapshot is hidden from readers until published, then exports.
- **Coverage** (`api.test.ts`): root groups with every concept included by default; a listed selection with a hypothesis gives included, omitted branches, mapped and unmapped counts, and lists ids outside the classification; `knownToScience` is `not-stated`; no classification or too many groups is 400; an unknown classification, phylogeny or group is 404; host code gets the same access.
- **Projection:** a published view gives core's projection (a hidden node counted, not drawn) and its disclosure (hypothesis line, hidden count, data line, illustrative flag); a request's `limit` truncates and the disclosure says so.
- **Withdrawn source (the proposal):** a published view of a withdrawn snapshot projects and exports with `source.withdrawn: true` and the "Source withdrawn" line, while the snapshot itself stays 404 to readers.
- **A view changed in the database:** a view whose pinned checksum was edited directly in MongoDB answers 500 with the reason, not a projection.
- **Exports:** a published snapshot downloads exactly as sealed, as a JSON attachment with a safe file name; a view exports as its plain view file (read back with `parseView`), its source and disclosure lines.
- **Read access on the new endpoints:** draft views, staged and withdrawn snapshots, missing ids and malformed ids give readers the same 404; anonymous requests and throwing checks get 404; managers get drafts and staged snapshots; another tenant's reader and manager, no tenant and a throwing tenant lookup get 404 on coverage, both exports and the projection (`tenants.test.ts`).
- **Plugin shape:** without `imports` there is no imports collection; an `imports.uploads` that isn't an upload collection, and a taken imports slug, are refused.

### Gaps left

- **Not run in a real site:** no HTTP routing, Admin UI, GraphQL or cloud upload storage; the default upload reader is tested only on local storage. `apps/payload-example` will cover this.
- **Interruption inside a store** isn't simulated: that a run leaves no partial snapshot rests on the snapshot being one document written last, not on a test that kills a process mid-write.
- **Two runs of one job at once** weren't raced; claiming a job isn't atomic (ADR 0012). Closed in part 3, above.
- **Large inputs:** nothing near `maxBytes` was parsed for real, and an import's time on a large file wasn't measured.
- **Payload's own reads of a view** don't carry the withdrawn flag; only the plugin's endpoints do. That waits for the lead's decision on point 14. Accepted and closed in part 3, above.

### Left out as overkill

- Each adapter's own parsing rules: `packages/import` tests them; these tests check that each one is wired and its warnings and errors carried through.
- Every combination of adapter options: they go to the adapter unchanged.
## 2026-11-11: pan to the outline's selection

Scope: `packages/react` only (K495, ADR 0010's follow-up). Tests went from 395 to 408: react 102 to 115, all in the new `test/reveal.test.tsx`. Nothing else changed.

### Covered

- **The box math** (`revealBox`): a point clear of the 40 px margin gives no change; an off-screen point, and one inside the box but under the margin, pan the shortest way to the margin without zooming; the area SVG and the canvas letterbox beside a narrower box counts as on screen; points that can't fit zoom out by the smallest factor that puts both on the margin, keeping the aspect ratio; a box already zoomed out is never zoomed in.
- **SVG drawing:** selecting an off-screen taxon from the outline with Space pans it inside the margin and keeps the zoom; an on-screen taxon doesn't move the drawing; a taxon near the edge clicked in the drawing doesn't move it, and the same taxon chosen in the outline does.
- **Canvas drawing** (a made-up tree of 600 tips, drawn on canvas): an off-screen taxon chosen in the outline ends up drawn inside the margin of the 800 × 600 canvas; one already well inside leaves every drawn node where it was.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, and with no `matchMedia` at all, the box jumps and no animation frame is asked for. With `no-preference` nothing moves before the first frame, it's part way at 100 ms and there at 250 ms, with no frames left.
- **Focus stays in the outline:** after the selection, after a jump and after the last animation frame, on SVG and canvas.
- **Announcements:** a plain pan leaves the status region empty; a zoom out puts "Zoomed out to show the selection." in a `role="status"` region.
- **Stops for the person:** Fit during a glide cancels the remaining frames.

### Gaps left

- **No browser:** jsdom has no layout, so the SVG counts one unit per pixel; the real `getBoundingClientRect` sizing and the canvas's measured size are untested. The glide's smoothness wasn't seen.
- **No screen reader** confirmed that the status line is read once and a plain pan is silent.
- **Radial layouts** weren't tested separately; the math is the same for every layout.

### Left out as overkill

- Each easing value of the glide: the start, middle and end are checked.
- The repeat-announcement trick (a trailing no-break space when the same zoom note comes twice) is a known screen-reader workaround, not a promise.

## 2026-11-11: Payload plugin, part 1

Scope: the new `packages/payload` (`@captiveorigins/payload-plugin-onetaxonomy`, M7 part 1, ADR 0012). No other package changed. Tests went from 283 to 329: payload 0 to 46, in five files, each on a real Payload 3.93 with an in-memory MongoDB replica set (indexes built, no network; the MongoDB binary was already cached). Endpoints were called through their handlers with a local request, as the sister plugins do, not through Payload's HTTP routing.

### Covered

- **Sealed on the way in** (`snapshots.test.ts`): a snapshot changed after sealing, or with a made-up checksum, is refused, also for trusted server code; so is one without a checksum, of schema version 2, with a validation error (a dangling edge, sealed anyway), or not JSON. Id, version and checksum are taken from the snapshot, and given values that differ are refused.
- **No duplicates:** the same id and version is refused, with a different message when the content differs; the unique index on id and version exists in MongoDB.
- **Immutable content:** snapshot, checksum and version can't change while staged or once published, including from trusted code.
- **Staged versions:** new snapshots must start staged; publishing needs a signed-in manager and records who and when (trusted code without a user is refused); published can't go back to staged; who published can't be rewritten; withdrawn is final and hidden from readers; published snapshots can't be deleted even by trusted code; staged ones can, by managers only.
- **Checked again when read:** a published snapshot edited directly in MongoDB gets a 500 with a plain reason from the API, not an answer.
- **Search** (`api.test.ts`): exact before prefix, case aside; a split name gives both concepts; synonyms marked with their accepted name; common names only in the locale asked for (`de` finds "zweites Alpha", `en` and no locale don't); results capped at the plugin's limit with `truncated`, a request's own `limit` honoured and a larger one clamped; empty and over-long queries are 400; `searchNames` from host code applies the same access.
- **Ancestors and descendants:** classification parents with names; phylogeny descendants breadth first, cut by the result limit and by `maxDepth`, both reported as `truncated`; ancestors nearest first with tip labels and concepts; an unrooted phylogeny answers `indeterminate` with no items; unknown hierarchy or node is 404; no hierarchy, two hierarchies or no node is 400.
- **MRCA:** found in a rooted hypothesis, naming it; `none` across a forest; `indeterminate` when unrooted; a classification, too many nodes and no nodes are 400 with reasons; unknown nodes are 404.
- **Access fails closed:** on every endpoint, a staged snapshot, a missing id and a malformed id all give the same 404 body to a reader; anonymous requests and a host callback that throws give 404; readers, anonymous requests and throwing callbacks can't create; a callback returning a truthy value that isn't `true` is a no (`truthy-access.test.ts`); anonymous `find` is refused.
- **Tenants** (`tenants.test.ts`): a new record takes its maker's tenant; two tenants can store the same snapshot; naming another tenant is refused; each reader lists only their tenant's snapshots and can't read another's by id; every endpoint answers 404 to another tenant's reader and manager, to a user with no tenant and when the tenant lookup throws; another tenant's manager can't withdraw or delete; the tenant can't change, even from trusted code; a view can't use another tenant's snapshot, even from trusted code; views are listed per tenant.
- **Views** (`views.test.ts`): stored as drafts; refused when they pin another checksum, no checksum or another snapshot, when core finds unknown nodes or an unknown hierarchy, and when they aren't views; readers can't create; publishing waits for a published snapshot; drafts can change, published views can't (view, title or snapshot, even from trusted code) and can't be deleted; readers see only published views; withdrawn views drop out; drafts can be deleted; no new view over a withdrawn snapshot.
- **Core stays free of Payload:** no other package depends on or imports `payload` or `@payloadcms/*` (`snapshots.test.ts`). The plugin adds exactly its two collections and four endpoints.

### Gaps left

- **Not run in a real site:** no Next.js app, HTTP routing, Admin UI or GraphQL. The `apps/payload-example` part will cover this.
- **Postgres** isn't tested; the plugin uses no MongoDB-only features, but the JSON field and the compound index haven't been tried there.
- **Concurrent writes** of the same snapshot weren't raced; the unique index is shown to exist, not shown winning a race.
- **Large snapshots:** nothing near MongoDB's 16 MB document limit was tried, and the cost of the first load and checksum wasn't timed.
- **The index cache** isn't tested directly (eight entries, oldest dropped first).
- **A published view of a withdrawn snapshot** stays readable; that's a known open question in ADR 0012, not tested as a rule.

### Left out as overkill

- Payload's own field validation (required fields, select options) and its relationship checks.
- Every status transition pair: the allowed ones and three refused ones (published to staged, withdrawn to published, and starting published) are tested.
## 2026-11-11: OneOrigin brand source

Owner decision N105 (2026-11-11): "A: send it, accept guidelines (Recommended)". Tests went from 299 to 300: studio (Mac app) 40 to 41 (`apps/studio/test/theme.test.ts`). The rest are unchanged.

- **Promises:** `brand/oneorigin/` matches `brand/oneorigin.lock` byte for byte, and CI fails on a hand edit; `apps/studio/src/oneorigin.css` is what `build` writes from the copy's tokens; the app's shell colors are the suite's tokens; nothing that was drawn changes color.
- **Covered:** `node scripts/oneorigin.mjs check` in CI (11 files and the built CSS). `theme.test.ts` (1 new): `--bg`, `--panel`, `--text`, `--muted`, `--border`, `--accent`, `--focus` and `--error` in `app.css` equal the built `--ot-` tokens in light, system dark and a chosen Dark. The script itself is tested in OnePhylogeny, where it comes from (`scripts/oneorigin.test.mjs`, 19 tests: build output, lock and check passing, a hand edit failing, the warning paths); this repo carries the same file.
- **Gaps left:** the built CSS hasn't been looked at in the running app. The check downloads the locked files from OnePhylogeny's main branch to see whether the source differs; that only warns, and until OnePhylogeny's PR lands it warns that the files aren't there yet.
- **Left out as overkill:** repeating the script's tests here; they'd test the same file.

## 2026-11-11: Studio bundle

Scope: M6's `.onetaxonomy` bundle and relink flow, and the SQLite decision (ADR 0011, proposed: not needed now). Import gains `bundle.ts` (`writeBundle`, `readBundle`) and a ZIP writer in `zip.ts` (`writeZip`, `crc32`); core gains `sha256Bytes`; the Mac app gains `bundle.ts` (`planBundleOpen`, `keepPinned`, `relinkToAvailable`, `planBundleSave`, `bundleBytes`), `saveBundle` in `files.ts`, the Save as bundle and relink forms in `App.tsx`, and `fs:allow-write-file` in its capability file. Tests went from 299 to 348: core 105 to 106, import 42 to 63 (21 in the new `bundle.test.ts`), studio 40 to 67 (17 in the new `bundle.test.ts`, 5 in `files.test.ts`, 5 in `app.test.tsx`). Tauri was mocked throughout: dialogs and the file system are fakes that record calls, so no real disk, built app or screen reader was involved. The one outside check is the system `unzip -t` and `unzip -p` on a written bundle.

### Promises and the tests that hold them

- **Round trip.** A bundle with a snapshot, a view, a lesson and a binary media file reads back equal, with the manifest naming each file and role (import `bundle.test.ts`). In the Mac app, a bundle saved from an open checklist reads back with the right pin, and opening it shows the dataset and its view (`app.test.tsx`); a bundle built by `planBundleSave` opens again with the same dataset, view and lesson (studio `bundle.test.ts`).
- **Readable without the app.** The manifest is the first entry; every file's SHA-256 matches the manifest; the embedded snapshot is byte-for-byte what Save snapshot… writes; CRC-32 matches the standard check value; `unzip -t` reports no errors and `unzip -p` prints a view that parses to the original (skipped where `/usr/bin/unzip` is absent).
- **Each diagnostic, failing closed.** One test per code: not a ZIP (and a bundle cut short), no manifest, bad JSON in the manifest and in a view (with the manifest's checksum updated so only the JSON fails), not a bundle, unknown format version (message names both versions), a manifest missing its pins, a missing file, a checksum mismatch at the same size, a size mismatch, several problems listed together, an embedded snapshot edited after sealing (with the manifest updated to match), an embedded snapshot that isn't the pinned one, a view pinned to an unlisted version, and a path that climbs out of `media/`. Each returns `ok: false` with no bundle. Files the manifest doesn't list are left out with a note.
- **Never half a bundle.** A damaged bundle is refused with every problem in one message, and the Mac app keeps what was open (its title is unchanged, the alert names the file and the problem). A bundle whose view doesn't fit its own embedded dataset is refused whole. A bundle without its dataset, when that dataset isn't open, is refused with what to open first. More than one pinned dataset is refused with the reason.
- **Writing refuses what wouldn't read.** `writeBundle` throws on a view made with an unpinned snapshot, an unsafe media path, or no snapshot; duplicate ids get distinct file names.
- **Relink, never silently.** Same dataset open: no question. An unsealed copy with the same contents counts as the same. Another version open: the app asks, with the difference in words (by version, or by checksum when the version is the same); focus goes to the question's title. Keep uses the embedded copy; Relink moves every view and lesson to the open version and says so in the notes; Cancel changes nothing and says so. Relink is refused whole when a view doesn't fit the open version (a hidden node that release 2 lacks), and Keep still works after. Keep is disabled when the bundle has no embedded copy, and `aria-describedby` points at the reason.
- **Nothing written on cancel.** Cancel in the Save as bundle form and Cancel in the save dialog both leave the call log empty, and focus returns to Save as bundle…. Cancelling the relink question writes nothing.
- **Safe saves for bytes.** A bundle is written to `.tmp` with `writeFile` and renamed; a failed rename removes the `.tmp` and reports the original error; choosing the opened bundle (any letter case) is refused before writing; the dialog offers only `.onetaxonomy`.
- **Save form honesty.** It states what goes in (views, lessons, media, the dataset's id and version); views or lessons made with another version are listed as relinked before saving; anything that doesn't fit blocks the save. An unsealed dataset is pinned by the checksum it gets when sealed, which isn't called a relink. The manifest records the app's real version from `package.json`.
- **Permission the built app needs.** A test reads `src-tauri/capabilities/default.json` and requires `fs:allow-write-file` beside the text write, read, rename, remove and exists permissions (0.1.0 shipped without rename because tests don't run Tauri's checks).
- **`sha256Bytes`** matches `node:crypto` on 300 binary bytes and `sha256Hex` on text.

### Gaps left

- **Not tried in the built app.** The real Tauri file system, the save dialog's `.onetaxonomy` filter and the new permission haven't been exercised in a build. Owner or a build run: save a bundle, open it, open a damaged copy.
- **No screen reader.** The forms reuse the existing pattern (focus to the title, buttons, a labelled checkbox, `aria-describedby` for the disabled Keep), checked in jsdom only.
- **Lessons and media are carried, not shown.** The Mac app has no lesson player or media view; their round trip is tested, their display isn't part of this work.
- **Large datasets.** Only the fixtures (a few KB) were bundled. Hashing a large snapshot with the plain-TypeScript SHA-256 and holding the bundle in memory are untimed; ADR 0011 names this as the first thing to measure.
- **Offline journey.** Nothing in the bundle path uses the network, but the whole journey offline in the built app hasn't been walked through, so the backlog line stays open.
- **Deflated bundles** written by other tools are accepted by the reader (it reads Darwin Core Archives the same way), but no deflated bundle is in the tests.

### Left out as overkill

- ZIP header fields beyond what readers use (version made by, external attributes): `unzip -t` covers the archive as a whole.
- Each `bad-manifest` field separately: one missing-pins case covers the path, and the checks share one function.
## 2026-11-11: canvas renderer and benchmarks

Scope: M8's canvas renderer and benchmarks. React gains `CanvasTreeView`, chosen by `TreeView` above 1,000 drawn nodes, with its level of detail in a pure module (`canvasPlan.ts`: `prepareTree`, `planCanvas`, `hitTest`, `drawPlan`, `describeLod`), and `scripts/bench-canvas.mjs` writes `docs/benchmarks.md`. `shapes.tsx` now builds its SVG paths from `shapePolygon`, which the canvas uses too. Core, import, layout, education and the Mac app are unchanged. Tests went from 281 to 297: react 85 to 101 (14 in the new `canvas.test.tsx`, 2 in the new `svg-unchanged.test.tsx`). Everything ran in Node or jsdom, where a canvas can't paint: the drawing was checked by recording the calls made on a stand-in 2D context. No browser, screen reader or built app.

### Covered

- **The switch.** `chooseRenderer` gives SVG at 999 drawn nodes and canvas at 1,001, with the threshold at 1,000; `renderer="svg"` and `"canvas"` win over the count, `canvasThreshold` moves it, and folding a branch counts (a 1,001-node tree with one branch folded is SVG) (`canvas.test.tsx`).
- **The SVG is unchanged below the threshold.** Three snapshots written from the code before this change pin the whole markup: the checklist with a branch folded ("+n not shown"), and the amniotes radial and rectangular with two highlights, trait marks, a badge, a drag offset, a drop target and a selection. They still match after `TreeView` and `shapes.tsx` were refactored, and `renderer="svg"` gives the same markup as the default (`svg-unchanged.test.tsx`, `canvas.test.tsx`).
- **Accessible name and description.** The canvas is `role="img"`, named by the title, and described by the same sentence as the SVG's `desc` (the classification or phylogeny notice and "1199 of 1199 shown.") plus the level-of-detail note, which is also visible text. Nothing in the drawing has a `tabindex` (ADR 0010), and the explorer keeps its outline (`role="tree"`).
- **Which labels show.** At 1 px per unit (12 px text) every tip in view is named; at 0.7 (8.4 px) only the selection is, at 9 px and bold, and every other name is counted as left out, with the note "… names and values are too small or crowded to show. Zoom in to see them." Three tips 8 units apart with 12-unit text: the middle name overlaps the first and is left out and counted. Radial: all 8 names show on a small tree; on 800 tips, every name shown has its neighbours at least 0.9 of the text height away, and the rest are counted.
- **Wedges and disclosure.** On 5,000 tips at the fit zoom, subtrees under a pixel become wedges; the wedges' counts add up to the merged total, and drawn + merged + out of view equals every drawn node, so nothing goes missing uncounted. The note gives both numbers and, in the explorer, points to the outline. Zoomed in (1–2k nodes in view), nothing is merged. Radial layouts merge along the outer circle with the same accounting. The selection and the drop target are never merged.
- **Highlights keep shape and colour.** Close up, a node in the first highlight has its colour and a circle, one in the second a square, as `shapeAt` gives the SVG; zoomed out, wedges holding them carry the same colour and shape. The drawing of a square uses the same corners as the SVG path (`shapePolygon`), and the highlight colour is filled.
- **High density.** With a device pixel ratio of 2 the explorer's canvas is 1600 × 1200 for an 800 × 600 drawing, and `drawPlan` starts with a 2× transform.
- **Hit-testing and selection.** `hitTest` finds a node by its dot and by its name, a wedge by its centre, and nothing on empty canvas. In the explorer, zooming in with + and clicking a drawn tip on the canvas selects it: the inspector shows its name and the outline marks it selected; a click on empty canvas changes nothing.
- **Exports don't fail silently.** SVG download on a canvas tree writes the reason in the status region ("…Download PNG instead, or fold branches until the tree is drawn as SVG.").

### Gaps left

- **No paint was timed and nothing ran in a browser.** `docs/benchmarks.md` has Node timings for projection, layout, the plan and hit-testing on 1k, 10k and 50k made-up tips (planning one frame: at most 11 ms, the radial whole tree at 50,000 tips; under 2 ms for rectangular). Paint time, frame rate while panning, and how 2× density looks need WebKit or another browser. The machine was busy with other work during the run (load average about 21 on 12 cores), so the numbers are rough. Owner or a browser run: smoothness at 1–2k visible nodes, the threshold's placement, and a look at wedges, labels and dark mode.
- **PNG download on a canvas tree** uses `canvas.toBlob`, which jsdom doesn't have: not tested. Print shows the canvas as an image with the disclosure; not tested either.
- **The threshold is a judgment.** 1,000 drawn nodes wasn't measured against the SVG in a browser.
- **The outline isn't virtualized.** With 10,000+ rows it may be slower than the drawing; `projectView` still stops at 10,000 nodes by default and says so.
- **Text width is estimated** (0.6 em per character) so the plan is the same everywhere; long names in wide fonts can overlap slightly at the edges of the rule.
- **The note's wording** is English in `describeLod`; the explorer's `labels` don't cover it yet (a host can pass `lodNote` to `TreeView`, not to `Explorer`).
- **Dragging on the canvas** (reorder and Proposed-mode moves) goes through the same code as the SVG, offsetting the dragged subtree in the plan, but no test drags on the canvas.

### Left out as overkill

- Drawing every overlay through the recorder (support text, trait marks, badges, the axis): they use the same plan fields and drawing calls as the highlights, which are tested, and the SVG keeps its own tests for them.
- Repeating the explorer's toolbar, outline and inspector tests on a canvas tree: they don't depend on the renderer.
## 2026-11-11: focus ring colour

Scope: the focus-ring gap from the accessibility audit below, closed by owner decision N154 (2026-11-11, option A): "keep the brand orange everywhere else, but use the darker orange #a65f20 for focus rings on light backgrounds (4.6 to 1 or better). Dark mode keeps the lighter orange, which already passes." Only colour variables and focus rules changed; core, import, layout and education are unchanged. Tests went from 281 to 283: react 85 to 86 (`a11y.test.tsx`), studio 39 to 40 (`theme.test.ts`).

- **Before and after (focus colour on the background it sits on):** light, explorer, outline, lesson and tip-links rings (`--ot-focus`): `#cf8137` 3.07:1 on the surface (`#ffffff`), 2.88:1 on the panel (`#fbf7f4`); now `#a65f20`, 4.91:1 and 4.61:1. Light, studio rings: `--accent` `#cf8137` 3.07:1 on the page and fields, 2.89:1 on the toolbar (`#fdf7f7`); now `--focus` `#a65f20`, 4.91:1 and 4.63:1. Dark, unchanged: `#e7a066` 8.36:1 on the explorer surface (`#1c1311`), 7.85:1 on its panel (`#241916`); 8.37:1 on the studio page, 7.82:1 on its panel, 7.11:1 on fields.
- **Covered:** `a11y.test.tsx`: the contrast test now checks the focus ring on the panel as well as the surface (it checked only the surface, which is why 2.88:1 passed); a new test pins light `--ot-focus` at `#a65f20` (4.6:1 or better on surface and panel), dark at `#e7a066`, selection still `#cf8137`, and every outline focus rule on `var(--ot-focus)`. `theme.test.ts`: the studio's focus check now reads `--focus` on page, panel and field in light and dark (it read `--accent` on the page only); a new test pins `--focus` at `#a65f20` in light and `#e7a066` in both dark blocks, `--accent` still `#cf8137`, and both studio focus rules on `var(--focus)`. The existing check that a chosen appearance copies the library's values now covers the new `--ot-focus`.
- **Gaps left:** not looked at in the built app or a browser; the ratios are computed from the CSS. The canvas renderer being added in another branch should take its focus colour from `--ot-focus`.

## 2026-11-11: possible tip matches, long trees, more shapes, drawing focus

Scope: the gaps left by the linking and accessibility sections below. React gains `nearNameMatches` and paging in `TipLinker`, six more mark shapes, and ADR 0010 for drawing focus. Core, import and the Mac app are unchanged. Tests went from 267 to 281: react 71 to 85 (12 in the new `tipnear.test.tsx`, 2 in `a11y.test.tsx`). Everything ran in Node or jsdom: no screen reader, browser or built app.

### Covered

- **Near names are found by three rules, the closest first** (`tipnear.test.tsx`): underscores, spacing and case ("Alphus_primus", "deltus  SEXTUS"); a trailing specimen code left off ("Deltus_septimus_MZUSP1234", and "MZUSP 1234" and "KU-12345" in the unit test); one edit, including two letters swapped ("Epsilus octavsu") and one edit after a code is left off ("Gamus quartus_AB12"). A synonym found this way keeps its status. Capitals alone aren't a code, a label that is all code is left alone, and names under five letters aren't matched by one edit ("Bus" doesn't find "Bos").
- **Near names never act alone.** They're proposed only for tips with no exact match, aren't `bulk`, and "Accept all exact unique matches (1)" takes only the exact one; every row stays unlinked until a person chooses. They're listed in their own "Possible matches, not exact" region and in their own group in the row's list, each with "(not exact: <rule>)". The Link button is a toggle (`aria-pressed`) whose name starts with its visible text; linking says "(not exact)" in the status region, and pressing it again unlinks.
- **What was chosen is recorded.** `linkedPhylogeny` notes `near-name-confirmed` with the label, the name, the rule and what was left off; a taxon chosen another way stays `chosen-by-person`. The open snapshot's JSON is unchanged.
- **Long trees.** Over `pageSize` rows (default 200; 200 tips isn't paged, 201 is) the table shows one page, with "Tips 1–200 of 201" in a status region. Previous and Next move pages, and when one becomes disabled focus moves to the other. "List tips" narrows to one kind of match with counts; it filters on the kind of match, which linking doesn't change, so a row doesn't vanish when linked. Accept all still counts every tip, on any page.
- **Twelve shapes.** All closed paths, all different. Eight highlights on eight nodes draw the first eight shapes, and the legend shows the same eight; trait states get the twelve, then repeat (`a11y.test.tsx`).
- **Drawing focus (ADR 0010).** Drawing nodes keep `tabindex="-1"` inside a `role="img"` SVG, and the outline tree is one Tab stop. The ADR says why roving focus in the drawing wasn't added: the image role hides focusable children from screen readers, arrows already pan the canvas, and the order on screen depends on the layout.

### Gaps left

- **Authorship in a label** ("Alphus primus Fixture, 2026") and trinomials written differently still aren't matched: "2026" is left off as a code, but "Fixture," stays.
- **Near-name matching was timed only once,** on made-up data: 5,000 labels against 20,000 names took about 340 ms in Node. Not timed in WebKit.
- **The Not linked list under the table isn't paged.** It's plain text, one line per tip.
- **ADR 0010 is proposed, not accepted.** The owner may want roving focus in the drawing anyway.
- **Shapes at print size** and the new shapes in dark mode haven't been looked at. Past twelve, shapes repeat.
- **Not run for real:** VoiceOver on the possible-matches region, the toggle buttons and the page status.

### Left out as overkill

- Every label override, and more one-edit cases: `isOneEdit` is tested for each kind of edit and two near misses.

## 2026-11-11: rooting in describeView, two controls named "Show"

Scope: two gaps from the sections below. The rooting note moves from the explorer into core's `describeView`, and the two "Show" dropdowns get distinct names. Tests went from 263 to 267: core 101 to 105 (4 in `rooting.test.ts`); react (71) and the studio (39) have the same counts, with assertions changed and one added. Everything ran in Node or jsdom with Tauri mocked.

### Covered

- **Every `describeView` caller discloses rerooting.** For an outgroup rooting, the line after "Phylogenetic hypothesis:" is "Rooting (outgroup): " and the record's whole note, which names the outgroup and the record it came from. A midpoint rooting says "Rooting (midpoint): … it is not an outgroup rooting." A record without a note still gets the method, the outgroup by label and the source record ("Rooting (outgroup): on the outgroup A, from t version 1."), and one with only a method gets that. A tree with no rooting record, or marked unrooted, gets no line (`rooting.test.ts`).
- **The explorer shows core's line once.** The note under the toolbar and the About list both read "Rooting (outgroup): Rerooted on the outgroup Mammalia…", and About has it once (`getByText` fails on two) (`phylo.test.tsx`). The Mac app shows the same line for a tree rooted in the window (`app.test.tsx`).
- **Two "Show" dropdowns, two names.** The Mac app's header picker is "Show tree or classification" and the explorer's filter "Show living or extinct". Both start with the visible "Show" (2.5.3), and with a tree open both are in the window with those names (`app.test.tsx`, `a11y.test.tsx`).

### Gaps left

- **The explorer's filter name is a separate label** (`statusFilter`). A host that changes `status` should change it too; nothing checks that one contains the other.
- **Not run for real:** VoiceOver reading the two names, and the rooting line in a real export or print.

### Left out as overkill

- Testing the rooting line in each export format: SVG, PNG and print all take `describeView`'s lines, which the existing export tests already cover.

## 2026-11-11: accessibility gaps closed

Scope: the small and medium gaps from the accessibility audit below. The brand-orange focus ring is left as it is: that's the owner's decision (N154). Core and import are unchanged. Tests went from 248 to 263: react 58 to 71 (13 new in `a11y.test.tsx`), studio 37 to 39 (2 in `app.test.tsx`; `theme.test.ts` now checks the error color and the alert region). Everything ran in jsdom with Tauri mocked.

### Fixed, with tests

- **Reordering without dragging (2.5.7).** Move up and Move down in the inspector reorder a taxon among its siblings, one undo step each, like Alt+Up and Alt+Down. They're disabled at the ends and absent for a root or an only child.
- **Panning without dragging (2.5.7).** Pan left, right, up and down in the drawing controls move the view a tenth of its size, like the arrow keys. Each has a visible tooltip with its name, and Fit brings the view back.
- **The toolbar pattern.** Both `role="toolbar"` elements (the explorer's and the drawing controls) are one Tab stop. Left and Right move and wrap, Home and End jump, and disabled controls are skipped. The control last used keeps the stop, and if it becomes disabled (Undo, once undone) the first enabled one takes it. In the number field the arrows stay with the field. In a text field they move focus only from its start or end (no such field is in a toolbar yet, so that branch isn't tested).
- **Why a layout is unavailable** is visible text under the toolbar, one sentence per reason ("phylogram and time: A classification has no branch lengths or ages…"), and the layout select's `aria-describedby` points at it.
- **Fold arrows are 24 px** wide and at least 24 px tall (2.5.8). Leaves keep the same width so names line up. That widens each level of the outline by 8 px.
- **Highlights and trait states by shape (1.4.1).** Each highlight's halo, and each trait state's mark, has a shape by its place in the list: circle, square, diamond, triangle, upside-down triangle, hexagon. The legend shows the same shape beside each name. Halos now have a full-color outline, and trait marks a thin ink outline, so pale colors from the data still show an edge. Mixed states stay a dashed outline. The test uses two states one hex digit apart, which only the shape tells apart.
- **The Mac app moves focus to the forms it opens.** That covers tree questions, column choices, Settings, and linking tips (since the previous section). Cancel and Done return focus to the button that opened the form.
- **The Mac app's errors go to an alert region** (`role="alert"`). It is mounted empty before the first error, is separate from the status line, and is cleared by the next success. The error color is 4.5:1 or more on the page and the panel in light and dark.

### Gaps left

- **The focus ring** is 2.88:1 on the panels: owner decision N154. Since fixed: see "2026-11-11: focus ring colour".
- **Shapes repeat after six** highlights or trait states. Past that, color and the words in the inspector and legend tell them apart. (Addressed in "possible tip matches" above.)
- **Only the first highlight on a node is drawn.** That hasn't changed: a node in two highlights shows one halo.
- **The drawing's nodes still aren't reachable with Tab** (the outline is the way in; why is now ADR 0010), and live regions that mount with their first message (the clade check with a second taxon) still need a screen reader to confirm.
- **Not run for real:** VoiceOver, keyboard use in WebKit and the built app, and how the shapes look at print size.

### Left out as overkill

- Testing every toolbar control in turn: the pattern is one function over whatever controls are present, and the tests cover moving, wrapping, skipping disabled controls, selects and the number field.

## 2026-11-11: linking tree tips to taxa

Scope: the gap left in the section below ("Comparison in the Mac app always refuses files it imports itself"). React gains `TipLinker`, `proposeTipLinks` and `linkedPhylogeny`; the Mac app gains "Link tips to taxa…" and "Add tree…". Core and import are unchanged. Tests went from 228 to 248: react 44 to 58 (`tiplinks.test.tsx`, 14 new), studio 31 to 37 (2 in `open.test.ts`, 2 in `files.test.ts`, 2 in `app.test.tsx`; the theme test now finds the library's colors under the new `.ot-tip-links` scope). Everything ran in jsdom with Tauri mocked: no screen reader, browser or built app.

### Covered

- **Nothing is linked silently.** On opening, every tip is unlinked and listed, and the "make" button is disabled. Proposals are exact names, letter case aside, through core's `findByName`: an accepted name and a synonym are each one unique match, two taxa with one name are ambiguous, a misapplied name is proposed with "check before accepting", and internal nodes are never matched (`tiplinks.test.tsx`).
- **Accept all is one explicit action that says how many.** Its button reads "Accept all exact unique matches (2)", it takes only accepted-name and synonym matches (not the misapplied or ambiguous ones), says "Accepted 2 exact unique matches." in the status region, never re-links a tip the person left unlinked or one that was already linked, and is disabled with "No exact unique matches to accept" when there are none.
- **Accept, change, leave.** One proposal accepted with its row's button (named "Accept Zetus nonus for Zetus decimus", which starts with its visible text); a homonym chosen in the select, which lists every candidate with authorship, rank, source and id; a link removed ("Alphus primus left unlinked."). Each decision is announced in a status region that is mounted and empty before the first one.
- **Keyboard.** Focus moves to the step's title when it opens. "Another taxon…" puts focus in a name field: Enter links the one taxon with that exact name, says when none has it, offers every taxon when several do (without choosing), and does nothing when the field is empty; Escape closes it. The table has a caption and column and row headers. In the Mac app, Cancel and confirming return focus to "Link tips to taxa…".
- **The open snapshot is never changed.** `linkedPhylogeny` and `TipLinker` leave a sealed snapshot's JSON unchanged; the new record has a free id, only the changed tips' `concepts` (the model's explicit mapping), a `conceptLink` annotation saying whether the person confirmed a name match or chose the taxon, and the same edges. It validates, and an unknown concept or node is refused.
- **Linking makes comparison possible, and its limit is shown.** The imported tree is refused by `comparePhylogenies`; the linked one compares. One taxon on two tips is flagged with the reason comparison would refuse it.
- **Mac app, end to end.** A tree opened alone gets the plain reason no tip can match and how to fix it. With the fixture checklist open: Add tree… shows only tree files, adds the tree as a new snapshot and shows it; linking it makes "alpha (tips linked)" and shows it; a second tree likewise; "Compare with…" then gives Robinson-Foulds 4 on 4 shared tips. Saving over the added tree file is refused before anything is written; saving elsewhere writes a sealed file with all four trees, the imported ones still unlinked (`app.test.tsx`).
- **Adding trees.** `withTrees` renames a source or tree id already in use (a checklist and a tree both named "alpha" is likely), keeps the trees' source references right, never links a tip, leaves the open snapshot unchanged, and refuses a file that brings taxa or a classification (taxonomies are never merged) or no tree (`open.test.ts`). `saveJson` refuses every file the dataset came from (`files.test.ts`).

### Gaps left

- **Only exact names are proposed.** Spelling variants, authorship in the label ("Alphus primus Fixture, 2026"), trinomials written differently, and labels with specimen codes ("Alphus_primus_AB123") match nothing and must be found by hand. Fuzzy or rule-based matching would be a separate, labelled method, and is a decision for the lead. (Addressed in "possible tip matches" above.)
- **Long trees.** Every tip is a table row with a select. Not timed beyond the fixtures; a tree with thousands of tips may want paging or a filter for unmatched rows. (Addressed in "possible tip matches" above.)
- **Not run for real:** VoiceOver reading the table, the selects' optgroups and the status region; the datalist suggestions in WebKit; the Tauri dialogs and writes in the built app.
- **Add tree… needs the taxa first.** A tree opened alone can't be linked: the step says so. Opening a snapshot that holds both is the other way in.

### Left out as overkill

- Every label override: plain strings in one `labels` object, like the explorer's.
- More `findByName` cases: core's own tests cover its case-folding and ambiguity.

## 2026-11-11: controls for comparison, rooting and support collapse

Scope: the explorer and Mac app controls for the features in the previous section: the support threshold, "Compare with…", rerooting and midpoint rooting, and opening NEXUS and phyloXML in the Mac app. Core and import are unchanged. Tests went from 202 to 228: react 29 to 44 (`phylo.test.tsx`, 15 new), studio 20 to 31 (6 in `open.test.ts`, 1 in `files.test.ts`, 4 in the new `app.test.tsx`, which renders the whole window in jsdom with Tauri mocked). Core (101), import (42), layout (6) and education (4) are unchanged. Everything ran in jsdom: no screen reader, browser or built app.

### Covered

- **Support threshold.** Typing "7" then "70" applies nothing until Enter, so it's one undo step; Enter and leaving the field both apply it, and an empty field clears it. The summary ("2 branches below 70 collapsed; 1 has no support value.") is in a status region that is mounted, empty, before the first message; About gives the core's longer disclosure. Undo brings back every branch and empties the field. Clear is named "Clear support threshold", which contains its visible text, and is disabled when nothing is set. For a classification the field is disabled and its `aria-describedby` points at the visible reason. Singular and plural wording (`phylo.test.tsx`).
- **Compare with…** Only offered when there's another phylogeny. On the two amniote fixtures: distance 2, normalized 0.25, rooted, 6 shared tips, the clade each tree has that the other lacks, and "None" for tips in one tree only. Changing the mode and the tree (selects, so keyboard-operable) updates the status sentence; a given tree missing one tip is reported as "only in" with the core's note. Tips without concept mappings give the core's refusal, and no distance is shown. "Select" on a differing clade selects it in the drawing (`phylo.test.tsx`).
- **Rooting never changes the record shown.** Rooting on a tip and on a clade (every tip under it) hands a new record to `onRooted` with a new id, the method, the outgroup and the source record, and the sealed snapshot's JSON is unchanged afterwards. Midpoint rooting skips an id that's already taken. A refusal (no branch lengths, the whole tree as outgroup) is shown in the status region and nothing is handed on. No outgroup button on the root, and no rooting controls without `onRooted`. A rooted record's note is shown under the toolbar and in About (`phylo.test.tsx`).
- **Mac app: the rooted tree is a new snapshot and a new file.** `withPhylogeny` leaves the open (sealed, frozen) snapshot unchanged and still verifying, drops the checksum, records `derivedFrom`, refuses a duplicate id, and seals on save (`open.test.ts`). In the window: rooting a tip from a NEXUS file shows the new tree with its note and says the file is unchanged; choosing the opened file in the save dialog is refused before anything is written; saving elsewhere writes the temporary file and renames it, and the saved file holds all three trees and verifies (`app.test.tsx`). `saveJson` refuses the opened path in any letter case (`files.test.ts`).
- **Mac app: NEXUS and phyloXML.** Every extension in the open dialog maps to a kind; `.tre` with `#NEXUS` at the top (after comments) is NEXUS, otherwise Newick. Rooting is asked only when a NEXUS `TREE` has no [&R] or [&U] (a BEAST-style comment with "=" before the tree's "=" doesn't confuse it) or a phyloXML `<phylogeny>` has no `rooted`; paired support is noticed in NEXUS. TRANSLATE names reach the tips, nothing is mapped to taxa, and skipped parts become notes with their line ("Line 2: TAXA block is not read"). In the window, a NEXUS file opens through the mocked dialog with that note in the list, and a file that leaves rooting unsaid gets the question (`open.test.ts`, `app.test.tsx`).

### Gaps left

- **Comparison in the Mac app always refuses files it imports itself.** Newick, NEXUS and phyloXML tips are never mapped to taxa (by design: no matching by label), and comparison needs mappings. It works on snapshots that carry mappings. A way to map tips explicitly in the app (a mapping table the person confirms) is a feature, for the lead's list.
- **Two controls are named "Show"** in the Mac app: the header's tree or classification picker and the explorer's living/extinct filter. They existed before; a clearer name for the header one ("Tree or classification") is a small wording change left to the owner. (Closed in "rooting in describeView" above.)
- **Differing clades aren't highlighted in the drawing.** "Select" puts one in the selection; drawing all of them at once would need a highlight that isn't saved in the view. Clades only in the other tree have no node here, so they're listed only.
- **The rooting note is added by the explorer, not by `describeView`.** Exports from the explorer include it; another app calling `describeView` directly won't see it. Adding it in core would change core's output, which this branch was asked not to do. (Closed in "rooting in describeView" above.)
- **Not run for real:** VoiceOver reading the status regions, the number field's spinner and Enter in WebKit, and the Tauri dialogs and file writes in the built app. NEXUS and phyloXML were tried only on made-up files.
- **Saving over the opened file is refused by path, letter case aside.** A symlink or another path to the same file isn't caught.

### Left out as overkill

- Comparison and rooting results in more cases: core's tests already cover them; the UI tests check that results and refusals are shown.
- Every label override: they're plain strings in the same `labels` object as the rest.

## 2026-11-11: phylogeny comparison, rooting and new importers

Scope: the M8 science items that need no owner data: `comparePhylogenies`, `rerootPhylogeny` and `midpointRoot`, the `collapseBelowSupport` view action, and the NEXUS and phyloXML readers. Tests went from 145 to 188: core 70 to 101, import 30 to 42. Layout (6), education (4), react (18) and the studio (17) are unchanged.

### Covered

- **Robinson-Foulds values worked out by hand** on 3- to 7-tip trees: two 5-tip trees with no split in common (4 of 4), rooted versus unrooted on the same pair (2 of 6 and 2 of 4), the same unrooted tree stored from different nodes (0), a different root on one topology (2 rooted, 0 unrooted), a polytomy against its resolution (1), and too few shared tips to normalize (`null`) (`compare.test.ts`).
- **Tips in only one tree are reported and left out of the distance,** never pruned silently (`compare.test.ts`).
- **Refusals that must fail closed:** unmapped tips (never matched by label), one concept on two tips, a tip with two concepts, forests, and rooted comparison of an unrooted tree (`compare.test.ts`). Rooting refuses outgroups that aren't a clade under any rooting, internal nodes, unknown ids, the whole tree, an empty outgroup, forests, time-calibrated trees and, for midpoint rooting, missing branch lengths (`rooting.test.ts`).
- **Support stays with its split when rerooting.** `(((A,B)95,C)70,D)` rooted on A puts 95 on the clade (C,D), which is what 95 measured (`rooting.test.ts`). This is a known mistake in tree software, so it gets its own test.
- **The rooted record states what was done** (method, outgroup, source record, where on the branch the root went), validates with `validateDataset` and the JSON Schema, and has Robinson-Foulds 0 against its input when compared unrooted (`rooting.test.ts`).
- **Sealed snapshots are never changed:** comparison, rerooting, midpoint rooting and support collapsing all run on a sealed snapshot whose JSON and checksum are unchanged afterwards, and the rooted records share no objects with it (`compare.test.ts`, `rooting.test.ts`, `support-collapse.test.ts`).
- **Support collapsing is disclosed** in the projection and in `describeView`. A branch with no support value is never collapsed and is counted, a missing length stays missing, distances from the root are kept, a branch the user folded is left alone, and classifications and non-numeric thresholds are refused (`support-collapse.test.ts`).
- **NEXUS:** TRANSLATE tables, `[&R]`, `[&U]`, `UTREE` and the `rooted` option, mapping on translated names (not table numbers), skipped blocks and untranslated tips as warnings, and ten malformed files refused with the right line (`nexus.test.ts`).
- **phyloXML:** clades, names, both forms of branch length, several confidence values with their types, taxonomy ids for mapping, skipped elements as warnings, 5,000-deep nesting, and thirteen malformed files refused with the line and element, including a DOCTYPE that could declare entities (`phyloxml.test.ts`).
- Both readers produce snapshots that validate and seal, and carry the source's license.

### Gaps left

- The NEXUS and phyloXML readers are tested on hand-written files only. Real exports from MrBayes, BEAST, PAUP, Mesquite and Archaeopteryx should be tried once the owner has files to share; none were downloaded, as the tests use no network.
- Comparison and rooting haven't been timed on large trees (10k+ tips). That belongs with the M8 benchmarks.
- Trees with one-child internal nodes aren't tested for rerooting. The code keeps such nodes as they are.
- The explorer, layouts and Mac app have no controls or tests for these features yet. The explorer and the Mac app were being changed in another branch, so they were left alone.

### Left out as overkill

- More Robinson-Foulds cases. The ones above cover each branch of the code (shared and unshared tips, rooted and unrooted, polytomies, nothing to normalize).
- Every phyloXML element the reader skips. They share one code path, and two are tested.
## 2026-11-11: accessibility audit

Scope: milestone M8's accessibility audit. A code-level check of the React components (`TreeView`, `TreeOutline`, `Explorer` with its inspector, view controls and menus, `LessonPlayer`) and the Mac app (`apps/studio`) against WCAG 2.2 AA. The education package has no UI of its own; its lessons are checked through `LessonPlayer`. No screen reader was run, and nothing was looked at in a real browser or the built app: the tests render into jsdom or to a string, and contrast is computed from the CSS variables. Tests went from 145 to 158: react 18 to 29 (`a11y.test.tsx`, 11 new), studio 17 to 20 (`theme.test.ts`, 3 new). Core, import, layout and education are unchanged.

### Checked and already right

- **Names (2.5.3, 4.1.2).** Every toolbar, inspector, proposal and lesson button has its visible text as its name. The icon-only canvas buttons (zoom, fit, download, print) have an `aria-label` that matches their visible tooltip. Selects and inputs are inside their labels.
- **Keyboard (2.1.1).** Every drawing action has a keyboard path: the outline (select, fold, Alt+Up/Down to reorder), the inspector (flip, focus, clade check, "Move under" in Proposed mode), the toolbar and the canvas buttons. The outline keys in the README all work; the new test walks through each of them (Home, End, Right to open and to the first child, Left to the parent, Enter, Space, Shift+Space, `*`, plus type-ahead and Alt+arrows in the existing tests).
- **Focus (2.4.7).** Buttons, selects, the canvas and outline rows have a 2 px focus ring; the studio sets one on everything with `:focus-visible`.
- **Reduced motion (2.3.3, as a courtesy).** The only animation, nodes sliding after a change, runs only under `prefers-reduced-motion: no-preference`. Now covered by a test of the stylesheet.
- **Not by color alone (1.4.1).** Classification vs phylogeny is said in words in the legend, the drawing's description and every export. Folded branches are a triangle plus "(12 not shown)". Weak support is a dashed edge with the legend "Weak support (dashed)". Extinct taxa are a hollow dot and †. Moved taxa in Proposed mode are italic and underlined. A clade check's answer is in words.
- **Status messages (4.1.3).** The studio's status line is a status region that is always present (tested on 2026-11-11, earlier).
- **Contrast that already passed.** Light: text 15.73:1 and muted 5.88:1 on white (14.76 and 5.52 on the panel), edges 3.25:1, node ink 11.78:1. Dark: text 16.12:1, muted 8.36:1, edges 4.18:1, node ink 9.45:1, selection 8.36:1. Studio light and dark text and muted text are 5.55:1 or more on every background.

### Fixed, with tests

- **Selected text was 3.07:1.** The brand orange `#cf8137` was used for text (selected node labels, the selected outline row, drop targets, the "Proposed by" badge): 3.07:1 on white, 2.88:1 on the panel. Text now uses a new `--ot-selected-text`, `#a65f20` in light (4.91:1 on white, 4.61:1 on the panel) and the existing `#e7a066` in dark (8.36:1). Fills and the focus ring keep the brand orange.
- **The "Proposed by" badge was orange on white in dark mode, 2.18:1.** It used an undefined `--ot-bg` with a white fallback. It now uses `--ot-surface` and `--ot-selected-text` (8.36:1 in dark, 4.91:1 in light).
- **Warnings and errors failed in dark mode.** Weak-support values and cautions (`#b45309`) were 3.63:1 and 3.41:1, and errors (`#b91c1c`) 2.82:1, on the dark background. New `--ot-warning` and `--ot-error` keep the light values (5.02:1 and 6.47:1 on white; cautions 4.71:1 on the panel) and use `#fbbf24` (10.93:1) and `#f87171` (6.60:1) in dark.
- **Lesson marker digits were 3.07:1** (white on orange, 2.18:1 in dark). They're now `#1d2330`: 5.13:1 on `#cf8137`, 7.20:1 on `#e7a066`.
- **Text fields had 1.33:1 borders** (1.31:1 in the studio), too faint to find the field (1.4.11). Explorer and lesson fields now use `--ot-field-border` (`#a08a83`, 3.25:1 on white, 3.05:1 on the panel; dark `#8a7470`, 4.18:1). Studio inputs use `--field-border` (`#968485`, 3.54:1 on white; dark `#6b7383`, 3.26:1 on the field, 3.83:1 on the page).
- **Light or Dark in the studio's Settings didn't reach the explorer.** The explorer's colors follow the system through a media query, so Light on a dark Mac drew `#eef1f6` text on a white page (1.13:1), and Dark on a light Mac drew `#1d2330` on `#12151b` (1.16:1). `app.css` now sets the explorer's variables for a chosen appearance; a test keeps them equal to the library's.
- **Exported SVGs weren't valid XML in tests.** `standaloneSvg` set `xmlns` as a plain attribute, and the serializer added its own, so the file had it twice and an XML parser refused it. It's now set as a namespace declaration, once. The white background was also put before `<title>`; the title and description now come first. Whether browsers wrote the attribute twice wasn't checked; jsdom did. The new test parses the export and finds the title and description through `aria-labelledby` and `aria-describedby`.
- **A failed PNG export said nothing.** `download` had no `catch`, so an error was an unhandled rejection. It now reports "Could not export the drawing: …" in the explorer's status region.
- **The explorer's status region appeared with its message.** A live region added together with its text often isn't announced. The region (`.ot-error`, `role="status"`) is now always there and empty until needed. The clade check's answer sits in a status region that stays mounted as the selection changes.
- **The download menu was a menu in name only.** It had `role="menu"` but focus stayed on the button and arrow keys did nothing. Opening it now moves focus to the first item; Up, Down, Home and End move; Escape and Tab close it and return focus to the button.
- **Drawing keys weren't written down.** The canvas handled arrows, + and −, 0 and Escape, but its label only described the mouse. The label now lists the keys, and the inspector's hint lists the outline keys.
- **† was read as "dagger".** The outline hides the mark from screen readers and adds "(extinct)" in its place (`extinctLabel`, replaceable). The tree also sets `aria-multiselectable`, since Shift+Space and Shift-click add to the selection.
- **Lesson modes were three Tab stops with no arrow keys.** The mode switcher is a radio group, so it's now one Tab stop and the arrow keys move and choose.
- **A lesson caution was shown only in amber.** It now starts with "Caution:" (replaceable `caution` label).
- **Remove buttons on highlights were 20 px**, under the 24 px minimum (2.5.8). Now 24 px.
- **The studio window had no level-one heading.** The file name in the toolbar is now the `h1`, styled as before.

### Gaps left

- **The brand-orange focus ring is 2.88:1 on the explorer panel** (`#cf8137` on `#fbf7f4`) and 2.89:1 on the studio toolbar (`#fdf7f7`), under 3:1. It's 3.07:1 on white and 7.8:1 or more in dark. `brand/README.md` names this exact color for focus and is kept identical across the One tools, so changing it is the owner's call: a deeper orange such as `#a65f20` for the ring, or panels close to white (`#fefcfb` gives 3.00:1). **Fixed 2026-11-11** (owner decision N154, option A): the ring is now `#a65f20` in light, 4.61:1 on the explorer panel and 4.63:1 on the studio toolbar; dark keeps `#e7a066`. See "2026-11-11: focus ring colour" above.
- **Highlights and trait states are told apart by color in the drawing.** Each node's highlights and trait state are in words in the inspector, and the legend names each color, but the halos (35% opacity) and trait dots have no shape or pattern of their own, and trait colors come from the data unchecked. Fixing it means a shape or letter per highlight or state: a design change.
- **Dragging has no single-pointer alternative for two actions (2.5.7).** Reordering siblings (Alt+Up/Down in the outline is keyboard only; "Flip children" only reverses) and panning (zoom and fit are buttons, panning isn't). Moving under a new parent has the "Move under" list. Small "move up/down" buttons in the inspector and pan buttons would close it.
- **The drawing's nodes are `role="button"` inside an SVG with `role="img"`,** whose children screen readers ignore, and they can't be reached with Tab. The outline is the accessible way to the same nodes, by design. Making the drawing itself navigable is larger and overlaps the planned canvas renderer.
- **The explorer toolbar is `role="toolbar"` without arrow-key movement.** Every control is reachable with Tab, so nothing is lost, but the role promises arrows. Either add a roving tab stop or drop the role.
- **Why a layout is unavailable is only in the option's `title`,** which a keyboard or screen-reader user may not get.
- **Outline fold arrows are 16 px wide** (2.5.8). Enter, Right and Left, and double-click in the drawing, also fold, but no pointer alternative of 24 px exists. Making them wider shifts the outline's indent.
- **The studio doesn't move focus to the forms it opens** (Newick questions, column choices, Settings), and errors go to the polite status line rather than an alert.
- **Live regions that mount with their first message** (the clade check when a second taxon is added) may not be announced. Only a screen reader can confirm.
- **Never run with a screen reader or in a browser.** VoiceOver, keyboard use in the built Mac app, and real rendering (focus rings on SVG, `:has()` borders, the PNG export) need a check by hand.

### Left out as overkill

- Contrast of disabled controls (exempt in 1.4.3) and of decorative panel borders (`--ot-border`, 1.33:1): buttons are identified by their text.
- Re-testing the outline keys that the existing tests already cover (type-ahead, Alt+arrows).

## 2026-11-11: unsealed notice and temporary-file cleanup in the studio

Scope: the two studio gaps left on 2026-11-10. Tests went from 142 to 145, all in the studio (14 to 17). The packages are unchanged.

### Fixed, with tests

- **An unsealed snapshot opened with no notice.** `openSnapshot` now returns a `seal` notice for `unsealed` ("This snapshot isn't sealed, so changes to it since it was made can't be detected.") and for `mismatch`, and the studio shows it in its status region, outside the collapsed list of notes, so a screen reader announces it on opening. A sealed file gets none. `mismatch` is still the first note as before (`open.test.ts`, 2 tests: the notice for sealed, stripped and edited files, and where `StatusBar` renders it).
- **A failed rename left `<file>.tmp` beside the chosen file.** A failed write or rename now removes the temporary file and reports the original error unchanged. If removing fails too, the error says so and names the file, with the original error as its `cause`. This mirrors the OnePhylogeny CLI store's fix of 2026-11-09, which drops the cleanup error instead (`files.test.ts`, 2 tests).
- **Saving was never allowed to rename.** Found while fixing the above: the studio's capabilities didn't grant `fs:allow-rename`, so in the real app every save would fail at the rename and leave the temporary file. They now grant `fs:allow-rename` and `fs:allow-remove`. The tests mock Tauri, so they couldn't catch this.

### Gaps left

- The Tauri file calls and the capability check are mocked. Saving on a real disk, including the rename now being allowed, needs a check by hand in a built app.
- The notice is checked by rendering `StatusBar` to a string. How VoiceOver reads it in the app hasn't been tried.

## 2026-11-10: full audit

Scope: every package and the studio app, against the README, the invariants table (I1 to I18), limitations.md and the ADRs. No coverage output exists in the repo, so this maps promises to tests by reading them. The source hasn't changed since the first audit apart from the release, so this pass looked hardest at the data-safety checks. Tests went from 133 to 142: core 66 to 70, import 28 to 30, studio 11 to 14. Layout (6), education (4) and react (18) are unchanged.

### Covered

- I1 to I13 and I15 to I18 still name passing tests in the invariants table. I14 (inferred traits) is still M8 and untested, as limitations.md says.
- Snapshot sealing: SHA-256 against the standard vectors, freezing, key order not mattering, and an edited snapshot failing `verifySnapshot` (`validation.test.ts`). `readSnapshotJson` reports `verified` and `mismatch` and refuses an unsupported schema version (import `curation.test.ts`). The studio flags a sealed file edited afterwards (`open.test.ts`).
- Community presets refuse shadow data and report pins whose checksum no longer matches (import `curation.test.ts`).
- ZIP reading refuses entries that are cut short or the wrong size (`dwca.test.ts`).
- Studio saving is atomic, and a failed write leaves the old file alone (`files.test.ts`, Tauri mocked). Update checks stay off while releases are unsigned (`updates.test.ts`).
- The refusals: unrooted trees, soft polytomies, unmapped taxa and Newick files with unknown rooting give `indeterminate` or an error, never a guess (`monophyly.test.ts`, `open.test.ts`).

### Gaps added (with the tests)

- **A snapshot with no checksum never verifies.** `verifySnapshot` with the checksum missing or empty is false (`validation.test.ts`).
- **Sealing doesn't touch the caller's object,** and re-sealing replaces a stale checksum with the right one (`validation.test.ts`).
- **A view pinned to the same snapshot id and version but another checksum is flagged** `snapshot-mismatch`. Before, only a different id was tested (`view.test.ts`).
- **`parseView` refuses text that isn't a view** (`view.test.ts`).
- **`readSnapshotJson` says `unsealed` for a file with no checksum and `mismatch` for an empty one,** never `verified`. It refuses a file with no concepts array or no `phylogenies` array rather than reading it in part (import `curation.test.ts`, 2 tests).
- **Studio:** cancelling the save dialog writes nothing, and a failed rename is reported as an error, not as a save (`files.test.ts`, 2 tests). Saving a sealed copy leaves the open snapshot unfrozen and unchanged (`open.test.ts`).

All new tests passed on the current code. No bug was found.

### Gaps left

- **The studio says nothing when it opens an unsealed snapshot.** `readSnapshotJson` reports `unsealed`, but `openSnapshot` only warns on `mismatch`. A sealed file whose `checksum` line was deleted therefore opens with no notice. A notice such as "This file isn't sealed, so later changes to it can't be detected" is a small change to `apps/studio/src/open.ts` plus one test. It changes what the app shows, so it's left for the lead rather than done in an audit.
- **A failed rename leaves `<file>.tmp` beside the chosen file.** The old file is safe and the error is shown, but the temporary file isn't removed. Minor; fix with the next studio change.
- CRC checks on ZIP entries, and large archives read into memory, as in the first audit. Both are stated limitations.
- The studio's dialogs and file calls are mocked. Saving on a real disk is only checked by hand.

### Left out as overkill

- More SHA-256 vectors. Three standard vectors plus a multi-byte string already cover padding and UTF-8.
- Rendering details of the React explorer, and the playground and examples apps, as before.

## 2026-11-08: first audit

Scope: every package and the studio app. Coverage numbers weren't collected; this maps promises to tests by reading them. OneTaxonomy has no accounts or access rules, so the "always covered" items here are data safety and the checks that must refuse rather than guess.

### Where the promises are

- The science: invariants I1 to I18 in [scientific-invariants.md](architecture/scientific-invariants.md). Each row names its tests, and that table stays the map for them.
- What isn't done: [limitations.md](architecture/limitations.md).

### Covered

- I1 to I13 and I15 to I18 name passing tests in the invariants table. These include the refusals: unrooted trees and soft polytomies give `indeterminate` (I4 to I6), unmapped taxa stay unmapped (I7), and nothing is merged or repaired silently (I10, I15, I17, I18).
- I14 (inferred traits are labelled) has no test because nothing infers traits yet. It's planned for M8, and limitations.md says so.
- Studio: opening refuses a tree whose rooting is unknown instead of assuming it, and flags a sealed snapshot that was edited afterwards (`open.test.ts`). Update checks stay off while releases are unsigned (`updates.test.ts`).

### Fixed in this pass

- **A cut-short or mis-sized ZIP entry was read silently.** CRCs aren't checked (a stated limitation), and the reader also took an entry at its word. A stored entry that ran past the end of the archive came back truncated, and a deflated entry was never compared with its stated size. Both are now refused with a `ZipError` naming the file (`dwca.test.ts`, "refuses an entry that is cut short"). The test failed before the fix.
- **Studio saving had no test.** Its atomic save (write a temporary file, then rename it) is now tested, including that a failed write leaves the old file untouched (`apps/studio/test/files.test.ts`, with the Tauri file calls mocked).

### Gaps left

- **CRC checks on ZIP entries.** Still a stated limitation. The size checks above catch truncation, but not bytes that were changed in place. Worth adding when Darwin Core Archives come from places other than the person's own disk.
- **Very large archives are read into memory,** with no cap. The person picks the file, so this affects only that person's own app, and it's a stated limitation.

### Left out as overkill

- Rendering details of the React explorer beyond what `react` tests already check, such as the exact SVG output.
- The playground app, which is a demo.
