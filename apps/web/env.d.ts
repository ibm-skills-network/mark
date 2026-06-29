declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production" | "test";
    NEXT_PUBLIC_API_URL?: string;
    // APP_ENV (server-only, no NEXT_PUBLIC_ prefix) gates per-environment
    // server-side behavior like the Instana Real-User-Monitoring key in
    // app/layout.tsx. Set by the deploy overlay; "development" locally.
    APP_ENV?: "development" | "staging" | "production" | "test";
    PORT?: string;
    // Master on/off switch for the learner promo banners (server-only, no
    // NEXT_PUBLIC_ prefix so it can vary per environment from a single image).
    // Read in app/learner/layout.tsx; banner content lives in config/promo.ts.
    PROMO_BANNERS_ENABLED?: "true" | "false";
  }
}
