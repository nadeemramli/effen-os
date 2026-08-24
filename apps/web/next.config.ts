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
  /* config options here */
};

export default nextConfig;
