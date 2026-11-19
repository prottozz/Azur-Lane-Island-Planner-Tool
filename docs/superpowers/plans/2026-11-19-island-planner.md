# Island Planner Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that tracks Azur Lane Island Planner stock and running jobs, and suggests what each building should do next for two pipelines (café money, IDP goods), with fully editable game data.

**Architecture:** All game logic lives in pure TypeScript functions under `src/shared/` (data types, recipe math, state transitions, planner), unit-tested with Vitest. A tiny Express server only persists two JSON files (`data/gamedata.json`, `data/state.json`) with atomic writes and backups. The React client applies shared state transitions locally, keeps an undo stack, and PUTs the whole state back. A Node importer builds `gamedata.json` from the reference site's JSON and the fish spreadsheet. The app also ships as a Docker image built by GitHub Actions and deployed as a Portainer stack.

**Tech Stack:** Node ≥ 22, TypeScript 5, Vite 6, React 19, Express 5, Vitest 3 + @testing-library/react + jsdom, tsx (run TS scripts), SheetJS `xlsx` (read fish sheet), concurrently (dev script), esbuild (bundle server), Docker (node:22-alpine), GitHub Actions + GHCR.

**Spec:** `docs/superpowers/specs/2026-11-19-island-planner-design.md`

## Global Constraints

- Runs on Windows; all npm scripts cross-platform (no `rm -rf`, no `&&`-chained env vars; use `node`/`tsx` scripts). Paths via `node:path`.
- Server config from env: `HOST` (default `127.0.0.1`), `PORT` (default `4747`), `DATA_DIR` (default `<cwd>/data`), `SEED_GAMEDATA` (optional path), `BASIC_AUTH` (optional `user:password`). `npm start` builds the client and serves it on `127.0.0.1:4747`; `npm run dev` runs Vite (5173, proxying `/api` to 4747) plus the server. The container sets `HOST=0.0.0.0`, `DATA_DIR=/data`.
- Image: `ghcr.io/prottozz/azur-lane-island-planner-tool`, tags `latest` and `sha-<short>`, platforms `linux/amd64,linux/arm64`, runs as non-root user `node`, data volume at `/data`, port 4747.
- `data/gamedata.json` is committed. `data/state.json` and `data/backups/` are gitignored. Every save of either file first copies the previous version to `data/backups/<name>-<timestamp>.json`; keep the newest 20 per file.
- No Season 1 numbers in application code. Every quantity, price, time, IDP value and slot count comes from `gamedata.json`.
- Every suggestion carries a human-readable `reason` (e.g. `"Café needs 30 Tofu; you have 6"`).
- Starting or finishing a job takes at most 2 clicks from the building board.
- Durations are stored as integer seconds; timestamps as ISO strings; calendar days as local `YYYY-MM-DD`.
- Stamina is info-only. The only parallelism limit is `Building.slots`.
- Only factory goods carry IDP values used for ranking/conversion. Fish and food are never converted.
- Café income = `Item.cafeValue × qty sold`. No demand formula.

## Review Focus

1. **Typed durations in odd formats** (`2:15`, `02:15:00`, `45m`, `1h 30m`, `90`, empty, `abc`): valid forms parse to seconds; invalid input returns an error, never `NaN` or a 0-length job. → tests in Task 1.
2. **Items with no recipe and no shop entry, or recipe cycles in player-entered data**: expansion must terminate and list them as "unobtainable", not hang or recurse forever. → tests in Task 5.
3. **Starting a job / café run without enough stock, or editing stock below zero**: blocked with a list of what's missing; stock never goes negative. → tests in Task 3.
4. **Deleting an item, building or recipe that other data references** (recipes, stock, cafés, shop, jobs): blocked with a "used by …" list. → tests in Task 4.
5. **Missing or corrupted `state.json`/`gamedata.json` on startup** (first run, half-written file): first run creates defaults; a corrupt file is recovered from the newest valid backup and the API reports a warning the header shows. → tests in Task 7.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, index.html, .gitignore, README.md
data/gamedata.json                 committed knowledge base (created by importer)
data/seed/site/*.json              raw source JSON saved by importer
src/shared/types.ts                all data types (below)
src/shared/time.ts                 parseDuration, formatDuration, local day/reset helpers
src/shared/recipes.ts              per-recipe math (fill, duration, outputs, IDP/h)
src/shared/gamedata.ts             graph queries, pipeline derivation, references, paste parsing
src/shared/actions.ts              pure state transitions (jobs, stock, café, IDP, spawns, requests)
src/shared/planner/expand.ts       backward demand expansion
src/shared/planner/suggest.ts      demand building, priority allocation, suggestions
src/shared/defaults.ts             emptyState(), emptyGameData()
server/storage.ts                  atomic JSON read/write, backups, recovery
server/index.ts                    Express app + API
scripts/import/site.ts             site JSON → GameData
scripts/import/fish.ts             fish xlsx → GameData parts
scripts/import/merge.ts            merge imported into existing
scripts/import/run.ts              CLI entry
src/client/main.tsx, App.tsx, api.ts, useAppState.ts
src/client/components/Header.tsx, BuildingBoard.tsx, JobDialog.tsx, CafePanel.tsx,
  Shortfalls.tsx, GoodsPanel.tsx, StockTab.tsx, DataTab.tsx, DataTable.tsx, PasteImport.tsx
tests/shared/*.test.ts, tests/server/*.test.ts, tests/import/*.test.ts, tests/client/*.test.tsx
tests/fixtures/site/*.json         small hand-made slices of source JSON
```

---

### Task 1: Scaffold, types, time utilities

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `src/shared/types.ts`, `src/shared/time.ts`, `src/shared/defaults.ts`
- Test: `tests/shared/time.test.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`, exact):

```ts
export type ItemId = string;           // source ids as strings ("3011"); custom: "custom-<uuid>"
export type Season = 'permanent' | number;
export type Pipeline = 'food' | 'goods' | 'both';
export type BuildingKind = 'field'|'orchard'|'nursery'|'ranch'|'hatchery'|'mine'|'woods'|'kitchen'|'factory'|'mill'|'other';
export interface Qty { item: ItemId; qty: number }
export interface BonusOutput extends Qty { everyRuns: number }   // +qty every N completed runs
export interface FishInfo { location: string; bait: string; rodLevel: number; qte: string; usedIn: string; idpNote?: string }
export interface Item { id: ItemId; name: string; category: string; idp: number | null; cafeValue: number | null;
  season: Season; active: boolean; notes?: string; fishing?: FishInfo }
export interface Building { id: string; name: string; kind: BuildingKind; pipeline: Pipeline; slots: number; season: Season; active: boolean }
export interface Recipe { id: string; buildingId: string; inputs: Qty[]; outputs: Qty[]; bonus: BonusOutput[];
  maxRuns: number; secondsPerRun: number; stamina: number; season: Season; active: boolean; notes?: string }
export interface CafeRank { name: string; dishSlots: number; capacityPerDish: number }
export interface Cafe { id: string; name: string; kitchenBuildingId: string; sellable: ItemId[]; ranks: CafeRank[]; season: Season; active: boolean }
export interface ShopEntry { item: ItemId; price: number; currency: string; shop: string }
export interface DailySpawn { id: string; item: ItemId; qtyPerDay: number; season: Season; active: boolean }
export interface GameData { version: 1; items: Record<ItemId, Item>; buildings: Record<string, Building>;
  recipes: Record<string, Recipe>; cafes: Record<string, Cafe>; shop: ShopEntry[]; spawns: Record<string, DailySpawn> }
export interface Job { id: string; buildingId: string; slot: number; recipeId: string; runs: number; startedAt: string; endsAt: string }
export interface CafePlan { cafeId: string; rankIndex: number; dishes: ItemId[] }
export interface CafeRun { id: string; date: string; cafeId: string; dishes: Qty[]; status: 'running'|'done'; startedAt: string; leftovers: Qty[]; income: number | null }
export interface Reservation { id: string; item: ItemId; qty: number; source: 'request'|'quest'; note?: string }
export type Priority = 'money' | 'idp' | 'balanced';
export interface Settings { priority: Priority; moneyTarget: number | null; money: number | null; season: number;
  resetTime: string /* "HH:MM" local */; weeklyResetDay: number /* 0=Sun..6 */ }
export interface RequestCounters { dailyCap: number; weeklyCap: number; dailyDone: number; weeklyDone: number; lastDailyReset: string; lastWeeklyReset: string }
export interface State { version: 1; stock: Record<ItemId, number>; jobs: Job[]; cafePlans: CafePlan[]; cafeRuns: CafeRun[];
  requests: RequestCounters; reservations: Reservation[]; idp: { earned: number; target: number | null };
  settings: Settings; spawnsCollectedOn: string | null }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; missing?: Qty[] };
```

- Produces (`src/shared/time.ts`): `parseDuration(s: string): Result<number>`, `formatDuration(sec: number): string` (`"1:05:00"`, `"0:45:00"`), `localDay(d: Date): string`, `lastResetAt(now: Date, resetTime: string): Date` (most recent daily reset ≤ now), `lastWeeklyResetAt(now: Date, resetTime: string, weekday: number): Date`.
- Produces (`src/shared/defaults.ts`): `emptyGameData(): GameData`, `emptyState(now: Date): State` (priority `'money'`, season `5`, resetTime `"00:00"`, weeklyResetDay `1`, dailyCap `0`, weeklyCap `0`).

- [ ] **Step 1: Scaffold.** `package.json` scripts: `dev` (`concurrently "tsx watch server/index.ts" "vite"`), `build` (`vite build`), `start` (`vite build && tsx server/index.ts`), `test` (`vitest run`), `import` (`tsx scripts/import/run.ts`), `typecheck` (`tsc --noEmit`). `.gitignore`: `node_modules/`, `dist/`, `data/state.json`, `data/backups/`. Vite proxies `/api` → `http://127.0.0.1:4747`. Vitest: `environment: 'node'`, client tests opt into jsdom via `// @vitest-environment jsdom`. Run `npm install`.

- [ ] **Step 2: Write failing tests** `tests/shared/time.test.ts`:

```ts
test.each([['2:15', 8100], ['02:15:00', 8100], ['0:45', 2700], ['45m', 2700], ['1h 30m', 5400], ['1h30m', 5400], ['90', 5400]])
  ('parseDuration(%s) = %i', (s, sec) => expect(parseDuration(s)).toEqual({ ok: true, value: sec }));
// bare number = minutes
test.each(['', 'abc', '1:99', '-5', '0', '0:00'])('parseDuration(%s) fails', s => expect(parseDuration(s).ok).toBe(false));
test('formatDuration', () => { expect(formatDuration(3900)).toBe('1:05:00'); expect(formatDuration(2700)).toBe('0:45:00'); });
test('lastResetAt before reset time returns yesterday', () => {
  const r = lastResetAt(new Date(2026, 10, 19, 3, 0), '04:00'); expect(r).toEqual(new Date(2026, 10, 18, 4, 0)); });
test('lastWeeklyResetAt finds most recent Monday reset', () => {
  expect(lastWeeklyResetAt(new Date(2026, 10, 19, 12, 0), '04:00', 1)).toEqual(new Date(2026, 10, 16, 4, 0)); });
```

- [ ] **Step 3: Run** `npm test -- time` → FAIL (module not found).
- [ ] **Step 4: Implement** `types.ts`, `time.ts`, `defaults.ts`. Zero-length durations are an error.
- [ ] **Step 5: Run** `npm test -- time` → PASS; `npm run typecheck` → no errors.
- [ ] **Step 6: Commit** `git add -A && git commit -m "chore: scaffold project, shared types, time utils"`

---

### Task 2: Recipe math

**Files:** Create `src/shared/recipes.ts`; Test `tests/shared/recipes.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces:
  - `fillJob(r: Recipe): Qty[]` — inputs × `maxRuns` ("to fill the job").
  - `jobInputs(r: Recipe, runs: number): Qty[]`
  - `jobOutputs(r: Recipe, runs: number): Qty[]` — outputs × runs plus each bonus `qty × floor(runs / everyRuns)`, merged by item.
  - `jobSeconds(r: Recipe, runs: number): number` = `runs × secondsPerRun`.
  - `idpPerHour(r: Recipe, gd: GameData): number` — Σ(output qty per run × item.idp) / secondsPerRun × 3600; 0 if no output has idp.
  - `cafeValuePerHour(r: Recipe, gd: GameData): number` — same with `cafeValue`.

- [ ] **Step 1: Failing tests** with a fixture recipe: wheat `{inputs:[{item:'1000',qty:9}], outputs:[{item:'2000',qty:162}], maxRuns:12, secondsPerRun:2400}` and eggs `{inputs:[{item:'3000',qty:2}], outputs:[{item:'2601',qty:5}], bonus:[{item:'2602',qty:4,everyRuns:3}], maxRuns:8, secondsPerRun:3600}`.
  - `fillJob(wheat)` → `[{item:'1000',qty:108}]`
  - `jobOutputs(eggs, 8)` → `[{item:'2601',qty:40},{item:'2602',qty:8}]`
  - `jobOutputs(eggs, 2)` → `[{item:'2601',qty:10}]` (no bonus item at all)
  - `jobSeconds(wheat, 12)` → `28800`
  - `idpPerHour` for a factory recipe `Clock` (out 1 × idp 310, 21600 s/run) → `≈ 51.67` (toBeCloseTo 2)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: recipe math`

---

### Task 3: State transitions

**Files:** Create `src/shared/actions.ts`; Test `tests/shared/actions.test.ts`

**Interfaces:**
- Consumes: `jobInputs`, `jobOutputs`, `jobSeconds` (Task 2); `localDay`, `lastResetAt`, `lastWeeklyResetAt` (Task 1).
- Produces (all pure; return new objects, never mutate input):
  - `startJob(s: State, gd: GameData, a: { buildingId: string; slot: number; recipeId: string; runs: number; durationSec?: number; now: Date }): Result<State>` — fails if slot ≥ building.slots, slot occupied, runs < 1 or > maxRuns, or inputs missing (`missing` lists shortfall per item). Deducts inputs. `endsAt = now + (durationSec ?? jobSeconds)`.
  - `finishJob(s, gd, jobId: string): Result<State>` — adds `jobOutputs`, removes job (allowed before `endsAt`).
  - `cancelJob(s, gd, jobId): Result<State>` — refunds inputs, removes job.
  - `readyJobs(s: State, now: Date): Job[]`
  - `setStock(s, item: ItemId, qty: number): Result<State>` — rejects negative/non-integer.
  - `addStock(s, items: Qty[]): State`
  - `startCafeRun(s, gd, a: { cafeId: string; dishes: Qty[]; now: Date }): Result<State>` — fails if a run for that café already exists for `localDay(now)` or dishes missing; deducts dishes.
  - `finishCafeRun(s, gd, a: { runId: string; leftovers: Qty[]; income: number | null }): Result<State>` — returns leftovers to stock; if `income` given and `settings.money !== null`, adds it to money.
  - `convertToIdp(s, gd, items: Qty[]): Result<State>` — fails if any item has `idp === null` or stock insufficient; adds Σ qty×idp to `idp.earned`.
  - `spawnsAvailable(s, gd, now: Date): boolean` — true when `spawnsCollectedOn !== localDay(now)` and now ≥ lastResetAt + 3h and any active spawn exists.
  - `collectSpawns(s, gd, quantities: Qty[], now: Date): State` — adds quantities, sets `spawnsCollectedOn`.
  - `applyResets(s: State, now: Date): State` — zeroes `dailyDone`/`weeklyDone` when the last recorded reset is older than the current one.
  - `bumpRequests(s: State, delta: 1 | -1): State` — clamped to [0, cap].

- [ ] **Step 1: Failing tests** (fixture gd: building `place-101` slots 2, wheat recipe from Task 2; stock `{ '1000': 100 }`):
  - start wheat 12 runs with 100 seeds → `ok:false`, `missing:[{item:'1000',qty:8}]`, state unchanged.
  - start wheat 11 runs → ok, stock `'1000': 1`, `endsAt - startedAt = 26400 s`.
  - start with `durationSec: 8100` → `endsAt = now + 8100 s`.
  - second job on same slot → error; slot 2 (index 2 when slots=2) → error.
  - finish → stock `'2000': 1782`, jobs empty. cancel → seeds refunded.
  - `setStock(s,'1000',-1)` → error; `setStock(s,'1000',2.5)` → error.
  - café run twice same day → second fails; finish with leftovers `[{item:'3011',qty:2}]` → stock +2.
  - `convertToIdp` on item with idp 310 ×2 → earned +620; on tofu (idp null) → error.
  - `spawnsAvailable` at reset+2h59m → false; at reset+3h → true; after `collectSpawns` → false same day.
  - `applyResets` with `lastDailyReset` yesterday → `dailyDone 0`; same day → unchanged.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: state transitions`

---

### Task 4: Game-data queries, references, paste parsing

**Files:** Create `src/shared/gamedata.ts`; Test `tests/shared/gamedata.test.ts`

**Interfaces:**
- Produces:
  - `producersOf(gd, item): Recipe[]` (active only), `consumersOf(gd, item): Recipe[]` (active only).
  - `derivePipeline(gd, buildingId): Pipeline` — kitchens → `food`, factories → `goods`; others: walk consumers of the building's outputs (transitively, cycle-safe) and return `food` if they reach only kitchens/café-sellable items, `goods` if only factories, else `both`. Unconsumed outputs → `both`.
  - `sharedItems(gd): ItemId[]` — items consumed (directly) by both a food-pipeline and a goods-pipeline recipe.
  - `findReferences(gd, s: State, ref: { kind: 'item'|'building'|'recipe'|'cafe'; id: string }): string[]` — human-readable "used by" lines (recipes, cafés, shop, spawns, stock > 0, jobs, café plans).
  - `deleteEntity(gd, s, ref): Result<GameData>` — fails with the `findReferences` list joined if non-empty.
  - `parsePaste(text: string, kind: 'items'|'recipes', gd: GameData): { rows: (Item|Recipe)[]; errors: string[] }` — tab-separated with a header row. Items columns: `name, category, idp, cafeValue, season`. Recipes columns: `building, inputs, outputs, maxRuns, timePerRun, season`, where `inputs`/`outputs` are `"Soy Beans x15; Meat x1"` resolved by item **name** (case-insensitive), `timePerRun` via `parseDuration`. Unknown names, buildings or bad durations go to `errors` with the row number; valid rows still return. New ids `custom-<uuid>`; season blank → `'permanent'`.

- [ ] **Step 1: Failing tests:** derivePipeline(field producing soy used by tofu kitchen) = `food`; field producing flax used by Arts & Crafts → `goods`; nursery producing both → `both`; `sharedItems` contains lavender in a fixture where lavender feeds a kitchen and a factory; `deleteEntity` on soy (used by tofu recipe and stock 5) → `ok:false` with error containing `Tofu` and `stock`; deleting an unused item → ok; `parsePaste` items with 2 rows → 2 items; recipes row `"Golden Koi\tSoy Beans x15\tTofu x1\t5\t2:00\t5"` → recipe with `secondsPerRun 7200`, season 5; row with `Soy Bean x15` (unknown) → error `"row 2: unknown item 'Soy Bean'"`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat: gamedata queries, references, paste parsing`

---

### Task 5: Backward demand expansion

**Files:** Create `src/shared/planner/expand.ts`; Test `tests/shared/expand.test.ts`

**Interfaces:**
- Consumes: `producersOf` (Task 4), recipe math (Task 2).
- Produces:

```ts
export interface PlanStep { recipeId: string; runs: number; forItem: ItemId }
export interface Purchase { item: ItemId; qty: number; cost: number; currency: string }
export interface Expansion { steps: PlanStep[]; purchases: Purchase[]; unobtainable: Qty[]; shortfalls: Qty[] /* top-level demand not covered by stock */ }
export function expandDemand(gd: GameData, demand: Qty[], available: Record<ItemId, number>): Expansion
```

`available` is consumed as the expansion goes (copy internally). Choice of producer when several exist: fewest distinct inputs, tie by recipe id. Runs = `ceil(needed / outputPerRun)` (bonus outputs ignored for planning), capped per step at `maxRuns × building.slots`; any remainder becomes another step for the same recipe. Leftover outputs of a step go back into `available`. Item with no producer → shop purchase if a `ShopEntry` exists, else `unobtainable`. Track the current path; an item already on the path is a cycle → `unobtainable`.

- [ ] **Step 1: Failing tests:**
  - demand 30 Tofu, available 6 Tofu, 0 soy, Tofu recipe (15 soy → 1 tofu), soy recipe (3 soy seeds → 18 soy per run, maxRuns 12, slots 2), soy seeds shop price 60 → steps include Tofu 24 runs and soy 20 runs (ceil(360/18)), purchase 60 seeds cost 3600; `shortfalls` = `[{item:tofu,qty:24}]`.
  - available covers demand → no steps, no purchases, empty shortfalls.
  - item with no recipe and no shop → `unobtainable` with qty.
  - cycle A→B→A in fixture → returns (does not hang), A in `unobtainable`.
  - shared intermediate: demand for two dishes both needing soy nets soy once from `available`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: backward demand expansion`

---

### Task 6: Demand, priority allocation, suggestions

**Files:** Create `src/shared/planner/suggest.ts`; Test `tests/shared/suggest.test.ts`

**Interfaces:**
- Consumes: `expandDemand` (Task 5), `derivePipeline`, `sharedItems` (Task 4), `idpPerHour`, `fillJob`, `jobOutputs` (Task 2), `readyJobs` (Task 3).
- Produces:

```ts
export function cafeDemand(gd: GameData, s: State): Qty[]   // each plan: every chosen dish × ranks[rankIndex].capacityPerDish; only first dishSlots dishes count
export function reservedDemand(s: State): Qty[]              // reservations summed by item
export function goodsDemand(gd: GameData, s: State): Qty[]   // per active factory building: its top idpPerHour active recipe × fillJob × building.slots
export function freeStock(s: State, gd: GameData, now: Date): Record<ItemId, number> // stock + outputs of running jobs − reservations, floored at 0
export function allocate(free: Record<ItemId, number>, food: Qty[], goods: Qty[], priority: Priority, shared: ItemId[]):
  { food: Record<ItemId, number>; goods: Record<ItemId, number> }
export interface Suggestion { buildingId: string; slot: number; recipeId: string; runs: number; reason: string; missing: Qty[] }
export interface Plan { food: Expansion; goods: Expansion; suggestions: Suggestion[]; rankedGoods: { recipeId: string; idpPerHour: number; feasibleRuns: number }[] }
export function buildPlan(gd: GameData, s: State, now: Date): Plan
```

Allocation rule (pins the spec's "Balanced"): non-shared items go wholly to the pipeline that consumes them. For each shared item: `money` → food demand first, rest to goods; `idp` → goods first; `balanced` → split pro-rata to the two demands' sizes (floor for goods, remainder to food). Each pipeline is then expanded with `expandDemand` against its own allocation.

Suggestions: for every active building slot without a job (or whose job is ready): candidate recipes = active recipes of that building. Order: (1) recipes whose output appears in that pipeline's expansion steps — food pipeline first under `money`, goods first under `idp`, interleaved under `balanced`, most-needed first (largest remaining runs); (2) for factories with nothing needed, highest `idpPerHour` with `feasibleRuns > 0`; (3) otherwise no suggestion. `runs` = min(needed runs, maxRuns, runs affordable from that pipeline's allocation); if 0 affordable, suggest needed runs with `missing` filled. `reason` formats: `"Café needs {n} {Item}; you have {m}"`, `"Feeds {Item} for {consumer}"`, `"Best IDP/h you can make now ({x}/h)"`.

- [ ] **Step 1: Failing tests:**
  - `cafeDemand` with rank `{dishSlots:3,capacityPerDish:6}` and 4 dishes chosen → only first 3 dishes, 6 each.
  - `allocate` shared lavender 10, food wants 8, goods wants 8: money → food 8 / goods 2; idp → goods 8 / food 2; balanced → goods 5 / food 5.
  - `buildPlan`: idle Golden Koi slot, café plan needs Tofu, soy in stock → suggestion recipe Tofu with reason starting `"Café needs"`.
  - flipping priority `money`→`idp` changes the suggestion for an idle nursery slot from strawberries (food need) to flax (goods need) in a fixture where both are needed and seeds for only one job exist.
  - idle factory with nothing needed → highest IDP/h feasible recipe, reason `"Best IDP/h…"`.
  - every suggestion has a non-empty `reason`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: planner allocation and suggestions`

---

### Task 7: Storage and API server

**Files:** Create `server/storage.ts`, `server/index.ts`; Test `tests/server/storage.test.ts`, `tests/server/api.test.ts`

**Interfaces:**
- Consumes: `emptyGameData`, `emptyState` (Task 1).
- Produces:
  - `createStore(dataDir: string): { load<T>(name: 'gamedata'|'state', fallback: () => T): { value: T; warning: string | null }; save<T>(name, value: T): void }` — `save` writes `<name>.json.tmp` then renames; before overwriting, copies the current file to `backups/<name>-<YYYYMMDD-HHmmss-SSS>.json`; prunes to newest 20. `load`: missing file → fallback, no warning; unparsable/`version !== 1` → newest parseable backup with warning `"state.json was unreadable; restored backup from <time>"`; no valid backup → fallback with warning.
  - `seedIfEmpty(dataDir: string, seedPath: string | undefined): boolean` — copies `seedPath` to `<dataDir>/gamedata.json` only if that file doesn't exist; returns whether it copied.
  - `createApp(dataDir: string, opts?: { basicAuth?: string }): express.Express` — when `basicAuth` is set, every route (API and static) requires HTTP Basic auth with those credentials (401 + `WWW-Authenticate` otherwise); with `GET /api/gamedata`, `PUT /api/gamedata`, `GET /api/state`, `PUT /api/state` (JSON body, limit 10mb; response `{ ok: true }`), `GET /api/health` → `{ warnings: string[] }` (load warnings since start). In production also serves `dist/` with SPA fallback.
  - `server/index.ts` reads the env vars from Global Constraints, calls `seedIfEmpty`, listens on `HOST:PORT`. Static files are served from `dist/` resolved relative to the server file, so it works both from source (`tsx`) and from the bundle.

- [ ] **Step 1: Failing tests** (temp dir via `fs.mkdtempSync`):
  - load missing → fallback, warning null.
  - save twice → one backup file exists; save 25 times → 20 backups.
  - write garbage to `state.json`, with a valid backup → returns backup value and warning matches `/restored backup/`.
  - garbage and no backup → fallback + warning.
  - API (supertest): PUT then GET `/api/state` round-trips; `/api/health` lists the warning.
  - `seedIfEmpty` copies when missing, returns false and leaves the file untouched when present.
  - with `basicAuth: 'me:pw'`: no header → 401; correct header → 200; wrong password → 401.
- [ ] **Step 2–4:** FAIL → implement (add `supertest` dev dep) → PASS.
- [ ] **Step 5: Commit** `feat: persistent storage and API`

---

### Task 8: Importer

**Files:** Create `scripts/import/site.ts`, `scripts/import/fish.ts`, `scripts/import/merge.ts`, `scripts/import/run.ts`, `tests/fixtures/site/{items,places,restaurants,shops}.json`; Test `tests/import/import.test.ts`

**Interfaces:**
- Consumes: types (Task 1), `parseDuration` (Task 1), `derivePipeline` (Task 4).
- Produces:
  - `mapSite(src: { items: any; places: any; restaurants: any; shops: any }, season: Season): GameData`
  - `mapFish(rows: Record<string, unknown>[]): Pick<GameData, 'items'|'recipes'|'shop'> & { building: Building }`
  - `readFishSheet(path: string): Record<string, unknown>[]` (SheetJS, sheet `EN_INFO`, header row 1, stops at first row with empty `FISH NAME`)
  - `mergeGameData(existing: GameData, imported: GameData): { merged: GameData; added: Record<keyof GameData, number>; skipped: number }` — adds only ids not present; never modifies existing entries.
  - CLI `npm run import -- [--fish <path>] [--offline]`: fetches `https://azurlane.mrlar.dev/db/static/json/island/{items,places,restaurants,shops}.json?v=1.8.4.1`, saves to `data/seed/site/`, (`--offline` reads them from there instead), default fish path `../Sources/Azur Lane - fish production and finding info (partially translated from ZH sheet).xlsx`, merges into `data/gamedata.json` via `createStore().save`, prints a report (counts added/skipped, recipes referencing unknown items).

Source shapes (pin for fixtures and mapping):
- `items[id]`: `{ id, name, categories: string[], convert_points, can_convert, order_price, sellable_at?: number[] }`
- `places[id]`: `{ id, name, recipes: [{ id, stamina, item_name, production_limit, cost: [{id,amount}], produce: [{id,amount}], extra_produce: {id,amount,every} | null, base_time: "HH:MM:SS", needs_unlock }] }`. Use `recipes` (character batch), ignore `recipes_manual`. **`base_time` is per run.** Skip places with no recipes (702).
- `restaurants[id]`: `{ id, name, place, sellable: number[], ranks: [{ name, dish_slots, dish_capacity }] }`
- `shops[id].sub_shops[].goods[]`: `{ name, cost: { id, amount, name }, gains: [{ id, amount }] }`. Shop `10109` ("Seeds") → `ShopEntry { item: gains[0].id, price: cost.amount / gains[0].amount, currency: 'money', shop: 'Seeds/' + sub_shop.name }`. Shop `10019` ("Flour Mill") → building `mill` (kind `mill`, slots 1) with recipe `mill-<good.id>`: inputs `[cost]`, outputs `gains`, maxRuns 1, secondsPerRun 1. Other shops ignored.

Mapping:
- Building ids `place-<id>`; kind by place id: 101 field, 102 ranch, 401 mine, 402 woods, 501 orchard, 502 nursery, 601–604 & 901 kitchen, 703–706 factory; `slots: 1`; pipeline via `derivePipeline` after all recipes are mapped.
- Recipe ids `recipe-<id>`; `maxRuns = production_limit`, `secondsPerRun = parseDuration(base_time)`, `bonus = extra_produce ? [{ item, qty: amount, everyRuns: every }] : []`, `active = true`.
- Items: `idp = convert_points` only if the item is produced by a factory recipe, else `null`; `cafeValue = order_price` if the item is in any restaurant `sellable`, else `null`; `category = categories[0]`; season `'permanent'` for everything from the site, `active: true`.
- Cafés `cafe-<id>`, `kitchenBuildingId = 'place-' + place`.
- Fish (per row): item `fish-<slug(name)>` (category `Fish`, `idp: null`, `fishing` from columns WHERE TO FISH?/LURE ++/LVL ROD/QTE (Nb type / Nb min)/USED IN?, `idpNote` = `IDP / FISH` value as text); fry item `fry-<slug>` (category `Fry`); shop entry fry price = `FRY PRICE`, currency `money`, shop `Seeds/Hatchery`; building `hatchery` (kind `hatchery`, pipeline `food`, slots 1); recipe `fish-<slug>`: inputs `[{fry,1}]`, outputs `[{fish, PROD / TURN}]`, maxRuns `MAX TURNS`, secondsPerRun = `TIME TO PRODUCE` (SheetJS gives a day fraction → `Math.round(v * 86400)`; also accept `"HH:MM:SS"` strings), season `'permanent'`, `active: true`. (1 fry per run: the sheet's COST = FRY PRICE / PROD per turn.)

- [ ] **Step 1: Write fixtures** — a few entries per file in the shapes above (wheat field recipe with seeds shop entry; Tofu kitchen recipe; Clock factory recipe; one restaurant with Tofu sellable; eggs ranch recipe with `extra_produce`; one Flour Mill good).
- [ ] **Step 2: Failing tests:** wheat recipe → `maxRuns 12`, `secondsPerRun 2400`; Clock item `idp 310`, Tofu item `idp null` and `cafeValue 340`; eggs recipe has bonus `everyRuns 3`; seeds shop entry price 20 currency `money`; mill recipe exists; fish rows built in-test with SheetJS (`XLSX.utils.json_to_sheet`) for Crayfish (`TIME TO PRODUCE` 0.0946990741 = 02:16:22, PROD / TURN 8, MAX TURNS 5, FRY PRICE 200) → recipe `secondsPerRun 8182`, outputs 8, fry price 200; `mergeGameData` with an existing item whose `idp` was edited to 999 keeps 999 and reports it skipped.
- [ ] **Step 3–4:** FAIL → implement → PASS.
- [ ] **Step 5: Run the real import on the PC:** `npm run import` → report prints > 150 items, 16 buildings incl. hatchery and mill, 0 unknown-item recipes (or lists them). Open `data/gamedata.json` and spot-check Wheat and Crayfish.
- [ ] **Step 6: Commit** `feat: importer for site data and fish sheet` (include `data/gamedata.json` and `data/seed/site/`).

---

### Task 9: Client shell, app state, header

**Files:** Create `index.html`, `src/client/main.tsx`, `src/client/App.tsx`, `src/client/api.ts`, `src/client/useAppState.ts`, `src/client/components/Header.tsx`, `src/client/styles.css`; Test `tests/client/useAppState.test.tsx`

**Interfaces:**
- Consumes: API (Task 7), `buildPlan` (Task 6), `applyResets`, `readyJobs`, `spawnsAvailable` (Task 3).
- Produces:
  - `useAppState(): { gd: GameData; state: State; plan: Plan; now: Date; warnings: string[];
      apply(fn: (s: State, gd: GameData) => Result<State> | State): string | null /* error message */;
      applyGameData(fn: (gd: GameData) => Result<GameData> | GameData): string | null;
      undo(): void; canUndo: boolean }` — loads both files on mount, applies `applyResets` on load and every minute, ticks `now` every 30 s, recomputes `plan` via `useMemo`, keeps the last 50 previous `{state, gd}` snapshots for undo, saves (PUT) debounced 300 ms after any change.
  - `App` renders `Header` and tabs `Café / Money`, `Goods / IDP`, `Stock`, `Data` (tab in URL hash).
  - `Header`: priority radio (`Money`/`IDP`/`Balanced`), money balance + target inputs with progress bar and a "Target reached — switch priority?" hint when `money ≥ moneyTarget`, current season input, daily reset time and weekly reset weekday inputs, badges `"{n} jobs ready"` (click → finish all ready via `finishJob`) and `"Daily spawns ready"` (opens confirm with editable quantities → `collectSpawns`), Undo button, and any load warnings from `/api/health` as a dismissible banner.

- [ ] **Step 1: Failing test:** render hook with mocked `fetch`; `apply` of a failing transition returns the error and leaves state unchanged; a successful `apply` then `undo()` restores the previous state; a PUT happens after 300 ms (fake timers).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Manual check:** `npm run dev`, open http://localhost:5173 → header and four empty tabs render, priority switch persists after reload.
- [ ] **Step 6: Commit** `feat: client shell, app state with undo, header`

---

### Task 10: Building board and job dialog

**Files:** Create `src/client/components/BuildingBoard.tsx`, `src/client/components/JobDialog.tsx`; Test `tests/client/BuildingBoard.test.tsx`

**Interfaces:**
- Consumes: `useAppState` (Task 9), `startJob`, `finishJob`, `cancelJob` (Task 3), `fillJob`, `jobSeconds` (Task 2), `parseDuration`, `formatDuration` (Task 1), `Suggestion` (Task 6).
- Produces: `<BuildingBoard pipeline: 'food' | 'goods' />` — lists active buildings whose pipeline is that value or `both`; one row per slot: running job (recipe name, runs/maxRuns, countdown, "Finish" button — **1 click**), or idle with the slot's suggestion and a **"Start"** button that starts exactly the suggestion (1 click; disabled with tooltip listing `missing` if any), plus "Other…" opening `JobDialog`. `JobDialog`: recipe select (active recipes of the building, each showing "to fill: 108 Wheat Seeds"), runs (default maxRuns), optional time input ("time shown in game"), live list of inputs needed vs. stock; errors from `startJob` shown inline.

- [ ] **Step 1: Failing tests** (render with a fixture app state provider): idle slot shows suggestion reason text and Start; clicking Start creates a job (one click); running job shows Finish and clicking it adds outputs; JobDialog shows `"to fill: 108"` for wheat; entering `abc` in time shows the parse error and disables confirm.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: building board and job dialog`

---

### Task 11: Café / Money tab

**Files:** Create `src/client/components/CafePanel.tsx`, `src/client/components/Shortfalls.tsx`, `src/client/tabs/CafeTab.tsx`; Test `tests/client/CafePanel.test.tsx`

**Interfaces:**
- Consumes: `cafeDemand`, `Plan.food` (Task 6), `startCafeRun`, `finishCafeRun`, `bumpRequests`, `addStock` (Task 3).
- Produces:
  - `CafeTab` = summary line (`"Café run: not started / running since 10:02 / done"` for today; requests `"3/5 daily · 8/20 weekly"` with +/− buttons and editable caps), `<BuildingBoard pipeline="food" />`, `<CafePanel />`, `<Shortfalls expansion={plan.food} />`.
  - `CafePanel`: per active café — rank select, dish pickers (only `sellable`, up to `dishSlots`), shows qty per dish (`capacityPerDish`), have/need, est. income (Σ cafeValue × qty); "Start run" (disabled with missing list when short), and for a running run "Finish" with optional leftovers and income inputs.
  - `Shortfalls`: groups `expansion.steps` by building ("Golden Koi: Tofu × 24 runs"), `purchases` with total cost per currency and a "Bought" button per line (adds to stock), and `unobtainable` in a warning list.
- [ ] **Step 1: Failing tests:** picking 4 dishes at a 3-slot rank is prevented; est. income shows Σ value×qty; Start run deducts dishes; a second start same day shows the error; "Bought" adds the purchase qty to stock.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: café/money tab`

---

### Task 12: Goods / IDP tab

**Files:** Create `src/client/components/GoodsPanel.tsx`, `src/client/tabs/GoodsTab.tsx`; Test `tests/client/GoodsPanel.test.tsx`

**Interfaces:**
- Consumes: `Plan.rankedGoods`, `Plan.goods` (Task 6), `convertToIdp` (Task 3), `BuildingBoard`, `Shortfalls`.
- Produces: `GoodsTab` = IDP progress (`earned` / optional `target`, editable), `<BuildingBoard pipeline="goods" />`, `<GoodsPanel />` (table of factory recipes ranked by IDP/h with feasible runs; a "Convert" section listing stock items with `idp !== null` and qty > 0, qty inputs, "Convert" → `convertToIdp`), `<Shortfalls expansion={plan.goods} />`.
- [ ] **Step 1: Failing tests:** ranked table ordered by IDP/h descending; converting 2 Clocks (idp 310) raises earned by 620 and removes them; items with null idp are not listed for conversion.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: goods/IDP tab`

---

### Task 13: Stock tab

**Files:** Create `src/client/tabs/StockTab.tsx`; Test `tests/client/StockTab.test.tsx`

**Interfaces:**
- Consumes: `setStock` (Task 3), `producersOf`, `consumersOf` (Task 4), `reservedDemand`, `cafeDemand` (Task 6).
- Produces: searchable table — item, qty (inline edit → `setStock`, error shown inline), reserved (café plan + reservations), free, made in (building names), used in (recipe output names). Toggle "show zero stock". Reservations editor: add/remove `{item, qty, source: request|quest, note}`.
- [ ] **Step 1: Failing tests:** typing `-3` shows the error and keeps old qty; search filters by name; adding a reservation reduces "free".
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: stock tab`

---

### Task 14: Data tab

**Files:** Create `src/client/tabs/DataTab.tsx`, `src/client/components/DataTable.tsx`, `src/client/components/PasteImport.tsx`; Test `tests/client/DataTab.test.tsx`

**Interfaces:**
- Consumes: `applyGameData` (Task 9), `deleteEntity`, `findReferences`, `parsePaste` (Task 4), `fillJob`, `formatDuration`, `parseDuration` (Tasks 1–2).
- Produces: sub-tabs Items, Recipes, Buildings, Cafés, Shop, Daily spawns. `DataTable` = generic editable table (inline edit per cell, Add row, Duplicate, Delete → blocked with the "used by" list). Filters: season (`all` / `permanent` / each number), show inactive. Recipes table shows inputs/outputs as `"Soy Beans ×15"` chips with an editor, a read-only "to fill the job" column, time per run as `H:MM:SS`. Buildings table edits `slots`, `pipeline`, `active`. New entries default `season = settings.season`. `PasteImport`: textarea, kind select, preview table + errors from `parsePaste`, "Add N rows". Buttons "Export JSON" (downloads gamedata) and "Import JSON" (replaces gamedata after confirm; undoable).
- [ ] **Step 1: Failing tests:** editing Wheat recipe maxRuns to 10 updates "to fill" to 90; deleting a referenced item shows "used by" and keeps it; pasting 2 valid + 1 bad recipe rows previews 2 rows and 1 error, "Add 2 rows" adds them with season = current season; season filter `5` hides permanent items.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: data tab with paste import`

---

### Task 15: README and end-to-end check

**Files:** Create `README.md`

- [ ] **Step 1: Write README:** prerequisites (Node ≥ 22), `npm install`, `npm run import`, `npm start` → http://localhost:4747, `npm run dev`, where data lives, backups, how to re-import safely, how to add Season 5 content (Data tab / paste).
- [ ] **Step 2: Full verification:** `npm run typecheck` → 0 errors; `npm test` → all pass; `npm start` then in the browser: set building slots for fields; set stock for soy seeds; plan a Golden Koi run; see shortfalls and suggestions; start and finish a job from the board in ≤ 2 clicks each; flip priority and see a shared-building suggestion change; convert a factory good; edit a recipe in Data and see "to fill" update; restart the server and confirm everything persisted; corrupt `data/state.json` by hand, restart, confirm the restore warning banner.
- [ ] **Step 3: Commit** `docs: README` and push.

---

### Task 16: Container image, Portainer stack, CI

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/workflows/docker.yml`
- Modify: `package.json` (add `build:server`), `README.md` (Portainer section)

**Interfaces:**
- Consumes: `server/index.ts` env contract (Task 7), `vite build` output `dist/`, `data/gamedata.json` (Task 8).
- Produces: image `ghcr.io/prottozz/azur-lane-island-planner-tool:latest`; a compose file the player pastes into Portainer.

- [ ] **Step 1: Server bundle.** `build:server` = `esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist-server/index.mjs --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"`. Run `npm run build && npm run build:server`, then `node dist-server/index.mjs` → `curl http://127.0.0.1:4747/api/health` returns `{"warnings":[]}`. Add `dist-server/` to `.gitignore`.
- [ ] **Step 2: Dockerfile** — stage `build` (`node:22-alpine`, `npm ci`, `npm run build`, `npm run build:server`); stage `runtime` (`node:22-alpine`, `WORKDIR /app`, copy `dist/`, `dist-server/`, and `data/gamedata.json` → `/app/seed/gamedata.json`; `ENV HOST=0.0.0.0 PORT=4747 DATA_DIR=/data SEED_GAMEDATA=/app/seed/gamedata.json NODE_ENV=production`; `RUN mkdir /data && chown node:node /data`; `VOLUME /data`; `EXPOSE 4747`; `USER node`; `HEALTHCHECK CMD wget -qO- http://127.0.0.1:4747/api/health || exit 1`; `CMD ["node","dist-server/index.mjs"]`). No `node_modules` in the runtime stage. On startup `server/index.ts` checks that `DATA_DIR` is writable; if not (e.g. a Portainer bind mount owned by root), it logs `DATA_DIR /data is not writable by uid 1000 — chown the host folder or use a named volume` and exits non-zero instead of running with unsaved data. `.dockerignore`: `node_modules`, `dist`, `dist-server`, `data/state.json`, `data/backups`, `.git`.
- [ ] **Step 3: docker-compose.yml** (the Portainer stack):

```yaml
services:
  island-planner:
    image: ghcr.io/prottozz/azur-lane-island-planner-tool:latest
    container_name: island-planner
    restart: unless-stopped
    ports: ["4747:4747"]
    environment:
      TZ: Europe/Moscow
      # BASIC_AUTH: "user:change-me"
    volumes: ["island-data:/data"]
volumes:
  island-data:
```

- [ ] **Step 4: Workflow** `.github/workflows/docker.yml`: on push to `main` and tags `v*`, plus `workflow_dispatch`; `permissions: { contents: read, packages: write }`; steps: checkout, `npm ci`, `npm test` (fail the build on test failure), `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`, `docker/metadata-action` (tags `latest` on main, `sha-<short>`, semver on tags), `docker/build-push-action` with `platforms: linux/amd64,linux/arm64`, `push: true`, GHA cache.
- [ ] **Step 5: Verify locally** (where Docker is available): `docker build -t island-planner:test .` succeeds; `docker run -d -p 4747:4747 -v island-test:/data island-planner:test`; `/api/health` responds; the UI loads and shows imported data (seed copied); stop, remove the container, run it again with the same volume → state is still there; with `-e BASIC_AUTH=a:b` the page asks for a login.
- [ ] **Step 6: README Portainer section:** Stacks → Add stack → Web editor → paste `docker-compose.yml` (or Repository → this repo, compose path `docker-compose.yml`) → Deploy. If the GHCR package is private, add a registry in Portainer (`ghcr.io`, username `prottozz`, a GitHub token with `read:packages`) or make the package public. Update: stack → "Pull and redeploy". Data lives in the `island-data` volume; Data-tab edits there are not in git, so use Export JSON to save them into the repo. Back up the volume or use Export JSON. Don't expose port 4747 to the internet without `BASIC_AUTH`.
- [ ] **Step 7: Commit and push** `feat: docker image, portainer stack, CI`; confirm the Actions run is green and the package appears under the repo's Packages.
