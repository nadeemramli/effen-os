"use client";

import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-w-[1024px] overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
