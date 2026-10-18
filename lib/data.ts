import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogItem, Recipe, Trip, Week, WeekItem } from "./types";

const WEEK_COLUMNS = "id,week_of,lunch_recipe_id,lunch_servings,dinner_ids,dinner_people,breakfast_days,snacks,step_done,dinner_done,cook_methods";

export async function loadReference(supabase: SupabaseClient) {
  const [catalog, recipes, ings, sections, equipment] = await Promise.all([
    supabase.from("catalog_items").select("*").order("sort_order"),
    supabase.from("recipes").select("*").eq("archived", false).order("sort_order"),
    supabase.from("recipe_ingredients").select("recipe_id,item_id,qty"),
    supabase.from("settings").select("value").eq("key", "sections").maybeSingle(),
    supabase.from("settings").select("value").eq("key", "equipment").maybeSingle(),
  ]);
  const err = catalog.error || recipes.error || ings.error || sections.error || equipment.error;
  if (err) throw err;
  const byRecipe = new Map<string, { item_id: string; qty: number }[]>();
  for (const i of ings.data ?? []) {
    const list = byRecipe.get(i.recipe_id) ?? [];
    list.push({ item_id: i.item_id, qty: Number(i.qty) });
    byRecipe.set(i.recipe_id, list);
  }
  return {
    catalog: (catalog.data ?? []) as CatalogItem[],
    recipes: (recipes.data ?? []).map((r) => ({ ...r, base_servings: Number(r.base_servings), ingredients: byRecipe.get(r.id) ?? [] })) as Recipe[],
    sections: (sections.data?.value as string[]) ?? [],
    equipment: (equipment.data?.value as string[]) ?? ["stove", "oven"],
  };
}

/** Finds this week's plan, creating it from the most recent week's choices if it doesn't exist yet. */
export async function ensureWeek(supabase: SupabaseClient, weekOf: string): Promise<Week> {
  const existing = await supabase.from("weeks").select(WEEK_COLUMNS).eq("week_of", weekOf).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as Week;
  const prev = await supabase.from("weeks").select(WEEK_COLUMNS).lt("week_of", weekOf).order("week_of", { ascending: false }).limit(1).maybeSingle();
  const p = prev.data as Week | null;
  const created = await supabase
    .from("weeks")
    .upsert(
      {
        week_of: weekOf,
        lunch_recipe_id: p?.lunch_recipe_id ?? null,
        lunch_servings: p?.lunch_servings ?? 5,
        dinner_ids: p?.dinner_ids ?? [],
        dinner_people: p?.dinner_people ?? 1,
        breakfast_days: p?.breakfast_days ?? 5,
        snacks: p?.snacks ?? {},
        cook_methods: p?.cook_methods ?? {},
      },
      { onConflict: "week_of", ignoreDuplicates: false },
    )
    .select(WEEK_COLUMNS)
    .single();
  if (created.error) throw created.error;
  return created.data as Week;
}

export async function loadWeekState(supabase: SupabaseClient, week: Week) {
  const [items, trips, history, wf] = await Promise.all([
    supabase.from("week_items").select("id,week_id,item_id,custom_name,section,checked,staple_needed,price,source").eq("week_id", week.id).order("created_at"),
    supabase.from("trips").select("id,trip_date,store,total,week_id").order("trip_date").order("created_at"),
    supabase.from("weeks").select("week_of,lunch_recipe_id").lt("week_of", week.week_of).order("week_of"),
    supabase.from("settings").select("value").eq("key", "whole_foods_usual").maybeSingle(),
  ]);
  const err = items.error || trips.error || history.error || wf.error;
  if (err) throw err;
  return {
    items: (items.data ?? []).map((i) => ({ ...i, price: i.price === null ? null : Number(i.price) })) as WeekItem[],
    trips: (trips.data ?? []).map((t) => ({ ...t, total: Number(t.total) })) as Trip[],
    history: history.data ?? [],
    wfUsual: typeof wf.data?.value === "number" ? (wf.data.value as number) : null,
  };
}
