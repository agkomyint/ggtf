import type { Metadata } from "next";
import { BeamConsole } from "@/components/ggtf/beam-console";

export const metadata: Metadata = { title: "Haunted QR · GGTF" };

export default function BeamPage() {
  return <BeamConsole />;
}
