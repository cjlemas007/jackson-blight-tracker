"use client";
import dynamic from "next/dynamic";
const EmbedMap = dynamic(() => import("./EmbedMap"), { ssr: false });
export default EmbedMap;
