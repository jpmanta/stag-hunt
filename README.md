# Stag Hunt

The code behind [staghunts.com](https://staghunts.com): investors share the startup deals they find, each decides alone, and each invests directly. It is free, it never handles money, and every call is locked before the outcome is known.

The code is open so anyone can read the rules and check that the site follows them.

## The rules the code keeps

1. You see others' calls on a deal only after making your own.
2. A call cannot be changed once made.
3. Every deal has one person who vouches for the founders and handles introductions.
4. Stag Hunt never holds, pools or moves money. Investors invest directly.
5. No fees from anyone.
6. A deal is visible only to the hunts it was shared with.
7. Only you can share your own record or checks.
8. Stag Hunt suggests and never decides.
9. No deal is ever shown publicly or advertised.

The full design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## What is here

| Path | What it is |
| --- | --- |
| `src/index.js` | The whole API, the access rules, emails and scheduled jobs |
| `src/hub.js` | Live updates (a Cloudflare Durable Object) |
| `public/` | The site and the members' app, plain HTML, CSS and JavaScript with no build step |
| `migrations/` | The database, one numbered file per change |
| `scripts/` | Sets up the AI pitch interviewer |

It runs as one Cloudflare Worker with a D1 (SQLite) database.

## What is not here

Members' data, deals, recordings and backups live only in the private database. No keys or passwords are in this repository or its history.

## Run it yourself

```bash
npm install
npx wrangler d1 migrations apply staghunt-auth --local
npx wrangler dev
```

To run your own copy on Cloudflare, put your own database id, domain and sender address in `wrangler.jsonc`, then set the secrets `AUTH_SECRET` and `GOOGLE_CLIENT_SECRET` with `npx wrangler secret put`. Face ID sign-in is tied to a domain, so change the domain in `src/index.js` too.

## Found a security problem?

Please report it privately through the [contact form](https://staghunts.com/contact/) before posting it anywhere.

## License

MIT. Use it, copy it, change it. See [LICENSE](LICENSE).

Stag Hunt is not a fund, a broker or investment advice.
