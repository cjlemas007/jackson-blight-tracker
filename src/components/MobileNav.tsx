"use client";

import { useState } from "react";

/** Header nav that collapses behind a Menu button on phones (survey mode needs the screen). */
export default function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="menu-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}
      </button>
      <nav className={open ? "open" : undefined} onClick={(e) => (e.target as HTMLElement).tagName === "A" && setOpen(false)}>
        {children}
      </nav>
    </>
  );
}
