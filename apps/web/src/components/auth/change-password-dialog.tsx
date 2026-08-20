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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (forced && !o) return;
        onOpenChange(o);
        if (!o) { setPassword(""); setConfirm(""); }
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
              ? "This account still uses the password HQ issued it. Choose your own to continue — at least 10 characters."
              : "At least 10 characters. The change applies immediately to your account only."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
        </div>
        <DialogFooter>
          {!forced && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          <Button
            disabled={busy || password.length < 10 || confirm !== password}
            onClick={async () => {
              setBusy(true);
              const { error } = await getSupabase().auth.updateUser({ password });
              if (error) {
                setBusy(false);
                toast.error("Password change failed", { description: error.message });
                return;
              }
              try {
                await onChanged?.();
              } finally {
                setBusy(false);
              }
              toast.success("Password updated");
              if (!forced) onOpenChange(false);
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
