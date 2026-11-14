import Link from "next/link";
import { SITE_NAME } from "@/config";
import type { Staff } from "@/lib/auth/staff";
import SignOutButton from "./SignOutButton";

export default function SiteHeader({ staff }: { staff: Staff | null }) {
  return (
    <header className="topbar">
      <Link href="/" style={{ fontWeight: 700, fontSize: 17, opacity: 1 }}>{SITE_NAME}</Link>
      <span className="spacer" />
      <nav>
        <Link href="/">Map</Link>
        {staff && <Link href="/submit">Submit</Link>}
        {staff && <Link href="/my">My submissions</Link>}
        {staff?.role === "admin" && <Link href="/admin">Review queue</Link>}
        {staff?.role === "admin" && <Link href="/admin/staff">Staff</Link>}
        {staff ? (
          <>
            <span className="who">{staff.name}</span>
            <SignOutButton />
          </>
        ) : (
          <Link href="/login">Staff sign in</Link>
        )}
      </nav>
    </header>
  );
}
