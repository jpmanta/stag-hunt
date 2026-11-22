# Stag Hunt core

Stag Hunt's agents and workflows, built on [Mastra](https://mastra.ai) and hosted on the Mastra platform.
The live site in the folder above keeps serving members until each flow moves here and is checked.

## Stack

Bun, TypeScript 7, Mastra, Postgres (Neon on the platform, Postgres 18 locally), oxlint, oxfmt, `bun test`.

## Run it

```sh
bun install
bun run dev      # local server and Studio on http://localhost:4111
bun test         # tests against the local stag_hunt_test database
bun run check    # types, lint and formatting
bun run deploy   # build and deploy to the platform's production environment
```

## Settings

Kept in untracked files, one per place it runs:

- `.env.development` and `.env.test`: `DATABASE_URL` for the local database and `MASTRA_SERVER_TOKEN`.
- `.env.production`: only `MASTRA_SERVER_TOKEN`. The platform supplies `DATABASE_URL` itself.

Mastra keeps its own tables in the `mastra` schema, so Stag Hunt's tables can live beside them in `public`.
Every API route needs the server token; `/health` is the one open route.
