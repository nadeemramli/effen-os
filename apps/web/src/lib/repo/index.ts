import type { AppStore } from "@/lib/store";
import { MockRepository } from "./mock";
import { SupabaseRepository } from "./supabase";
import type { Repository } from "./types";

/**
 * Repository factory. MockRepository is the default and the prototype never
 * requires environment variables. Supabase is only selected when explicitly
 * opted in AND configured — absence of env vars can never break the app.
 */
export function getRepository(store: AppStore): Repository {
  if (
    process.env.NEXT_PUBLIC_FULLKIT_REPO === "supabase" &&
    SupabaseRepository.isConfigured()
  ) {
    return new SupabaseRepository();
  }
  return new MockRepository(store);
}

export type { Repository } from "./types";
