import type { Metadata } from "next";
import { HauntConsole } from "@/components/ggtf/haunt-console";

export const metadata: Metadata = { title: "Haunted room · GGTF" };

export default function HauntPage() {
  return <HauntConsole />;
}
