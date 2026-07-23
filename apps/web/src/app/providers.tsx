"use client";

import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider } from "@/lib/store/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <StoreProvider>
        <NuqsAdapter>
          <TooltipProvider delayDuration={200}>
            <Suspense>{children}</Suspense>
          </TooltipProvider>
        </NuqsAdapter>
        <Toaster position="bottom-right" />
      </StoreProvider>
    </ThemeProvider>
  );
}
