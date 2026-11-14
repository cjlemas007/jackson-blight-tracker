import SiteHeader from "@/components/SiteHeader";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

const safeNext = (n: string | undefined) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/submit");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="page">
      <SiteHeader staff={null} />
      <main className="wrap" style={{ maxWidth: 420 }}>
        <h1>Staff sign in</h1>
        <p className="muted" style={{ margin: 0 }}>For newsroom staff submitting and reviewing photos. The map is public.</p>
        <LoginForm next={safeNext(next)} />
      </main>
    </div>
  );
}
