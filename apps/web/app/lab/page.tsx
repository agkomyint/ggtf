import type { Metadata } from "next";
import { Lab } from "@/components/ggtf/lab";

export const metadata: Metadata = { title: "Haunted lab · GGTF" };

export default function LabPage() {
  return <Lab />;
}
