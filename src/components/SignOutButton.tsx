"use client";

export default function SignOutButton() {
  return (
    <button
      className="linkbtn"
      style={{ fontSize: 14 }}
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
