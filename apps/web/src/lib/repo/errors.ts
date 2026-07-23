export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(
      `${what} requires a configured Supabase project. ` +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
        "and set NEXT_PUBLIC_FULLKIT_REPO=supabase. The prototype runs on " +
        "MockRepository by default and never requires these variables.",
    );
    this.name = "NotConfiguredError";
  }
}
