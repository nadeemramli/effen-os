"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudOff, Loader2, LogIn } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getSupabase, isAuthRequired, isSupabaseConfigured } from "@/lib/supabase/client";

type LiveState = "checking" | "unconfigured" | "signed_out" | "ready";

/**
 * Gate for LIVE-data surfaces (Setup pages). These need a real Supabase
 * session so RLS can authorize reads/writes — the demo role switcher has no
 * power here by design.
 */
export function LiveGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiveState>("checking");

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState("unconfigured");
      return;
    }
    getSupabase()
      .auth.getSession()
      .then(({ data }) => setState(data.session ? "ready" : "signed_out"));
    const { data: sub } = getSupabase().auth.onAuthStateChange((_e, session) =>
      setState(session ? "ready" : "signed_out"),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (state === "ready") return <>{children}</>;

  if (state === "checking") {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Checking session" />
      </PageBody>
    );
  }

  return (
    <PageBody className="max-w-2xl">
      <PageHeader title="Workspace setup" description="Live configuration — connects real stores and manages the real catalog." />
      <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
        {state === "unconfigured" ? (
          <>
            <CloudOff className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
            <h2 className="text-sm font-medium">Supabase is not connected in this environment</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              This page manages the live workspace (real stores, real catalog), so it needs the
              Supabase environment variables. Add the three variables from{" "}
              <code className="rounded bg-muted px-1 text-xs">apps/web/.env.example</code> to this
              deployment and redeploy. The rest of the prototype keeps running on demo data without them.
            </p>
          </>
        ) : (
          <>
            <LogIn className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
            <h2 className="text-sm font-medium">Sign in required</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              Live setup actions are authorized by your real workspace membership (HQ admin), not the
              demo role switcher.{" "}
              {isAuthRequired()
                ? "Use the sign-in screen to continue."
                : "Set NEXT_PUBLIC_FULLKIT_AUTH=required so the sign-in screen appears, then sign in with your invited email."}
            </p>
            <Link href="/command-center" className="mt-4 text-sm text-info underline-offset-2 hover:underline">
              Back to Command Centre
            </Link>
          </>
        )}
      </div>
    </PageBody>
  );
}
