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
