import Link from "next/link";
import { Ghost } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <Ghost className="size-5 text-primary" />
          <span className="font-display text-2xl leading-none text-primary glow">GGTF</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/link" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Séance link
          </Link>
          <Link href="/lab" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Haunted lab
          </Link>
        </nav>
      </div>
    </header>
  );
}
