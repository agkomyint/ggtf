import type { Metadata } from "next";
import { SeanceOS } from "@/components/seance/seance-os";

export const metadata: Metadata = { title: "Séance OS · GGTF" };

export default function SeancePage() {
  return <SeanceOS />;
}
