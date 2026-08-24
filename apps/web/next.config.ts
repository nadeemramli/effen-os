import type { NextConfig } from "next";

/**
 * Demo builds must never carry production credentials.
 *
 * NEXT_PUBLIC_FULLKIT_MODE=demo means "the seed stands in for every live
 * read". If a Supabase URL is also present, isSupabaseConfigured() turns
 * true, LiveGuard takes its real path, and the reviewer-facing deployment
 * quietly starts talking to the production project. That failure is silent
 * and would not surface until someone inspected network traffic — so fail
 * the build instead.
 */
if (process.env.NEXT_PUBLIC_FULLKIT_MODE === "demo" && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error(
    "Refusing to build: NEXT_PUBLIC_FULLKIT_MODE=demo is set alongside " +
      "NEXT_PUBLIC_SUPABASE_URL. The demo deployment must have no Supabase " +
      "environment variables at all. Remove them from this project's settings.",
  );
}

const nextConfig: NextConfig = {
  /**
   * Configuration and evidence surfaces moved under /settings. These keep
   * existing bookmarks, notification links, and anything already pasted into
   * a chat working. Permanent (308) because the move is deliberate — if that
   * ever needs undoing, remember browsers cache 308s hard.
   *
   * Ordering matters: the bare /setup entry must precede the wildcard, or
   * the wildcard swallows it and produces /settings/setup with no page.
   */
  async redirects() {
    return [
      { source: "/integrations", destination: "/settings/integrations", permanent: true },
      { source: "/integrations/:id", destination: "/settings/integrations/:id", permanent: true },
      { source: "/data-health", destination: "/settings/data-health", permanent: true },
      { source: "/automations", destination: "/settings/automations", permanent: true },
      { source: "/audit", destination: "/settings/audit", permanent: true },
      { source: "/setup", destination: "/settings/setup/connections", permanent: true },
      { source: "/setup/:path*", destination: "/settings/setup/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
