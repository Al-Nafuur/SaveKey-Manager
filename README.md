# SaveKey-Manager

A browser-based manager for the **SaveKey** and **SaveKey Plus**, EEPROM save-game cartridges for the Atari 2600 and 7800 (`atariage-community` scene). Runs entirely as a PWA — no install, no backend — and talks to the hardware directly over USB via the Web Serial API.

**Live app:** https://al-nafuur.github.io/SaveKey-Manager/
*(repo is planned to move to the `atariage-community` GitHub org under the same name; the deploy workflow already derives its base path from the repo name, so the URL will just become `https://atariage-community.github.io/SaveKey-Manager/` with no changes needed.)*

## What it does

The SaveKey Plus has **two EEPROMs**, and this app understands both of the filesystem formats that can live on them:

- **Classic SaveKey / AtariVox format** (32 KiB) — the format used by the existing SaveKey/AtariVox community tools. The app fetches the live [savekey-allocation-list](https://github.com/atariage-community/savekey-allocation-list) registry on start, shows which pages are actually occupied on the real hardware (not just what the registry claims), and lets you view/edit raw page data in a hex editor.
- **TinyELF Basic filesystem** (up to 256 KiB, on the second EEPROM) — a custom, DOS 2.x-like filesystem (directory, VTOC, sector chaining) for the TinyELF Basic dialect. Supports FORMAT, SAVE, LOAD and DELETE, and is careful to only ever rewrite the sectors that actually changed (VTOC/directory/boot block) — never a blanket rewrite — for EEPROM wear-leveling.

**PicoBridge** — a Raspberry Pi Pico running dumb USB↔I²C bridge firmware — connects the browser to the SaveKey/SaveKey Plus; all filesystem/layout logic lives in the app itself, not the firmware. See [firmware/pico-bridge](firmware/pico-bridge) for PicoBridge and its wiring.

## Repo layout

```
artifacts/eeprom-explorer/   the PWA itself (React 19 + Vite 7 + Tailwind 4)
firmware/pico-bridge/        PicoBridge firmware (RP2040) — plain Pico SDK/CMake, not part of the pnpm workspace
```

## Development

Requires Node.js 24+ and pnpm (v10 — see the note in the deploy workflow about why not v11).

```
pnpm install
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/eeprom-explorer run dev
```

`PORT` and `BASE_PATH` are required env vars for both `dev` and `build` (the latter is the GitHub Pages sub-path in production, `/` for local use).

```
pnpm run typecheck
pnpm --filter @workspace/eeprom-explorer run build
```

Browser support: Web Serial requires a Chromium-based browser or Firefox 151+ (desktop). Safari doesn't support it.

## Deployment

Static PWA on GitHub Pages, built and deployed automatically by [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) on every push to `main` that touches the app, via `actions/upload-pages-artifact` + `actions/deploy-pages`.

## License

MIT
