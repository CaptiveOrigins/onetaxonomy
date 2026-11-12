# OneTaxonomy Payload example

A small Payload and Next.js site that uses [`@captiveorigins/payload-plugin-onetaxonomy`](../../packages/payload). It shows the plugin set up the way a real site would: accounts with two roles, public pages that draw published views, and proposals that record a person by an id, with a public handle shown beside it and no email address.

> **Status: an example, not a product.** It runs on this machine only, on a throwaway in-memory MongoDB, with made-up accounts and the repository's illustrative fixtures. Tested: 58 checks over HTTP with sign-in cookies (`pnpm smoke`), on `next dev` and on the built site, with Payload 3.93 and Next.js 16; the three public pages were looked at in headless Chrome, in light and dark, at desktop width and at 520 px; and the admin's panels were clicked through in headless Chrome as the curator, in light and dark (publishing a snapshot with the keyboard, a view, accepting a proposal, and storing a snapshot pasted into the new-snapshot form). Those runs are not in CI. Not tested: a screen reader, Safari, Firefox, a phone, Postgres or SQLite, or a deployed site.

## What it shows

- **Public pages.** `/` lists the published views. `/views/<id>` draws one as an SVG tree with its keyboard outline, what the view leaves out, and its sources. Both are Server Components: the tree is drawn on the server and no tree code is sent to the browser. The pages read as an anonymous visitor, so they only ever show what is published.
- **Two roles.** A curator manages snapshots and views, uses the admin, and decides on proposals. A member reads what is published and makes proposals. Only a curator hands out roles: a member can't raise their own, and sees no account but their own.
- **Proposals by id, with a handle shown.** A proposal stores its author's account id, and when a curator accepts one, the new snapshot version records the proposer and the curator by those ids, inside its checksum. No name or email address is sealed. `proposals.displayName` looks up each person's `handle` when a proposal is shown, so a changed handle shows at once and a removed one leaves the id alone.
- **Staged, then published.** The seed stores one published snapshot with two views, and one staged snapshot that only the curator sees. An accepted proposal makes a new staged version; visitors see nothing until the curator publishes it.
- **Panels in the admin.** Signed in as the curator, a snapshot's, a view's and a proposal's edit page each open with the plugin's panel: what the record holds, its status in words, and the buttons to publish, withdraw, accept or decline, each asking first. The names beside the ids on those panels are the handles, looked up when the page loads.
- **Cookies from this site only.** Payload's `csrf` list holds the site's own address, so a sign-in cookie sent from another site's page counts for nothing.

The setup is in [`payload.config.ts`](payload.config.ts) (the plugin's options), [`src/users.ts`](src/users.ts) (accounts and roles) and [`src/seed.ts`](src/seed.ts) (the example data).

## Run it

From the repository root, with Node 22 or later and pnpm:

```bash
pnpm install
pnpm build      # the packages the site uses
pnpm --filter @captiveorigins/onetaxonomy-payload-example dev
```

The first run downloads a MongoDB binary (about 140 MB on a Mac, kept in `~/.cache/mongodb-binaries`). Then it prints the site's address, the two accounts and a password made up for this run:

```
Site:    http://localhost:3000
Admin:   http://localhost:3000/admin
Curator: curator@example.org
Member:  member@example.org
Password for both, made up for this run: …
```

Stop it with Ctrl-C. The database goes with it: every run starts from the seed.

- `PORT=3100` picks another port.
- `EXAMPLE_PASSWORD=…` sets the password instead of making one up.
- The site listens on `localhost` only. It is not set up to face a network.

## Check it

```bash
pnpm --filter @captiveorigins/onetaxonomy-payload-example smoke
```

This builds the site, starts it on a free port with its own database, and sends it requests the way a browser would. It takes about 15 seconds on a recent Mac. It checks that:

- a visitor reads the published snapshot and views, through the pages, REST and GraphQL, and gets "not found" for anything staged;
- a visitor's plain read and list of snapshots hold no content, and a read that selects the content gets it;
- a visitor can't store a snapshot, make a proposal, or list accounts or proposals;
- a sign-in cookie can't be read by scripts, and counts for nothing from another site;
- a member can't make themself a curator, sees only their own account, and is sent away from the admin;
- a member's proposal is stored under their account's id whatever the request says, shows their handle, has no email address in it, and stays private until shared;
- only the curator can accept it, and the new version is staged, sealed, records both people by id, holds no handle and no email address, and isn't public;
- a changed handle shows on the accepted proposal at once, and the sealed version doesn't change;
- an accepted proposal can't be deleted;
- the curator's edit pages in the admin carry the plugin's panels;
- a stored snapshot's admin page is sent without its content and without the content field, and the new-snapshot form still has that field;
- the new version's summary shows the curator both people by id with their handles, is "not found" for a visitor and the member while it is staged, and once published gives a visitor the ids and no names;
- a member can't publish it, and the curator's publish answers without the snapshot's content.

`--dev` runs `next dev` instead of a build, and `--skip-build` reuses the last build. CI runs the smoke test on every pull request.

## Using your own database

Set `DATABASE_URI` to a MongoDB address and the site uses it instead of the in-memory one. Use an empty, throwaway database: this is still an example.

- With `EXAMPLE_PASSWORD` set, an empty database gets the two accounts and the example data.
- Without it, nothing is seeded. The first account made on Payload's "create first user" screen becomes the curator; every account after that starts as a member.
- Set `PAYLOAD_SECRET` too, so sign-ins last across restarts. Without it each run makes a new one.

## What it leaves out

- **No page for making a proposal.** A member makes one through the API. The curator decides on it in the admin, on the proposal's panel.
- **No imports.** The `imports` option is off, so there are no import jobs and the import panel doesn't appear. It is tested in the plugin's own package.
- **Two requests Payload's admin makes to other sites.** The admin's JSON fields load their code editor (Monaco) from cdn.jsdelivr.net, on the new-snapshot form and on a view's and a proposal's page. That is Payload's, and this example leaves it. Payload's default avatar would also ask gravatar.com with a hash of the signed-in address; this example turns that off (`admin.avatar: 'default'`).
- **No tenants.** The plugin's tenant scope is tested in its own package, not shown here.
- **No sign-up.** A curator adds accounts in the admin.
- **Nothing for production.** No email, no rate limits, no backups, no deployment setup.

## License

[PolyForm Noncommercial 1.0.0](../../LICENSE). Source-available, not open source.
