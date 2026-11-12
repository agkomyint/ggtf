import type { Metadata } from "next";
import { LinkConsole } from "@/components/ggtf/link-console";

export const metadata: Metadata = { title: "Séance link · GGTF" };

export default function LinkPage() {
  return <LinkConsole />;
}
