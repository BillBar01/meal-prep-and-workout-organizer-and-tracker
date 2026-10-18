import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureWeek, loadReference, loadWeekState } from "@/lib/data";
import { sundayOf, todayISO } from "@/lib/plan";
import MealApp from "@/components/MealApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: allowed } = await supabase.rpc("is_allowed");
  if (!allowed) {
    return (
      <main className="login">
        <form action="/auth/signout" method="post">
          <h1>Private app</h1>
          <p className="muted">{user.email} doesn't have access to this app.</p>
          <button className="btn" type="submit">Sign out</button>
        </form>
      </main>
    );
  }

  const ref = await loadReference(supabase);
  const week = await ensureWeek(supabase, sundayOf(todayISO()));
  const state = await loadWeekState(supabase, week);

  return <MealApp initial={{ ...ref, ...state, week, email: user.email ?? "" }} />;
}
