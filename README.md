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

Configuration is by environment variable: `HOST` (default `127.0.0.1`), `PORT` (`4747`), `DATA_DIR`, `SEED_GAMEDATA` (copied to `gamedata.json` on first run if none exists; if the file is missing it is ignored silently and the app starts empty) and `BASIC_AUTH` (`user:password`, turns on a login prompt).

## Deploy with Portainer

CI builds and publishes `ghcr.io/prottozz/azur-lane-island-planner-tool` (tags `latest` and `sha-<short>`, for amd64 and arm64) on every push to `main`.

1. In Portainer go to Stacks, Add stack, Web editor, and paste the contents of `docker-compose.yml` (or choose Repository, point it at this repo, compose path `docker-compose.yml`).
2. Click Deploy, then open http://your-host:4747.

Notes:

- If the GHCR package is private, add a registry in Portainer (`ghcr.io`, username `prottozz`, a GitHub token with `read:packages`), or make the package public in the repo's Packages settings.
- To update, open the stack and use "Pull and redeploy".
- Data lives in the `island-data` volume, mounted at `/data`. On first run the image's bundled `gamedata.json` (if there is one) is copied in. Edits made in the Data tab exist only in that volume, not in git, so use Export JSON to save them into the repo, and back up the volume.
- If you bind-mount a host folder instead of the named volume, it must be writable by uid 1000 (`chown 1000 <folder>`). Otherwise the container logs `DATA_DIR /data is not writable by uid 1000` and exits.
- Do not expose port 4747 to the internet without setting `BASIC_AUTH` (uncomment it in the compose file, e.g. `"user:a-long-password"`). The container listens on all interfaces and logs a warning when `BASIC_AUTH` is not set.

## Development

```
npm run dev        # Vite on http://localhost:5173 (proxies /api) plus the server on 4747
npm test           # vitest
npm run typecheck  # tsc --noEmit
```
