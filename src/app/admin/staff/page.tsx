import SiteHeader from "@/components/SiteHeader";
import StaffClient from "@/components/StaffClient";
import { requirePageStaff } from "@/lib/auth/session";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const me = await requirePageStaff("admin", "/admin/staff");
  const rows = await query<{
    id: string; email: string; name: string; role: string; active: boolean; must_change_password: boolean; last_login_at: string | null;
  }>("SELECT id, email::text, name, role, active, must_change_password, last_login_at FROM app.staff ORDER BY active DESC, name");
  return (
    <div className="page">
      <SiteHeader staff={me} />
      <main className="wrap">
        <h1>Staff accounts</h1>
        <p className="muted" style={{ margin: 0 }}>
          Contributors can submit photos and use survey mode. Admins can also review submissions, enter city actions and manage
          accounts. Passwords are never emailed: give the temporary password to the person directly.
        </p>
        <StaffClient me={me.id} initial={JSON.parse(JSON.stringify(rows))} />
      </main>
    </div>
  );
}
