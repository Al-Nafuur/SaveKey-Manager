# EEPROM Explorer

A retro administration console for browsing and managing an I²C EEPROM filesystem with a familiar floppy-disk explorer experience.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/eeprom-explorer` — the runnable React/Vite administration console
- `artifacts/eeprom-explorer/src/App.tsx` — explorer state, sample EEPROM data, and interactions
- `artifacts/eeprom-explorer/src/index.css` — the visual system for the aged floppy-label / lab utility aesthetic
- `artifacts/api-server` — shared API server scaffold, currently not required by the local-only first build

## Architecture decisions

- The first build uses local in-memory sample data so the complete explorer interaction model can be evaluated without attached EEPROM hardware.
- The UI keeps hardware telemetry visible alongside file browsing because write-protection and bus state are safety-critical context for administrative actions.
- The visual language intentionally combines tactile removable-media cues with dense, readable utility controls rather than presenting as a generic dashboard.

## Product

The app lets embedded developers browse EEPROM folders and files, search and switch views, inspect text or hex contents, import/export files, create folders, delete items, refresh the drive, and monitor I²C connection and capacity status.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The explorer currently runs in local/demo mode; import, export, and mutations are in-memory until a real I²C adapter bridge is connected.
- The app is served from the root preview path and requires the managed web workflow to provide `PORT` and `BASE_PATH`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
