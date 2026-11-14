"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setTheme, useTheme } from "@/lib/theme";

const PUBLIC = [
  { href: "/", label: "Map" },
  { href: "/owners", label: "Owners" },
  { href: "/streets", label: "Streets" },
  { href: "/areas", label: "Areas" },
  { href: "/city", label: "City response" },
  { href: "/methodology", label: "How this works" },
];
const REPORTING = [
  { href: "/submit", label: "Submit a property" },
  { href: "/verify", label: "Needs a check" },
  { href: "/survey", label: "Survey mode" },
  { href: "/my", label: "My submissions" },
  { href: "/embeds", label: "Embeds for stories" },
];
const ADMIN = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin", label: "Review queue" },
  { href: "/admin/city", label: "City actions" },
  { href: "/admin/corrections", label: "Corrections" },
  { href: "/admin/staff", label: "Staff accounts" },
];

export default function HeaderNav({ staff }: { staff: { name: string; role: string } | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const current = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <>
      <ThemeToggle />
      <button type="button" className="menu-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}
      </button>
      <nav className={open ? "open" : undefined} aria-label="Main">
        {PUBLIC.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>{l.label}</Link>
        ))}
        <span className="spacer" />
        {staff ? (
          <div className={`staffmenu${menu ? " open" : ""}`} ref={menuRef}>
            <button type="button" className="navlink" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Staff</button>
            <div className="menu">
              <div className="grp">Reporting</div>
              {REPORTING.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
              {staff.role === "admin" && (
                <>
                  <hr />
                  <div className="grp">Admin</div>
                  {ADMIN.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
                </>
              )}
              <hr />
              <span className="who">Signed in as {staff.name}</span>
              <Link href="/account/password">Change password</Link>
              <a href="#" onClick={async (e) => { e.preventDefault(); await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }}>Sign out</a>
            </div>
          </div>
        ) : (
          <Link href="/login" aria-current={current("/login") ? "page" : undefined}>Staff sign in</Link>
        )}
      </nav>
    </>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
