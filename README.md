# La Corte — Family Kitchen

A meal planning and recipe app for the family, dressed like an Italian courtyard: terracotta, ochre, stucco and cypress.

- **Weekly Table**: plan breakfast, lunch and dinner for each day
- **Recipe Book**: add, edit, search and delete recipes (a few Italian classics included)
- **Market List**: a shopping list built from the week's plan, with quantities combined and checkboxes
- **Installable PWA**: add it to your phone's home screen; it opens offline and syncs edits when you're back online

Everyone shares one kitchen: data lives in Cloudflare D1, behind a single family passcode.

## Stack

- `public/`: the app (plain HTML, CSS, JS, service worker, manifest)
- `src/worker.js`: Cloudflare Worker serving `/api/*` over D1
- `migrations/`: D1 schema

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # set FAMILY_PASSCODE
npm run db:local
npm run dev                      # http://localhost:8787
```

## Deploy

```sh
npx wrangler login
npx wrangler d1 create courtyard-kitchen   # paste the database_id into wrangler.jsonc
npm run db:remote
npx wrangler secret put FAMILY_PASSCODE
npm run deploy
```

The passcode is a secret, not part of the repo, so the repo can stay public. Ingredients are entered one per line, e.g. `2 cups flour` or `1 lb spaghetti`, so the market list can add them up. `npm run icons` regenerates the app icons.
