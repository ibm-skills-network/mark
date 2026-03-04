declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production" | "test";
    NEXT_PUBLIC_API_URL?: string;
    NEXT_PUBLIC_APP_ENV?: "development" | "staging" | "production" | "test";
    PORT?: string;
  }
}
