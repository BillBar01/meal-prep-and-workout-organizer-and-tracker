# Meal Prep & Workout Organizer

A private planner for keto weekday meal prep, and later workouts.

## Stack

- **Next.js 15** (App Router, TypeScript), hosted on **Vercel**
- **Supabase** for Postgres and email sign-in. Only addresses in `public.allowed_emails` can create an account or read any data; that's enforced by row-level security and a trigger on `auth.users`.

## Meal prep

- **Plan**: pick the week's lunch meal-prep recipe, dinners, breakfast days and snacks.
- **Shop**: grocery checklist grouped by store aisle, a staples check before you leave, add items (or log ones you grabbed in the store, with a price), and a trip log comparing Giant receipts to a usual Whole Foods week.
- **Prep**: Sunday lunch prep, step by step, with built-in timers.
- **Dinners**: quick protein + vegetable recipes with steps and timers.

All recipes are peanut- and tree-nut-free. Items that sometimes carry "may contain" warnings are flagged.

## Data model

| Table | What it holds |
| --- | --- |
| `catalog_items` | Everything you might buy, with unit, aisle, staple flag, tips and allergy notes |
| `recipes`, `recipe_ingredients` | Lunch, dinner and breakfast recipes with steps (JSON) and per-batch quantities |
| `weeks` | One row per week: chosen lunch/dinners, servings, snacks, step progress |
| `week_items` | Checklist state per week, plus custom and in-store items |
| `trips`, `trip_items` | Receipt totals now; line items and receipt photos (`receipt_path`) later |
| `settings` | Aisle order, usual Whole Foods spend |
| `allowed_emails` | Who may sign in (not readable through the API) |

## Local development

```bash
cp .env.example .env.local   # fill in the Supabase URL and publishable key
npm install
npm run dev
```

`legacy/index.html` is the original single-file version.
