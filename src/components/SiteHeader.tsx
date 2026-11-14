import Link from "next/link";
import { SITE_NAME } from "@/config";
import type { Staff } from "@/lib/auth/staff";
import SignOutButton from "./SignOutButton";
import MobileNav from "./MobileNav";

export default function SiteHeader({ staff }: { staff: Staff | null }) {
  return (
    <header className="topbar">
      <Link href="/" style={{ fontWeight: 700, fontSize: 17, opacity: 1 }}>{SITE_NAME}</Link>
      <span className="spacer" />
      <MobileNav>
        <Link href="/">Map</Link>
        <Link href="/owners">Owners</Link>
        <Link href="/streets">Streets</Link>
        <Link href="/areas">Areas</Link>
        <Link href="/city">City response</Link>
        <Link href="/methodology">How this works</Link>
        {staff && <Link href="/submit">Submit</Link>}
        {staff && <Link href="/verify">Needs a check</Link>}
        {staff && <Link href="/survey">Survey</Link>}
        {staff && <Link href="/embeds">Embeds</Link>}
        {staff && <Link href="/my">My submissions</Link>}
        {staff?.role === "admin" && <Link href="/admin/dashboard">Dashboard</Link>}
        {staff?.role === "admin" && <Link href="/admin">Review queue</Link>}
        {staff?.role === "admin" && <Link href="/admin/city">City actions</Link>}
        {staff?.role === "admin" && <Link href="/admin/corrections">Corrections</Link>}
        {staff?.role === "admin" && <Link href="/admin/staff">Staff</Link>}
        {staff ? (
          <>
            <span className="who">{staff.name}</span>
            <SignOutButton />
          </>
        ) : (
          <Link href="/login">Staff sign in</Link>
        )}
      </MobileNav>
    </header>
  );
}
