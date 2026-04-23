# kΩunt — Desktop Admin

Desktop companion to the phone PWA at [AdityaPurandare1/Counting-App](https://github.com/AdityaPurandare1/Counting-App). Shares the same Supabase project as the single source of truth — reads/writes `purchase_items`, `upc_mappings`, and the `kount_*` audit tables.

## Stack

- Vite 5 + React 18 + TypeScript
- `@supabase/supabase-js@2` (REST + Realtime)
- React Router 6
- No UI framework — atoms ported from `docs/designs/raw/app/atoms.jsx`

## Run locally

```bash
npm install
npm run dev
```

First run will open `http://localhost:5173`. The Supabase URL and anon key live in `src/lib/supabase.ts` (same values the phone app uses).

## Versioning

Follows the same convention as the phone app: every commit bumps the app version by 0.1. Desktop version track starts at **0.1** and is independent of the phone app's track (currently 1.4).

## Folder layout

```
Counting-Admin/
├── docs/designs/raw/app/   ← React JSX prototypes the desktop UI is built from
├── src/
│   ├── lib/                ← supabase client, types, access list
│   ├── styles/             ← tokens + globals
│   ├── components/         ← Shell, Sidebar, atoms, icons
│   └── screens/            ← Venues, Variance, Recount, Summary, Issues, AI
├── index.html
└── vite.config.ts
```

## Deployed URL

Auto-deployed to GitHub Pages on every push to `main`:
<https://adityapurandare1.github.io/Counting-Admin/>

(First push triggers the workflow; check the Actions tab for progress. Once the workflow is green, Pages takes ~30 s to propagate.)

## Roadmap

- **v0.1** — scaffold, Supabase connected, routing, placeholder screens
- **v0.2** — GitHub Pages deploy + SPA fallback + version banner
- **v0.3** — port `atoms.jsx` + `icons.jsx` into typed components
- **v0.4** — real Variance dashboard (live from `purchase_items` + `kount_audits`)
- **v0.5** — Recount handoff + Summary pages
- **v0.6+** — Issues tracker, Ask-kΩunt AI, `app_users` migration, exports
