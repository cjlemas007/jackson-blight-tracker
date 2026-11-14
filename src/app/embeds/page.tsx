import SiteHeader from "@/components/SiteHeader";
import EmbedBuilder from "@/components/EmbedBuilder";
import { requirePageStaff } from "@/lib/auth/session";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function EmbedsPage() {
  const staff = await requirePageStaff("contributor", "/embeds");
  const wards = await query<{ code: string; name: string }>("SELECT code, name FROM data.boundaries WHERE kind = 'ward' ORDER BY length(code), code");
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap wide">
        <h1>Embeds for stories</h1>
        <p className="muted" style={{ margin: 0 }}>Pick an embed, preview it, and paste the code into the story. Embeds update live and link back here.</p>
        <EmbedBuilder wards={wards} />
      </main>
    </div>
  );
}
