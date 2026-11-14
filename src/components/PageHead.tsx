/** Kicker + serif headline + dek, the opening of every public page. */
export default function PageHead({ kicker, title, dek, children }: { kicker?: string; title: string; dek?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="pagehead">
      {kicker && <div className="kicker">{kicker}</div>}
      <h1>{title}</h1>
      {dek && <p className="dek">{dek}</p>}
      {children}
    </div>
  );
}
