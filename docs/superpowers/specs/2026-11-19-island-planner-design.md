# Island Planner Tool — Design

Date: 2026-11-18 · Status: reviewed, awaiting player approval

## 1. Intent and why

Azur Lane's Island Planner mode has a lot of moving parts: gathering raw materials, buying seeds, growing crops, raising animals and fish, refining materials, producing goods, cooking dishes, and running cafés. There are too many chains, quantities and timers to keep in your head. The player (single user) wants a planner on the **PC, open beside the game** that:

- remembers what's in stock and what each building is doing,
- updates stock as jobs finish,
- tells them what each building should do next, and what's missing for upcoming goals.

The game is played on the phone; alt-tabbing out of the game on mobile can log you out, so the tool lives on the PC.

The public reference site (azurlane.mrlar.dev) stopped updating after Season 1; the game is now in **Season 5**, so all game data in the tool must be **editable and extendable** by the player.

## 2. The game economy the tool models

Two pipelines, mostly independent:

**Goods → Island Dev Points (IDP, the season points)**
- Raw materials: Rockheap Mine, Verdant Woods, and some crops/plants (flax, cotton, lavender, reed flowers, autumn chrysanthemum, peanuts…), ranch outputs (pelt, wool).
- Processed in 4 factories: Lumber Processing, Machinery Production, Electronic Production, Arts & Crafts Production.
- Finished factory goods are converted into IDP. **Only factory goods are converted**; intermediates are never worth converting.
- IDP also comes from the seasonal questline (out of scope for planning beyond reserving hand-in items, see below).

**Food → café money (the mode's currency)**
- Crops (Faircrop Fields, Newsprout Nursery, Sweetscent Orchard), ranch (Laidback Ranch), fish (hatchery; see fish sheet) → intermediates (e.g. Tofu) → dishes in kitchens (Golden Koi Restaurant, Polar Bear Teahouse, Manjuu Eatery, Fin-'n'-Feather Grill, Café Manjuu).
- Dishes are stocked into cafés, which **open once per day for 8 hours** and sell them for money.
- Money is spent on seeds/fry (Seeds tab of the shop) and on research (tech). Research demand is large now but finite.

**Where the pipelines collide (shared resources)**
- Plots in fields/nursery (a nursery job is either flax for cloth or strawberries for food).
- Items used by both: lavender, autumn chrysanthemum (per Season 1 data; the tool should detect overlaps from recipe data, not hard-code them).
- Building slots (each building runs a limited number of jobs at once). Character stamina is *not* a limit: Workerjuu has infinite stamina (see §13).

**Other demands**
- **Island requests:** daily and weekly caps; reward money and Development EXP (permanent mode level). They ask for items.
- **Seasonal quests:** daily tasks plus "hand in X of various items"; reward character EXP/skill materials.

**Shops**
- Seeds tab: seeds (and similar inputs) bought with mode money. Prices per seed in Season 1 data; editable.
- Flour Mill: converts crops to animal feed (e.g. 30 Wheat → Bird Feed). Treat as a recipe.
- Seasonal shop and Appearance shop: not part of production planning.

## 3. Goals, non-goals, anti-goals

**Goals**
- Persist stock, running jobs, café runs, request counters and settings between sessions.
- Two pipeline tabs (Café/Money and Goods/IDP) showing every building's state and a suggested next job.
- A global priority switch (Money / IDP / Balanced) that decides who wins shared resources; changeable at any time (money matters now for research, IDP later).
- Show "how many to fill the job" for every recipe (amount per run × max runs, e.g. Wheat 9 × 12 = 108 seeds).
- Shortfall list: what's missing for tomorrow's café run and for the current IDP plan, expanded back to seeds/raw materials, including what to buy and its cost.
- A Data tab to edit and add all game data (items, recipes, buildings, shop prices, IDP values, café prices, fish).
- Seed data imported from the reference site's JSON and the player's fish spreadsheet.

**Non-goals (v1)**
- Modelling character stats/grades to predict job duration. The player types the time the game shows, or the tool uses the recipe's base time.
- Automatic sync with the game (no screen reading, no API).
- Phone UI, multi-user, cloud hosting.
- Cosmetics, outfits, appearance shop, achievements.

**Anti-goals (failure even if it "works")**
- Bookkeeping that takes longer than playing. Starting/finishing a job must be ~2 clicks; correcting stock must be quick.
- Hard-coded Season 1 numbers that can't be changed from the UI.
- Suggestions the player can't understand. Every suggestion shows why ("café needs 30 Tofu; you have 6").
- Losing data. State must survive restarts and be easy to back up.

## 4. Constraints

- Runs locally on Windows PC; Node.js is installed. Lives in `C:\Projects\Azur Lane` as a git repo.
- Source data: `https://azurlane.mrlar.dev/db/static/json/island/*.json?v=1.8.4.1` (items, places, restaurants, shops, maps, tech, characters, combos, wild_gather, quests, attribute_grades). Fetchable from the player's PC.
- Fish data: `Sources/Azur Lane - fish production and finding info (partially translated from ZH sheet).xlsx`, sheet `EN_INFO`, 16 fish rows. Columns: fish name, category, where to fish, QTE, rod level, bait preferences (corn/worm/shrimp/octo), best lure, fry price, time to produce, prod/turn, max turns, prod max turn, meat/fish, meat/turn, meat/h, cost, cost/fish, IDP/fish, IDP/h, IDP/finance, used in.
- Single user, single machine.
- **Deployment (added 2026-11-19):** besides running locally with `npm start`, the app ships as a Docker image (GitHub Actions → `ghcr.io/prottozz/azur-lane-island-planner-tool`, linux/amd64 + linux/arm64) deployed as a Portainer stack, with data on a volume. Repo: `github.com/prottozz/Azur-Lane-Island-Planner-Tool`.

## 5. Approaches considered

| | Approach | Trade-offs | Verdict |
|---|---|---|---|
| A | Web page hosted on claude.ai with cloud-saved data | Same data on PC and phone, nothing to install; but lives on claude.ai and the player doesn't own the code | Not chosen |
| B | **Local web app in a git repo, data in JSON files on disk** | Full ownership, editable in Cursor, version history via git; PC only (fine — the player uses the PC beside the phone) | **Chosen by player** |
| C | Spreadsheet | Natural for data editing, but job tracking, timers and suggestions become fragile formulas | Ruled out |

Why B: the player plays on the phone and looks at the PC (mobile may log out when tabbing away), so phone access isn't needed, and owning the code locally is preferred.

## 6. Decisions

### Decided by the player
- Stateful tool (stock + running jobs persisted; outputs added when jobs finish).
- Two tabs, one per pipeline, plus priority switch.
- Café runs once per day for 8 hours.
- "To fill the job" quantity visible for every recipe.
- Only factory goods are converted to IDP; food intermediates only feed dishes.
- Local app (approach B), packaged as a container the player deploys in Portainer.

### Proposed by Claude (player saw and accepted the overall shape)
- Tabs: **Café / Money**, **Goods / IDP**, **Stock**, **Data**.
- Priority: Money / IDP / Balanced. Optional money target (e.g. "need 120k for next research"); when reached, the tool suggests switching priority.
- Job duration: typed by the player when starting (the time the game shows), or defaults to recipe base time.
- Marking a job finished moves inputs/outputs in stock automatically.

### Builder's calls (stated so they can be overridden)
- **Stack:** Vite + React + TypeScript frontend; a tiny Node server (Express or Fastify) serving the app and a JSON REST API; `npm start` runs it on `localhost`. Plain JSON files, no database.
- **Data split:**
  - `data/gamedata.json` — items, buildings, recipes, shops, cafés, fish. Editable via Data tab. Committed to git (it's the Season 5 knowledge base).
  - `data/state.json` — stock, jobs, café runs, request counters, settings. Gitignored by default; auto-backup on every save (keep last N copies in `data/backups/`).
  - `data/seed/` — raw imported source JSON + converted fish CSV, untouched, for re-import/diff.
- **Importer:** a script (`npm run import`) that fetches the site JSON and reads the xlsx, then builds `gamedata.json` in the tool's own schema. Re-running must not overwrite the player's edits (merge: only add items/recipes not already present, or produce a diff report).

## 7. Data model (tool schema)

Keep IDs from the source data where present; player-added entries get new IDs (e.g. `custom-…`).

- **Item**: id, name, category, pipeline tags (food / goods / raw / shared — derived), IDP value per unit (editable; only meaningful for factory goods), café sale value (dishes), buy price + currency (if buyable), notes, season added.
- **Building** (a production place): id, name, kind (field, orchard, nursery, ranch, hatchery, mine, woods, kitchen, factory, mill), pipeline (food / goods / both), **number of parallel slots** (editable; not in source data — default 1, player sets real count).
- **Recipe**: id, building, inputs per run [{item, qty}], outputs per run [{item, qty}], max runs per job, **time per run** (job time = runs × time per run), stamina (info only), unlocked flag, notes. Derived: "to fill the job" = inputs per run × max runs.
  - Source data has two recipe variants per crop (`recipes` = assigned character, batch, e.g. 9 seeds → 162 wheat × 12 runs; `recipes_manual` = manual, 1 seed → 18). Import the batch variant as primary; manual variant optional.
- **Fish**: modelled as items + hatchery recipes (fry → fish per turn × max turns) + fishing metadata (location, bait, rod level) shown on the item page. Food pipeline only; never converted to IDP.
- **Daily spawn**: item, expected qty per day, available from reset + 3h, season tag.
- **Season tag + active flag** on items, recipes, buildings, spawns.
- **Café** (restaurant): id, name, linked kitchen building, sellable dishes, ranks [{name, dish slots, capacity per dish, price coefficient}], current rank (state), opening time 8h, once/day.
- **Shop entry**: item, price, currency, shop/tab name.
- **State**:
  - stock: {itemId: qty}
  - jobs: [{id, building, slot, recipe, runs, startedAt, endsAt, status: running|done}]
  - café runs: [{date, café, dishes [{item, qty}], status: planned|running|done, income actual (optional)}]
  - requests: daily count/cap, weekly count/cap, reset times; reserved items list.
  - seasonal quest reservations: [{item, qty, note}]
  - IDP plan: target points, points earned so far (manual + from conversions logged).
  - settings: priority, money target, current money (optional), current season number, daily reset time.
  - daily spawns: last collected date.

## 8. Screens

### Header (all tabs)
Priority switch, money target progress (if set), season, clock, "N jobs finished" badge.

### Café / Money tab
```
TODAY   Café run: not started (opens once/day, 8h) · Requests: 3/5 daily, 8/20 weekly
BUILDINGS (food)
 Faircrop Fields  slot 1  Wheat 12/12   done 23:40   → next: Soy (café needs 30 Tofu)
 Golden Koi       slot 1  idle!                      → start: Tofu ×5 (have soy)
CAFÉ PLAN for next run
 Golden Koi Restaurant (Gold): Tofu ×6, Omurice ×6, Hearty Meal ×6 → est. income
SHORTFALLS
 Soy Beans −40 (buy 5 Soy Bean Seeds: 300 money)
```
- Café plan: player picks dishes per café (tool can pre-suggest by value), tool fills quantities from rank's slots × capacity and expands the tree backward to show what to cook, grow and buy.
- "Start café run" deducts dishes from stock; "Finish" assumes all sold, with an optional leftovers field returning unsold dishes, and optionally logs income.

### Goods / IDP tab
Same building board for mine, woods, goods-feeding plants, ranch-for-goods, factories. Plus:
- IDP progress: earned / target.
- Ranked list of factory goods by IDP per hour (and IDP per raw-material time), filtered to what's feasible from stock + upcoming outputs.
- "Convert" action: removes goods from stock and adds IDP to the earned total.

### Stock tab
Searchable table: item, qty, reserved (café plan, requests, quests), free, where it comes from, what uses it. Inline edit of qty (for correcting drift). Reservation list for requests and seasonal quests (manual entry).

### Data tab
Sub-tabs: Items, Recipes, Buildings, Cafés, Shop prices, Fish. Table views with inline edit, add, duplicate, delete (with "used by N recipes" warning). Each recipe row shows "to fill the job". Import/export (JSON) buttons.

## 9. Behaviour

### Job lifecycle
1. Start: pick building + slot, recipe, runs (default = max). Inputs are deducted at start (as in the game). Enter time shown in game (e.g. `2:15`) or accept base time.
2. Job end = start + runs × time per run, or the time typed. Running jobs show a countdown. When `endsAt` passes, the job is flagged "ready".
3. Finish (one click, or "collect all ready"): outputs added to stock.
4. Cancel/edit: restore inputs or adjust.
Undo for the last action is strongly desirable (bookkeeping mistakes are common).

### Suggestion engine
Run on every state change. For each idle slot (and for slots finishing soon), suggest the best next recipe.

1. **Demand**: café plan for the next run (quantities of dishes), IDP plan (target rate or target total), reserved request/quest items.
2. **Expand** each demand backward through recipes to raw inputs and shop purchases, netting out stock (free, not reserved) and outputs of running jobs.
3. **Allocate shared resources** by priority:
   - Money: café demand is satisfied first; goods use what's left.
   - IDP: goods first.
   - Balanced: alternate / weighted (builder's call; document the rule).
4. **Rank** candidate recipes per idle building: those that close a shortfall first (most urgent: needed soonest relative to café opening), then for the goods tab, highest IDP per hour among feasible factory products.
5. Show each suggestion with its reason and the inputs it consumes.

The engine is advisory only; it never changes state.

### Café income estimate
Season 1 site uses a demand/price formula (dish value, demand, café rank coefficient, character management/cooking grades, events). v1: income = editable per-dish sale value × quantity (the player's character skills and rank are baked into the value they enter). Porting the site's full formula is optional later work.

### Resets
Daily/weekly request counters reset at the game's reset time (setting; default to the server reset the player enters).

## 10. Import details

- Fetch `items.json`, `places.json`, `restaurants.json`, `shops.json`, `maps.json`, `combos.json` (dish combos, if relevant to cafés) from the site.
- Map: places → buildings (+ maps for grouping), recipes → recipes, restaurants → cafés (+ ranks, sellable), shops "Seeds" + "Flour Mill" → shop entries / recipes, items `convert_points` → IDP value.
- Fish xlsx: each fish becomes an item with fishing metadata, a hatchery recipe (fry → fish), IDP/fish, meat/fish (a fish → meat recipe if that exists in-game; check), "used in" text for notes.
- Time strings `HH:MM:SS` → seconds.
- Produce an import report: counts, items without names, recipes with unknown items.

## 11. Testing

- Unit tests for: "to fill the job" math, backward expansion/shortfall calc, priority allocation, job start/finish stock changes, importer mapping (with fixture slices of the source JSON and xlsx).
- Manual check: import, set stock, start/finish a job, plan a café run, flip priority and see suggestions change.

## 12. Left to the builder

- Exact UI styling and layout details.
- Balanced-priority rule.
- How the suggestion engine scores ties.
- Whether to model the Flour Mill as a building with recipes or as a shop.
- Undo implementation (history stack vs. snapshots).

## 13. Answers from builder review (2026-11-19)

1. **Stamina / characters are not a planning limit.** Every player has Workerjuu (the mascot): infinite stamina, can be assigned to multiple slots at once. The player assigns their few real characters to cafés (and Manjuu to everything else). → No character/stamina modelling. Stamina stays an info-only field on recipes. The limit on parallel work is **building slots** only. Café staff assignment is not tracked (its effect is captured by the editable sale value).
2. **Seasons add new content, same mechanics:** seasonal food, seasonal production recipes, and seasonal base ingredients that **spawn on the map once per day, 3 hours after daily reset**. → Every item/recipe/building gets a `season` tag (`permanent` or season number) and an `active` flag; the Data tab can filter by season and hide inactive seasonal content. Add a **daily spawn source**: item, expected quantity per day (editable), available from reset + 3h. Show "daily spawns ready" in the header after that time; one click adds the expected quantities to stock (editable before confirming). Reset time is a setting.
3. **Job time is per run.** A job of N runs takes N × per-run time. Outputs arrive run by run; collecting each run or all at the end gives the same total. → Recipe stores **time per run**; a job's end time = start + runs × per-run time (or the time the player types). Outputs are added on "finish" (full job). Partial collection is not needed in v1. IDP/hour and other rates are computed per run.
4. **Cafés almost always sell out** on the most profitable dishes because the player assigns their best characters there. → Starting a café run removes dishes from stock; finishing assumes all sold, with an optional "leftovers" field that puts unsold dishes back. Income = editable sale value per dish × qty (the player's character skills are baked into the value they enter).
5. **Fish are never converted to IDP**; they are food ingredients only. → Fish belong to the food pipeline. The spreadsheet's IDP columns are kept as notes only, not used for ranking.

### Calls confirmed by the player
- **IDP goal:** no target required. The Goods tab keeps factory slots busy with the best IDP-per-hour goods feasible from what the priority leaves free. Optional season IDP target, for progress display only.
- **Money:** balance typed in manually when the player wants research-target progress. Purchases are suggestions; "bought" adds seeds/fry to stock in one click (optionally deducting cost if a balance is tracked).

### Further builder calls (made after review)
- **Container:** server host/port/data dir come from env (`HOST`, `PORT`, `DATA_DIR`). On first start with an empty data volume, the image's bundled `gamedata.json` is copied in; it never overwrites an existing one. In the container, Data-tab edits live in the volume, not in git; Export JSON is how to bring them back into the repo. Optional `BASIC_AUTH=user:password` env turns on a login prompt, because the app has no accounts and may be reachable from the LAN. The importer runs on the dev PC, not in the container.
- **Bulk entry:** the Data tab supports paste from a spreadsheet (tab-separated rows) for items and recipes, since Season 2–5 content has to be typed in. Preview before saving; reports unknown item names.
- **Season bookkeeping:** settings hold the current season number; new entries default to it.
