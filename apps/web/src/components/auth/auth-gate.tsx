"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RoleKey } from "@/lib/domain/enums";
import { ROLE_KEYS } from "@/lib/domain/enums";
import { useAppStore } from "@/lib/store/provider";
import {
  getSupabase,
  isAuthRequired,
  type MembershipRow,
  type PreferencesRow,
} from "@/lib/supabase/client";
import { LoginScreen } from "./login-screen";

type GateState = "loading" | "signed_out" | "no_membership" | "ready";

/**
 * Slice-1 auth gate. Inactive (renders children directly) unless
 * NEXT_PUBLIC_FULLKIT_AUTH=required and Supabase is configured — the open
 * demo behaviour is the default and enabling auth is an explicit decision.
 *
 * When active: requires a session, resolves the workspace membership
 * (invite-only — no membership means no access), locks the role for
 * non-admins, and syncs brand/date-range preferences to user_preferences.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const active = isAuthRequired();
  const [state, setState] = useState<GateState>(active ? "loading" : "ready");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const setAuthSession = useAppStore((s) => s.setAuthSession);
  const setBrand = useAppStore((s) => s.setBrand);
  const setDateRange = useAppStore((s) => s.setDateRange);
  const brands = useAppStore((s) => s.brands);
  const brandId = useAppStore((s) => s.session.brandId);
  const dateRange = useAppStore((s) => s.session.dateRange);

  const workspaceIdRef = useRef<number | null>(null);
  const userIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const supabase = getSupabase();

    async function resolve(userId: string, email: string | null) {
      setUserEmail(email);
      const { data: memberships } = await supabase
        .from("memberships")
        .select("workspace_id, role_key, status")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1);
      const membership = (memberships?.[0] as MembershipRow | undefined) ?? null;
      if (!membership) {
        setAuthSession({ email });
        setState("no_membership");
        return;
      }
      workspaceIdRef.current = membership.workspace_id;
      userIdRef.current = userId;
      const role = (ROLE_KEYS as readonly string[]).includes(membership.role_key)
        ? (membership.role_key as RoleKey)
        : "analyst";
      setAuthSession({ email, role, roleLocked: role !== "hq_admin" });

      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", userId)
        .eq("workspace_id", membership.workspace_id)
        .maybeSingle<PreferencesRow>();
      if (prefs) {
        if (prefs.default_date_range) setDateRange(prefs.default_date_range);
        if (prefs.default_brand_slug) {
          const brand = brands.find((b) => b.slug === prefs.default_brand_slug);
          setBrand(brand ? brand.id : "all");
        }
      }
      hydratedRef.current = true;
      setState("ready");
    }

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (session?.user) void resolve(session.user.id, session.user.email ?? null);
      else setState("signed_out");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        void resolve(session.user.id, session.user.email ?? null);
      }
      if (event === "SIGNED_OUT") {
        hydratedRef.current = false;
        setAuthSession({ email: null, roleLocked: false });
        setState("signed_out");
      }
    });
    return () => sub.subscription.unsubscribe();
    // brands is seed-stable; setters are stable store references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* Persist brand/date-range preferences after initial hydration. */
  useEffect(() => {
    if (!active || !hydratedRef.current || state !== "ready") return;
    const workspaceId = workspaceIdRef.current;
    const userId = userIdRef.current;
    if (!workspaceId || !userId) return;
    const slug = brandId === "all" ? null : brands.find((b) => b.id === brandId)?.slug ?? null;
    const t = setTimeout(() => {
      void getSupabase()
        .from("user_preferences")
        .upsert({
          user_id: userId,
          workspace_id: workspaceId,
          default_brand_slug: slug,
          default_date_range: dateRange,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.warn("Preference sync failed:", error.message);
        });
    }, 600);
    return () => clearTimeout(t);
  }, [active, state, brandId, dateRange, brands]);

  if (!active || state === "ready") return <>{children}</>;

  if (state === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background" role="status" aria-label="Checking session">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (state === "no_membership") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6 text-center">
        <ShieldOff className="mb-3 size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-base font-semibold">No workspace membership</h1>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {userEmail ?? "This account"} authenticated, but Fullkit is invite-only and this email has
          no membership in EFFEN International Sdn Bhd. Ask the HQ admin to add an invite, then sign in again.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void getSupabase().auth.signOut()}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return <LoginScreen />;
}
