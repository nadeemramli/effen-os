"use client";

import { useRef, useState } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { Loader2, LogIn, MailCheck } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCaptchaSitekey, getSupabase } from "@/lib/supabase/client";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "magic" | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sitekey = getCaptchaSitekey();
  const { resolvedTheme } = useTheme();
  const captchaRef = useRef<HCaptcha>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaPending = sitekey !== null && captchaToken === null;

  /* hCaptcha tokens are single-use and short-lived: burn ours after every
     attempt so a retry solves a fresh challenge rather than replaying a
     spent token (which GoTrue rejects just like a missing one). */
  function resetCaptcha() {
    if (!sitekey) return;
    captchaRef.current?.resetCaptcha();
    setCaptchaToken(null);
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    const { error: err } = await getSupabase().auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaToken ?? undefined },
    });
    if (err) setError(err.message);
    resetCaptcha();
    setBusy(null);
  }

  async function sendMagicLink() {
    setBusy("magic");
    setError(null);
    const { error: err } = await getSupabase().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        captchaToken: captchaToken ?? undefined,
      },
    });
    if (err) setError(err.message);
    else setMagicSent(true);
    resetCaptcha();
    setBusy(null);
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
            {magicSent ? (
              <div className="flex flex-col items-center py-4 text-center">
                <MailCheck className="mb-2 size-7 text-success" aria-hidden />
                <p className="text-sm font-medium">Check your inbox</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  A sign-in link was sent to {email}. Membership is invite-only —
                  the link works, but only invited emails get workspace access.
                </p>
              </div>
            ) : (
              <form onSubmit={signInWithPassword} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {sitekey && (
                  <div className="flex justify-center">
                    <HCaptcha
                      ref={captchaRef}
                      sitekey={sitekey}
                      theme={resolvedTheme === "dark" ? "dark" : "light"}
                      onVerify={setCaptchaToken}
                      onExpire={() => setCaptchaToken(null)}
                      onError={() => setCaptchaToken(null)}
                    />
                  </div>
                )}
                {error && (
                  <p className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    {error}
                    {!sitekey && error.toLowerCase().includes("captcha") && (
                      <>
                        {" "}
                        This project has CAPTCHA protection enabled but no
                        sitekey is configured — set
                        NEXT_PUBLIC_SUPABASE_CAPTCHA_SITEKEY.
                      </>
                    )}
                  </p>
                )}
                <Button type="submit" className="w-full gap-1.5" disabled={busy !== null || !email || !password || captchaPending}>
                  {busy === "password" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
                  Sign in
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={busy !== null || !email || captchaPending}
                  onClick={sendMagicLink}
                >
                  {busy === "magic" && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Email me a sign-in link
                </Button>
              </form>
            )}
            <p className="mt-4 border-t pt-3 text-center text-[11px] text-muted-foreground">
              Access is invite-only. Ask your HQ admin for an invite if sign-in
              succeeds but the workspace stays locked.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
