declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production" | "test";
    NEXT_PUBLIC_API_URL?: string;
    // APP_ENV (server-only, no NEXT_PUBLIC_ prefix) gates per-environment
    // server-side behavior like the Instana Real-User-Monitoring key in
    // app/layout.tsx. Set by the deploy overlay; "development" locally.
    APP_ENV?: "development" | "staging" | "production" | "test";
    PORT?: string;
  }
}
