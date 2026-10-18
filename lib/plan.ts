import type { CatalogItem, Recipe, Week } from "./types";

export const TIME_ZONE = "America/New_York";

/** Today's date (YYYY-MM-DD) in the app's home time zone. */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The Sunday that starts the week containing `dateISO`. */
export function sundayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return dt.toISOString().slice(0, 10);
}

export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function niceDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function weeksBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 6048e5);
}

const UNITS: Record<string, [string, string]> = {
  bag: ["bag", "bags"], can: ["can", "cans"], jar: ["jar", "jars"], bunch: ["bunch", "bunches"], head: ["head", "heads"],
  pint: ["pint", "pints"], pack: ["pack", "packs"], tub: ["tub", "tubs"], container: ["container", "containers"],
  piece: ["piece", "pieces"], dozen: ["dozen", "dozen"], clamshell: ["clamshell", "clamshells"],
};

/** Rounds a summed recipe amount up to something you can buy. */
export function fmtQty(q: number, unit: string): string {
  if (unit === "lb") return Math.ceil(q * 4 - 1e-9) / 4 + " lb";
  const n = Math.max(1, Math.ceil(q - 1e-9));
  if (!unit) return String(n);
  const u = UNITS[unit] ?? [unit, unit + "s"];
  return n + " " + (n === 1 ? u[0] : u[1]);
}

export type ListLine = { id: string; q: number; src: string[] };

/** Everything this week's plan calls for, merged across recipes. */
export function buildList(week: Week, recipes: Recipe[], catalog: Map<string, CatalogItem>): ListLine[] {
  const lines = new Map<string, ListLine>();
  const add = (id: string, q: number, src: string) => {
    if (!catalog.has(id)) return;
    const line = lines.get(id) ?? { id, q: 0, src: [] };
    line.q += q;
    if (!line.src.includes(src)) line.src.push(src);
    lines.set(id, line);
  };
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const lunch = week.lunch_recipe_id ? byId.get(week.lunch_recipe_id) : undefined;
  if (lunch) {
    const k = week.lunch_servings / lunch.base_servings;
    lunch.ingredients.forEach((i) => add(i.item_id, i.qty * k, lunch.short_name + " lunch"));
  }
  for (const id of week.dinner_ids) {
    const d = byId.get(id);
    if (d) d.ingredients.forEach((i) => add(i.item_id, i.qty * week.dinner_people, d.short_name));
  }
  const breakfast = recipes.find((r) => r.kind === "breakfast");
  if (breakfast && week.breakfast_days > 0) {
    breakfast.ingredients.forEach((i) => add(i.item_id, i.qty * week.breakfast_days, "Breakfast"));
  }
  for (const [id, n] of Object.entries(week.snacks ?? {})) if (n > 0) add(id, n, "Snacks");
  return [...lines.values()];
}

export function money(n: number): string {
  return "$" + Number(n).toFixed(2);
}
