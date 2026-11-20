# Azur Lane Island Planner Tool

A small self-hosted web app for planning Azur Lane "Island Planner" production: what to make in which building, what the café needs, what you are short of, and which jobs to start next. All game numbers (recipes, prices, times, slot counts) come from a data file you can edit in the app; nothing is hard-coded.

## Run locally

Requires Node 22 or newer (Windows, macOS or Linux).

```
npm install
npm run import
npm start
```

Then open http://localhost:4747. `npm start` builds the client and serves it together with the API on `127.0.0.1:4747`.

## Getting the game data

`npm run import` downloads the Island item, place, restaurant and shop tables from the community database and merges them into `data/gamedata.json`. Fish production comes from the fish spreadsheet; by default the importer looks for `../Sources/Azur Lane - fish production and finding info (partially translated from ZH sheet).xlsx`.

```
npm run import -- --fish "C:\path\to\fish-sheet.xlsx"
npm run import -- --offline          # reuse the site files already in data/seed/site
npm run import -- --data some\folder # write somewhere other than ./data
```

Re-importing is safe: it only adds things that are missing and never overwrites anything you have edited. The previous file is backed up first.

Content for Season 2 to 5 that the site does not have yet goes in through the Data tab: edit items, recipes, buildings and cafés by hand, or paste rows into the paste-import box. Use Export JSON there to keep a copy.

## Data and backups

Everything lives in the data directory (`./data` by default, or `DATA_DIR`):

- `gamedata.json` is the game data (recipes, items, buildings, cafés, shop).
- `state.json` is your own progress (slots, stock, jobs, plans). It is not committed to git.
- `backups/` holds the previous version of each file, saved before every write. The newest 20 per file are kept.

If a file is damaged (for example half-written), the server restores the newest valid backup and the app shows a warning banner at the top.

Configuration is by environment variable: `HOST` (default `127.0.0.1`), `PORT` (`4747`), `DATA_DIR`, `SEED_GAMEDATA` (copied to `gamedata.json` on first run if none exists) and `BASIC_AUTH` (`user:password`, turns on a login prompt).

## Development

```
npm run dev        # Vite on http://localhost:5173 (proxies /api) plus the server on 4747
npm test           # vitest
npm run typecheck  # tsc --noEmit
```
