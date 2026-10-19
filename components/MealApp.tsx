"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureWeek, loadWeekState } from "@/lib/data";
import { addDays, buildList, fmtQty, money, niceDate, sundayOf, todayISO, weeksBetween } from "@/lib/plan";
import type { InitialData, Recipe, Step, Trip, Week, WeekItem } from "@/lib/types";

type Tab = "plan" | "shop" | "prep" | "dinner";
const TABS: Tab[] = ["plan", "shop", "prep", "dinner"];
const TITLES: Record<Tab, string> = { plan: "Plan the week", shop: "Grocery list", prep: "Meal prep", dinner: "Dinners" };
const TAB_KEY = "meal-prep:tab";

type WakeLock = { release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void };

export default function MealApp({ initial }: { initial: InitialData }) {
  const supabase = useMemo(() => createClient(), []);
  const catalog = useMemo(() => new Map(initial.catalog.map((c) => [c.id, c])), [initial.catalog]);
  const recipes = initial.recipes;
  const lunches = useMemo(() => recipes.filter((r) => r.kind === "lunch"), [recipes]);
  const dinners = useMemo(() => recipes.filter((r) => r.kind === "dinner"), [recipes]);
  const breakfast = useMemo(() => recipes.find((r) => r.kind === "breakfast"), [recipes]);
  const snackItems = useMemo(() => initial.catalog.filter((c) => c.snack_label), [initial.catalog]);
  const sections = initial.sections.length ? initial.sections : ["Other"];

  const [tab, setTab] = useState<Tab>("plan");
  const [week, setWeek] = useState<Week>(initial.week);
  const [items, setItems] = useState<WeekItem[]>(initial.items);
  const [trips, setTrips] = useState<Trip[]>(initial.trips);
  const [history, setHistory] = useState(initial.history);
  const [wfUsual, setWfUsual] = useState<number | null>(initial.wfUsual);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [toast, setToast] = useState("");
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [addName, setAddName] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [tripStore, setTripStore] = useState("Giant");
  const [tripTotal, setTripTotal] = useState("");
  const [wfInput, setWfInput] = useState(initial.wfUsual === null ? "" : String(initial.wfUsual));
  const [equipment, setEquipment] = useState<string[]>(initial.equipment);
  const hasGrill = equipment.includes("grill");

  const weekRef = useRef(week);
  weekRef.current = week;

  /* ---------- tab memory ---------- */
  useEffect(() => {
    const hash = window.location.hash.slice(1) as Tab;
    let saved: Tab | null = null;
    try { saved = localStorage.getItem(TAB_KEY) as Tab | null; } catch {}
    const t = TABS.includes(hash) ? hash : saved && TABS.includes(saved) ? saved : "plan";
    setTab(t);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    setArmed(false);
    try { localStorage.setItem(TAB_KEY, t); } catch {}
    window.scrollTo(0, 0);
  };

  /* ---------- saving ---------- */
  const inFlight = useRef(0);
  const run = useCallback(async <T,>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T | null> => {
    inFlight.current++;
    setStatus("saving");
    const { data, error } = await p;
    inFlight.current--;
    if (error) {
      setStatus("error");
      setToast("Couldn't save that. Check your connection and try again.");
      return null;
    }
    if (!inFlight.current) setStatus("saved");
    return data;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const weekPatch = useRef<Partial<Week>>({});
  const weekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushWeek = useCallback(async () => {
    if (weekTimer.current) clearTimeout(weekTimer.current);
    weekTimer.current = null;
    const patch = weekPatch.current;
    weekPatch.current = {};
    if (Object.keys(patch).length) await run(supabase.from("weeks").update(patch).eq("id", weekRef.current.id));
  }, [run, supabase]);
  const patchWeek = (patch: Partial<Week>) => {
    setWeek((w) => ({ ...w, ...patch }));
    weekPatch.current = { ...weekPatch.current, ...patch };
    if (weekTimer.current) clearTimeout(weekTimer.current);
    weekTimer.current = setTimeout(flushWeek, 400);
  };

  const planState = useMemo(() => new Map(items.filter((i) => i.item_id).map((i) => [i.item_id as string, i])), [items]);
  const customItems = items.filter((i) => !i.item_id);

  async function setPlanItem(itemId: string, fields: Partial<Pick<WeekItem, "checked" | "staple_needed">>) {
    const prev = planState.get(itemId);
    const merged = { checked: prev?.checked ?? false, staple_needed: prev?.staple_needed ?? false, ...fields };
    setItems((list) => prev
      ? list.map((i) => (i.item_id === itemId ? { ...i, ...merged } : i))
      : [...list, { id: "tmp-" + itemId, week_id: week.id, item_id: itemId, custom_name: null, section: null, price: null, source: "plan", ...merged }]);
    const row = await run(
      supabase.from("week_items")
        .upsert({ week_id: week.id, item_id: itemId, source: "plan", ...merged }, { onConflict: "week_id,item_id" })
        .select("id").single(),
    );
    if (row) setItems((list) => list.map((i) => (i.item_id === itemId ? { ...i, id: (row as { id: string }).id } : i)));
  }

  async function addCustom(inStore: boolean) {
    const name = addName.trim();
    if (!name) return;
    const price = parseFloat(addPrice);
    const row = await run(
      supabase.from("week_items")
        .insert({ week_id: week.id, custom_name: name, section: "Other", price: price > 0 ? price : null, source: inStore ? "in_store" : "custom", checked: inStore })
        .select("id,week_id,item_id,custom_name,section,checked,staple_needed,price,source").single(),
    );
    if (row) {
      const r = row as WeekItem;
      setItems((list) => [...list, { ...r, price: r.price === null ? null : Number(r.price) }]);
      setAddName("");
      setAddPrice("");
    }
  }
  async function toggleCustom(id: string, checked: boolean) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, checked } : i)));
    await run(supabase.from("week_items").update({ checked }).eq("id", id));
  }
  async function removeCustom(id: string) {
    setItems((list) => list.filter((i) => i.id !== id));
    await run(supabase.from("week_items").delete().eq("id", id));
  }

  async function logTrip() {
    const total = parseFloat(tripTotal);
    if (!(total > 0)) return;
    const amount = Math.round(total * 100) / 100;
    const today = todayISO();
    if (trips.some((t) => t.trip_date === today && t.store === tripStore && t.total === amount)) {
      setTripTotal("");
      setToast(`A ${money(amount)} ${tripStore} trip is already logged for today`);
      return;
    }
    const row = await run(
      supabase.from("trips").insert({ trip_date: today, store: tripStore, total: amount, week_id: week.id })
        .select("id,trip_date,store,total,week_id").single(),
    );
    if (row) {
      const t = row as Trip;
      setTrips((list) => [...list, { ...t, total: Number(t.total) }]);
      setTripTotal("");
      setToast("Trip saved");
    }
  }
  async function saveWfUsual() {
    const v = parseFloat(wfInput);
    const value = v > 0 ? Math.round(v * 100) / 100 : null;
    if (value === wfUsual) return;
    setWfUsual(value);
    await run(supabase.from("settings").upsert({ key: "whole_foods_usual", value }, { onConflict: "key" }));
  }

  async function toggleGrill() {
    const next = hasGrill ? equipment.filter((e) => e !== "grill") : [...equipment, "grill"];
    setEquipment(next);
    await run(supabase.from("settings").upsert({ key: "equipment", value: next }, { onConflict: "key" }));
  }

  /* ---------- stove or grill ---------- */
  const onGrill = (r: Recipe) => hasGrill && !!r.grill_steps?.length && week.cook_methods?.[r.id] === "grill";
  const stepsFor = (r: Recipe) => (onGrill(r) ? (r.grill_steps as Step[]) : r.steps);
  const stepPrefix = (kind: string, r: Recipe) => `${kind}:${r.id}${onGrill(r) ? ":grill" : ""}`;
  const methodSwitch = (r: Recipe) => {
    if (!hasGrill || !r.grill_steps?.length) return null;
    const g = onGrill(r);
    const set = (m: "stove" | "grill") => patchWeek({ cook_methods: { ...week.cook_methods, [r.id]: m } });
    return (
      <div className="chips" role="group" aria-label="Cooking method">
        <button type="button" className="chip" aria-pressed={!g} onClick={() => set("stove")}>Stove &amp; oven</button>
        <button type="button" className="chip" aria-pressed={g} onClick={() => set("grill")}>Grill</button>
      </div>
    );
  };

  async function startNewWeek() {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    await flushWeek();
    const next = [sundayOf(todayISO()), addDays(week.week_of, 7)].sort().pop() as string;
    try {
      setStatus("saving");
      const w = await ensureWeek(supabase, next);
      const s = await loadWeekState(supabase, w);
      setWeek(w); setItems(s.items); setTrips(s.trips); setHistory(s.history); setWfUsual(s.wfUsual);
      setStatus("saved");
      setToast("New week started for " + niceDate(w.week_of));
    } catch {
      setStatus("error");
      setToast("Couldn't start the new week. Try again.");
    }
  }

  /* ---------- stay in sync when you switch devices ---------- */
  useEffect(() => {
    async function refresh() {
      if (document.visibilityState !== "visible" || inFlight.current || weekTimer.current) return;
      try {
        const target = [sundayOf(todayISO()), weekRef.current.week_of].sort().pop() as string;
        const w = await ensureWeek(supabase, target);
        const s = await loadWeekState(supabase, w);
        if (inFlight.current || weekTimer.current) return;
        setWeek(w); setItems(s.items); setTrips(s.trips); setHistory(s.history); setWfUsual(s.wfUsual);
      } catch {}
    }
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [supabase]);

  /* ---------- timers ---------- */
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [ringing, setRinging] = useState<Record<string, boolean>>({});
  const [, setNow] = useState(0);
  const audio = useRef<AudioContext | null>(null);
  const beep = useCallback(() => {
    const ac = audio.current;
    try {
      if (ac) {
        const t = ac.currentTime;
        for (let i = 0; i < 4; i++) {
          const o = ac.createOscillator(), g = ac.createGain();
          o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
          const s = t + i * 0.45;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.exponentialRampToValueAtTime(0.35, s + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
          o.start(s); o.stop(s + 0.32);
        }
      }
    } catch {}
    try { navigator.vibrate?.([250, 120, 250]); } catch {}
  }, []);
  useEffect(() => {
    if (!Object.keys(timers).length) return;
    const id = setInterval(() => {
      const now = Date.now();
      const done = Object.entries(timers).filter(([, end]) => now >= end).map(([k]) => k);
      if (done.length) {
        setTimers((t) => { const n = { ...t }; done.forEach((k) => delete n[k]); return n; });
        setRinging((r) => { const n = { ...r }; done.forEach((k) => (n[k] = true)); return n; });
        beep();
      }
      setNow(now);
    }, 500);
    return () => clearInterval(id);
  }, [timers, beep]);
  function tapTimer(key: string, sec: number) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current = audio.current ?? new Ctx();
      if (audio.current.state === "suspended") audio.current.resume();
    } catch {}
    if (ringing[key]) setRinging((r) => { const n = { ...r }; delete n[key]; return n; });
    else if (timers[key]) setTimers((t) => { const n = { ...t }; delete n[key]; return n; });
    else setTimers((t) => ({ ...t, [key]: Date.now() + sec * 1000 }));
  }
  function timerLabel(key: string, sec: number) {
    if (ringing[key]) return "Done! Tap to clear";
    if (timers[key]) {
      const left = Math.max(0, Math.round((timers[key] - Date.now()) / 1000));
      return "⏱ " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") + " · tap to stop";
    }
    const mm = Math.floor(sec / 60), ss = Math.round(sec % 60);
    return "Start " + (ss ? `${mm} min ${ss} s` : `${mm} min`) + " timer";
  }

  const wake = useRef<WakeLock | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const [canWake, setCanWake] = useState(false);
  useEffect(() => setCanWake("wakeLock" in navigator), []);
  async function toggleWake() {
    if (wake.current) { try { await wake.current.release(); } catch {} wake.current = null; setWakeOn(false); return; }
    try {
      const lock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<WakeLock> } }).wakeLock.request("screen");
      wake.current = lock; setWakeOn(true);
      lock.addEventListener("release", () => { wake.current = null; setWakeOn(false); });
    } catch { setWakeOn(false); }
  }

  /* ---------- derived ---------- */
  const lunch = lunches.find((r) => r.id === week.lunch_recipe_id) ?? lunches[0];
  const list = useMemo(() => buildList(week, recipes, catalog), [week, recipes, catalog]);
  const buy = list.filter((l) => !catalog.get(l.id)?.is_staple || planState.get(l.id)?.staple_needed);
  const staples = list.filter((l) => catalog.get(l.id)?.is_staple);
  const totalCount = buy.length + customItems.length;
  const gotCount = buy.filter((l) => planState.get(l.id)?.checked).length + customItems.filter((c) => c.checked).length;

  function lastHad(id: string): number | null {
    const w = history.filter((h) => h.lunch_recipe_id === id).map((h) => weeksBetween(h.week_of, week.week_of)).filter((n) => n > 0);
    return w.length ? Math.min(...w) : null;
  }

  /* ---------- pieces ---------- */
  const stepper = (val: number, label: string, onChange: (n: number) => void, min: number, max: number) => (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Fewer" onClick={() => onChange(Math.max(min, val - 1))}>−</button>
      <span>{val}</span>
      <button type="button" aria-label="More" onClick={() => onChange(Math.min(max, val + 1))}>+</button>
    </span>
  );

  const stepsList = (prefix: string, steps: Step[]) => (
    <ol className="steps">
      {steps.map((s, i) => {
        const key = `${prefix}:${i}`;
        const done = !!week.step_done?.[key];
        const sec = s.m ? Math.round(s.m * 60) : 0;
        return (
          <li key={key} className={"step" + (done ? " done" : "")}>
            <input type="checkbox" checked={done} aria-label={`Step ${i + 1} done`}
              onChange={(e) => patchWeek({ step_done: { ...week.step_done, [key]: e.target.checked } })} />
            <div className="txt">
              <span>{s.t}</span>
              {sec > 0 && (
                <button type="button" className={"timer" + (timers[key] ? " running" : "") + (ringing[key] ? " ring" : "")} onClick={() => tapTimer(key, sec)}>
                  {timerLabel(key, sec)}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );

  function viewPlan() {
    const recent = history.slice(-4);
    return (
      <>
        <section className="block">
          <div className="sec-head"><h2>Lunch meal prep</h2><span className="small muted">Cooked Sunday, eaten Mon–Fri</span></div>
          {recent.length > 0 && (
            <div className="history">Recent lunches:{" "}
              {recent.map((h) => (
                <span key={h.week_of} className="pill quiet">{lunches.find((r) => r.id === h.lunch_recipe_id)?.short_name ?? "—"} · {niceDate(h.week_of)}</span>
              ))}
            </div>
          )}
          <div className="stack">
            {lunches.map((r) => {
              const w = lastHad(r.id);
              return (
                <button key={r.id} type="button" className="choice" aria-pressed={lunch?.id === r.id} onClick={() => patchWeek({ lunch_recipe_id: r.id })}>
                  <span className="row1">
                    <span className="name">{r.name}</span>
                    {w === null ? <span className="pill">New to you</span> : <span className="pill quiet">Had {w} wk{w > 1 ? "s" : ""} ago</span>}
                  </span>
                  <span className="macro">{r.theme} · ~{r.minutes} min prep · per lunch est. {r.calories} cal, {r.protein_g} g protein, {r.net_carbs_g} g net carbs</span>
                </button>
              );
            })}
          </div>
          <div className="line">
            <div><strong>Lunches to make</strong><div className="small muted">Recipe amounts scale to this</div></div>
            {stepper(week.lunch_servings, "Lunches", (n) => patchWeek({ lunch_servings: n }), 1, 10)}
          </div>
        </section>
        <section className="block">
          <div className="sec-head"><h2>Dinners</h2><span className="small muted">{week.dinner_ids.length} picked · protein + a vegetable</span></div>
          <div className="chips">
            {dinners.map((d) => (
              <button key={d.id} type="button" className="chip" aria-pressed={week.dinner_ids.includes(d.id)}
                onClick={() => patchWeek({ dinner_ids: week.dinner_ids.includes(d.id) ? week.dinner_ids.filter((x) => x !== d.id) : [...week.dinner_ids, d.id] })}>
                {d.short_name}
              </button>
            ))}
          </div>
          <div className="line"><div><strong>People at dinner</strong></div>{stepper(week.dinner_people, "People", (n) => patchWeek({ dinner_people: n }), 1, 4)}</div>
        </section>
        <section className="block">
          <div className="sec-head"><h2>Breakfast</h2></div>
          <div className="line">
            <div><strong>{breakfast?.name ?? "Breakfast"}</strong><div className="small muted">2 eggs + about 2 oz salmon a day</div></div>
            {stepper(week.breakfast_days, "Breakfast days", (n) => patchWeek({ breakfast_days: n }), 0, 7)}
          </div>
        </section>
        <section className="block">
          <div className="sec-head"><h2>Snacks</h2></div>
          <div className="stack">
            {snackItems.map((s) => (
              <div key={s.id} className="line">
                <div><strong>{s.snack_label}</strong><div className="small muted">{s.snack_unit}</div></div>
                {stepper(week.snacks?.[s.id] ?? 0, s.snack_label ?? s.name, (n) => patchWeek({ snacks: { ...week.snacks, [s.id]: n } }), 0, 6)}
              </div>
            ))}
          </div>
        </section>
        <section className="block">
          <div className="sec-head"><h2>Your kitchen</h2></div>
          <div className="line">
            <div><strong>I have a grill</strong><div className="small muted">Adds a grill version to the prep and dinner steps</div></div>
            <button type="button" className="chip" aria-pressed={hasGrill} onClick={toggleGrill}>{hasGrill ? "Yes" : "No"}</button>
          </div>
        </section>
        <div className="note flag small">
          <strong>Peanut &amp; tree-nut free.</strong> Nothing here uses nuts, and none of the dishes call for nut oils or pesto. Items that sometimes carry “may contain” warnings get a <strong>Check label</strong> tag on the list.
        </div>
        <section className="block">
          <button type="button" className="btn wide" onClick={() => go("shop")}>Open grocery list · {totalCount} items</button>
          <button type="button" className="btn ghost wide" onClick={startNewWeek}>{armed ? "Tap again to start next week" : "Start a new week"}</button>
          <p className="small muted" style={{ margin: 0 }}>Starting a new week keeps this week in your history and opens a fresh list with the same picks. Your trip log stays.</p>
        </section>
      </>
    );
  }

  function viewShop() {
    const giant = trips.filter((t) => t.store === "Giant");
    const wf = trips.filter((t) => t.store === "Whole Foods");
    const wfBase = wfUsual ?? (wf.length ? wf.reduce((a, t) => a + t.total, 0) / wf.length : 0);
    const lastGiant = giant[giant.length - 1];
    return (
      <>
        <div className="progress">
          <div className="sec-head">
            <strong>{gotCount} of {totalCount} in the cart</strong>
            <button type="button" className="btn ghost small" onClick={() => go("plan")}>Edit plan</button>
          </div>
          <div className="bar"><b style={{ width: `${totalCount ? Math.round((gotCount / totalCount) * 100) : 0}%` }} /></div>
        </div>
        <section className="block">
          <div className="staples">
            <div><strong>Before you leave, check your kitchen</strong><div className="small muted">Tap anything you’re out of and it joins the list.</div></div>
            <div className="chips">
              {staples.map((l) => (
                <button key={l.id} type="button" className="chip" aria-pressed={!!planState.get(l.id)?.staple_needed}
                  onClick={() => setPlanItem(l.id, { staple_needed: !planState.get(l.id)?.staple_needed })}>
                  {catalog.get(l.id)?.name}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="block">
          {sections.map((sec) => {
            const rows = buy.filter((l) => catalog.get(l.id)?.section === sec);
            const extra = sec === "Other" ? customItems : [];
            if (!rows.length && !extra.length) return null;
            const left = rows.filter((l) => !planState.get(l.id)?.checked).length + extra.filter((c) => !c.checked).length;
            return (
              <div key={sec} className="aisle">
                <h3><span>{sec}</span><span className="small muted">{left ? `${left} left` : "done"}</span></h3>
                {rows.map((l) => {
                  const c = catalog.get(l.id)!;
                  const got = !!planState.get(l.id)?.checked;
                  return (
                    <label key={l.id} className={"item" + (got ? " got" : "")}>
                      <input type="checkbox" checked={got} aria-label={c.name} onChange={(e) => setPlanItem(l.id, { checked: e.target.checked })} />
                      <span className="nm">
                        {c.name} {c.allergy_note && <span className="pill flag">Check label</span>}
                        <small>{l.src.join(", ")}</small>
                        {c.tip && <small>{c.tip}</small>}
                        {c.allergy_note && <small className="warnline">{c.allergy_note}</small>}
                      </span>
                      <span className="qty">{c.is_staple ? "restock" : fmtQty(l.q, c.unit)}</span>
                    </label>
                  );
                })}
                {extra.map((c) => (
                  <label key={c.id} className={"item" + (c.checked ? " got" : "")}>
                    <input type="checkbox" checked={c.checked} aria-label={c.custom_name ?? ""} onChange={(e) => toggleCustom(c.id, e.target.checked)} />
                    <span className="nm">{c.custom_name}<small>{c.source === "in_store" ? "Picked up in the store" : "Added by you"}</small></span>
                    <span className="qty">
                      {c.price !== null && money(c.price)}
                      <button type="button" className="x" aria-label={`Remove ${c.custom_name}`} onClick={(e) => { e.preventDefault(); removeCustom(c.id); }}>×</button>
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </section>
        <section className="block">
          <form className="add" onSubmit={(e) => { e.preventDefault(); addCustom(false); }}>
            <strong>Add something</strong>
            <div className="row">
              <input id="addName" placeholder="Item name" aria-label="Item name" value={addName} onChange={(e) => setAddName(e.target.value)} />
              <input id="addPrice" type="number" inputMode="decimal" step="0.01" min="0" placeholder="Price" aria-label="Price (optional)" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} />
            </div>
            <div className="row buttons">
              <button className="btn ghost" type="submit" disabled={!addName.trim()}>Add to list</button>
              <button className="btn" type="button" disabled={!addName.trim()} onClick={() => addCustom(true)}>Grabbed it in store</button>
            </div>
          </form>
        </section>
        <section className="block">
          <h2>Trip log</h2>
          <div className="trip">
            {lastGiant && wfBase ? (
              <>
                <div className="savings">{wfBase - lastGiant.total >= 0 ? "Saved " + money(wfBase - lastGiant.total) : "Spent " + money(lastGiant.total - wfBase) + " more"} vs. Whole Foods</div>
                <div className="small muted">Giant {money(lastGiant.total)} on {niceDate(lastGiant.trip_date)} vs. your usual Whole Foods week of {money(wfBase)}</div>
              </>
            ) : !wfBase ? (
              <div className="small muted">Enter what a normal Whole Foods week costs you, then log today’s Giant receipt to see the difference.</div>
            ) : null}
            <div className="fields">
              <label htmlFor="tripStore">Store
                <select id="tripStore" value={tripStore} onChange={(e) => setTripStore(e.target.value)}>
                  <option>Giant</option><option>Whole Foods</option><option>Other</option>
                </select>
              </label>
              <label htmlFor="tripTotal">Receipt total
                <input id="tripTotal" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={tripTotal} onChange={(e) => setTripTotal(e.target.value)} />
              </label>
            </div>
            <label htmlFor="wfUsual">Your usual Whole Foods week (optional)
              <input id="wfUsual" type="number" inputMode="decimal" step="0.01" min="0" placeholder="e.g. 165.00" value={wfInput} onChange={(e) => setWfInput(e.target.value)} onBlur={saveWfUsual} />
            </label>
            <button type="button" className="btn" disabled={!(parseFloat(tripTotal) > 0)} onClick={logTrip}>Save trip</button>
            {trips.length > 0 && (
              <table className="trips"><tbody>
                {[...trips].reverse().map((t) => <tr key={t.id}><td>{niceDate(t.trip_date)}</td><td>{t.store}</td><td>{money(t.total)}</td></tr>)}
              </tbody></table>
            )}
          </div>
        </section>
      </>
    );
  }

  function viewPrep() {
    if (!lunch) return <div className="note">Pick a lunch on the Plan tab first.</div>;
    const steps = stepsFor(lunch), prefix = stepPrefix("L", lunch);
    const done = steps.filter((_, i) => week.step_done?.[`${prefix}:${i}`]).length;
    return (
      <>
        <section className="block recipe-head">
          <div className="eyebrow">Sunday lunch prep · {week.lunch_servings} lunches{onGrill(lunch) ? " · on the grill" : ""}</div>
          <h2>{lunch.name}</h2>
          <div className="macro">~{lunch.minutes} min · {done} of {steps.length} steps done · per lunch est. {lunch.calories} cal, {lunch.protein_g} g protein, {lunch.net_carbs_g} g net carbs</div>
          {methodSwitch(lunch)}
          {canWake && <button type="button" className="btn ghost" onClick={toggleWake}>{wakeOn ? "Screen stays on while this is open" : "Keep screen on while cooking"}</button>}
        </section>
        {week.lunch_servings !== lunch.base_servings && (
          <div className="note small">The steps are written for {lunch.base_servings} lunches. Your list is scaled to {week.lunch_servings}, so scale the sauce and spices by about {(week.lunch_servings / lunch.base_servings).toFixed(1)}×.</div>
        )}
        {stepsList(prefix, steps)}
        <section className="block">
          <div className="note small"><strong>Keeping it fresh:</strong> cooked meat keeps 3–4 days in the fridge. Refrigerate Monday–Wednesday's lunches and freeze Thursday's and Friday's. Move each frozen one to the fridge the night before.</div>
        </section>
        {breakfast && (
          <section className="block">
            <h2>Every morning</h2>
            <details className="card">
              <summary><span className="row1"><strong>{breakfast.name}</strong><span className="pill quiet">{breakfast.minutes} min</span></span><span className="small muted">Tap for the timer</span></summary>
              <div className="inner">{stepsList("B", breakfast.steps)}</div>
            </details>
          </section>
        )}
      </>
    );
  }

  function viewDinner() {
    const picks = week.dinner_ids.map((id) => dinners.find((d) => d.id === id)).filter(Boolean) as Recipe[];
    if (!picks.length) {
      return (
        <section className="block">
          <div className="note">No dinners picked yet. Choose a few on the Plan tab and they’ll show up here with cooking steps.</div>
          <button type="button" className="btn" onClick={() => go("plan")}>Pick dinners</button>
        </section>
      );
    }
    return (
      <section className="block">
        <p className="small muted" style={{ margin: 0 }}>Cooking for {week.dinner_people}. Each one is a protein and a vegetable, about 20–45 minutes. Tap a dinner to open the steps.</p>
        {picks.map((d) => {
          const made = !!week.dinner_done?.[d.id];
          return (
            <details key={d.id} className="card" open={!!open[d.id]} onToggle={(e) => { const isOpen = (e.currentTarget as HTMLDetailsElement).open; setOpen((o) => (o[d.id] === isOpen ? o : { ...o, [d.id]: isOpen })); }}>
              <summary>
                <span className="row1"><strong>{d.name}</strong><span className={"pill" + (made ? "" : " quiet")}>{made ? "Made" : `~${d.minutes} min`}</span></span>
                <span className="small muted">est. {d.net_carbs_g} g net carbs</span>
              </summary>
              <div className="inner">
                {methodSwitch(d)}
                {stepsList(stepPrefix("D", d), stepsFor(d))}
                <label className="made">
                  <input type="checkbox" checked={made} onChange={(e) => patchWeek({ dinner_done: { ...week.dinner_done, [d.id]: e.target.checked } })} /> Made it this week
                </label>
              </div>
            </details>
          );
        })}
      </section>
    );
  }

  const syncLabel = status === "saving" ? "Saving…" : status === "error" ? "Not saved" : "Saved";

  return (
    <>
      <div className="app">
        <header className="top">
          <div>
            <div className="eyebrow">Week of {niceDate(week.week_of)}</div>
            <h1>{TITLES[tab]}</h1>
          </div>
          <div className="stack" style={{ justifyItems: "end", gap: 4 }}>
            <div className={"sync " + status}><i /><span>{syncLabel}</span></div>
            {tab === "plan" && (
              <form action="/auth/signout" method="post"><button className="x small" type="submit">Sign out</button></form>
            )}
          </div>
        </header>
        <p className="summary">Lunch: {lunch?.short_name ?? "—"} ×{week.lunch_servings} · {week.dinner_ids.length} dinners · breakfast {week.breakfast_days} days</p>
        <main>
          {tab === "plan" ? viewPlan() : tab === "shop" ? viewShop() : tab === "prep" ? viewPrep() : viewDinner()}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <nav className="tabs" aria-label="Sections">
        <div className="in">
          {TABS.map((t) => (
            <button key={t} type="button" aria-current={tab === t ? "page" : undefined} onClick={() => go(t)}>
              {ICONS[t]}
              {t === "dinner" ? "Dinners" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

const ICONS: Record<Tab, React.ReactNode> = {
  plan: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  shop: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 8H7" /><circle cx="9" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></svg>,
  prep: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="10" rx="2" /><path d="M7 9V6h10v3M3 13h18" /></svg>,
  dinner: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6.5" /><path d="M12 4v2M3 13h1.5M19.5 13H21" /></svg>,
};
