import Link from "next/link";
import { SITE_NAME } from "@/config";
import type { Staff } from "@/lib/auth/staff";
import HeaderNav from "./HeaderNav";

/** Masthead used on every page (full = edge to edge, for the map). */
export default function SiteHeader({ staff, full = false }: { staff: Pick<Staff, "name" | "role"> | null; full?: boolean }) {
  return (
    <header className={`masthead${full ? " full" : ""}`}>
      <div className="masthead-inner">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden />{SITE_NAME}</Link>
        <HeaderNav staff={staff ? { name: staff.name, role: staff.role } : null} />
      </div>
    </header>
  );
}
