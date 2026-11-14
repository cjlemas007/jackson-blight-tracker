"use client";
import dynamic from "next/dynamic";

const AreaMap = dynamic(() => import("./AreaMap"), { ssr: false, loading: () => <div className="area-map" /> });

export default function AreaMapClient({ kind }: { kind: string }) {
  return <AreaMap kind={kind} />;
}
