export type Step = { t: string; m?: number };

export type CatalogItem = {
  id: string;
  name: string;
  unit: string;
  section: string;
  is_staple: boolean;
  tip: string | null;
  allergy_note: string | null;
  snack_label: string | null;
  snack_unit: string | null;
  sort_order: number;
};

export type Recipe = {
  id: string;
  kind: "lunch" | "dinner" | "breakfast";
  name: string;
  short_name: string;
  theme: string | null;
  minutes: number | null;
  base_servings: number;
  calories: number | null;
  protein_g: number | null;
  net_carbs_g: number | null;
  steps: Step[];
  sort_order: number;
  ingredients: { item_id: string; qty: number }[];
};

export type Week = {
  id: string;
  week_of: string;
  lunch_recipe_id: string | null;
  lunch_servings: number;
  dinner_ids: string[];
  dinner_people: number;
  breakfast_days: number;
  snacks: Record<string, number>;
  step_done: Record<string, boolean>;
  dinner_done: Record<string, boolean>;
};

export type WeekItem = {
  id: string;
  week_id: string;
  item_id: string | null;
  custom_name: string | null;
  section: string | null;
  checked: boolean;
  staple_needed: boolean;
  price: number | null;
  source: "plan" | "custom" | "in_store";
};

export type Trip = {
  id: string;
  trip_date: string;
  store: string;
  total: number;
  week_id: string | null;
};

export type InitialData = {
  catalog: CatalogItem[];
  recipes: Recipe[];
  sections: string[];
  week: Week;
  history: { week_of: string; lunch_recipe_id: string | null }[];
  items: WeekItem[];
  trips: Trip[];
  wfUsual: number | null;
  email: string;
};
