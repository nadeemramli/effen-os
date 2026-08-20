"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Voluntary by default (top bar). In `forced` mode it is the whole screen:
 * no cancel, no escape, no outside dismiss — used when a member is still on
 * an HQ-issued password and must replace it before reaching the app.
 *
 * The current password is always collected and sent: the project runs with
 * Secure password change on, so GoTrue rejects a bare password update with
 * current_password_required. Sending it is harmless where the setting is off.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  forced = false,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forced?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = current.length > 0 && password.length >= 10 && confirm === password;

  function reset() {
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (forced && !o) return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent
        className="max-w-sm"
        showCloseButton={!forced}
        onEscapeKeyDown={forced ? (e) => e.preventDefault() : undefined}
        onInteractOutside={forced ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            {forced ? "Set your password" : "Change password"}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? "This account still uses the password HQ issued it. Choose your own to continue — at least 10 characters, and not one that has appeared in a known breach."
              : "At least 10 characters, and not one that has appeared in a known breach. The change applies immediately to your account only."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-pw">
              {forced ? "Password HQ gave you" : "Current password"}
            </Label>
            <Input
              id="current-pw"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {tooShort && <p className="text-[11px] text-warning">Use at least 10 characters.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirm new password</Label>
            <Input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {mismatch && <p className="text-[11px] text-destructive">Passwords don&apos;t match.</p>}
          </div>
          {/* Inline as well as a toast: the actionable rejections (breached
              password, wrong current password) arrive here, and in forced mode
              a toast is the only feedback on an otherwise blocking screen. */}
          {error && (
            <p className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {!forced && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          <Button
            disabled={busy || !ready}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const { error: err } = await getSupabase().auth.updateUser({
                current_password: current,
                password,
              });
              if (err) {
                setBusy(false);
                setError(err.message);
                toast.error("Password change failed", { description: err.message });
                return;
              }
              try {
                await onChanged?.();
              } finally {
                setBusy(false);
              }
              toast.success("Password updated");
              if (!forced) {
                reset();
                onOpenChange(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
