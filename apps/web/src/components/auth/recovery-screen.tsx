"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Whole-screen "choose a new password" step shown by AuthGate after a
 * password-reset link has been opened. The link signs the member in with a
 * recovery session, so `updateUser({ password })` is allowed without the
 * current password (which is exactly what they no longer know).
 *
 * On success the first-login gate flag on public.profiles is cleared too: a
 * member who forgot an HQ-issued password and reset it by email has now set
 * their own, and the forced change-password dialog would otherwise demand
 * the HQ password they never had.
 */
export function RecoveryScreen({
  email,
  onDone,
}: {
  email: string | null;
  onDone: () => void | Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 10 && confirm === password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const { data, error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      const needsReauth =
        err.code === "reauthentication_needed" ||
        /current password|reauthenticat/i.test(err.message);
      setError(
        needsReauth
          ? "This reset link can no longer be used to set a password. Request a fresh link from the sign-in page, or ask an HQ admin to reissue your access."
          : err.message,
      );
      setBusy(false);
      return;
    }
    const userId = data.user?.id;
    if (userId) {
      const { error: flagErr } = await supabase
        .from("profiles")
        .update({ password_change_required: false })
        .eq("id", userId);
      if (flagErr) console.warn("Could not clear first-login gate:", flagErr.message);
    }
    toast.success("Password updated", { description: "You are signed in with your new password." });
    try {
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-base font-semibold">F</span>
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Fullkit</div>
            <div className="text-xs text-muted-foreground">EFFEN International Sdn Bhd</div>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <KeyRound className="size-4" aria-hidden />
                  Choose a new password
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {email ? `Setting a new password for ${email}. ` : ""}
                  At least 10 characters, and not one that has appeared in a
                  known breach.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recovery-pw">New password</Label>
                <Input
                  id="recovery-pw"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                />
                {tooShort && <p className="text-[11px] text-warning">Use at least 10 characters.</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recovery-confirm">Confirm new password</Label>
                <Input
                  id="recovery-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
                {mismatch && <p className="text-[11px] text-destructive">Passwords don&apos;t match.</p>}
              </div>
              {error && (
                <p className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full gap-1.5" disabled={busy || !ready}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
                Set password and continue
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => void getSupabase().auth.signOut()}
              >
                Cancel and sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
