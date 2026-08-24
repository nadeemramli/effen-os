import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (publishable key only — every table is behind RLS).
 *
 * Auth activates ONLY when all three are true:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY are set, and
 *   NEXT_PUBLIC_FULLKIT_AUTH=required.
 * Without them the app runs exactly as before: open, on mock data. This keeps
 * the zero-env-var prototype promise and makes enabling auth an explicit,
 * reversible deployment decision.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function isAuthRequired(): boolean {
  return isSupabaseConfigured() && process.env.NEXT_PUBLIC_FULLKIT_AUTH === "required";
}

/**
 * Demo mode — the reviewer-facing deployment.
 *
 * Set NEXT_PUBLIC_FULLKIT_MODE=demo on a build that has NO Supabase
 * variables at all. The seed then stands in for every live read, the seed
 * epoch rolls forward so the dataset always ends today, and real business
 * names are swapped for demo ones before anything is rendered.
 *
 * next.config.ts refuses to build if this is set alongside a Supabase URL,
 * so a demo deployment cannot silently acquire production credentials.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_FULLKIT_MODE === "demo";
}

/**
 * hCaptcha sitekey. Set this whenever the project has CAPTCHA protection
 * enabled (Auth > Bot and Abuse Protection) — GoTrue then rejects every
 * sign-in that arrives without a captcha token, before it looks at the
 * password. The sitekey is public by design; the paired secret lives only in
 * Supabase's auth config.
 */
export function getCaptchaSitekey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_CAPTCHA_SITEKEY || null;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured — check isSupabaseConfigured() before calling.");
  }
  if (!client) {
    client = createClient(url!, anonKey!);
  }
  return client;
}

export interface MembershipRow {
  workspace_id: number;
  role_key: string;
  status: string;
}

export interface PreferencesRow {
  user_id: string;
  workspace_id: number;
  theme: "dark" | "light";
  default_brand_slug: string | null;
  default_date_range: "today" | "7d" | "30d" | "90d" | "1y";
}

export interface ProfileRow {
  display_name: string;
  password_change_required: boolean;
}
