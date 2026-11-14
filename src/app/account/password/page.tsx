import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import PasswordForm from "@/components/PasswordForm";
import { currentStaff } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  const { next } = await searchParams;
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/submit";
  return (
    <div className="page">
      <SiteHeader staff={staff.must_change_password ? null : staff} />
      <main className="wrap" style={{ maxWidth: 420 }}>
        <h1>{staff.must_change_password ? "Set your password" : "Change password"}</h1>
        <PasswordForm next={dest} forced={staff.must_change_password} />
      </main>
    </div>
  );
}
