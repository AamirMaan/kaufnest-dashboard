import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Other git worktrees (e.g. .worktrees/<branch>/) are full parallel
    // checkouts with their own .next build output — the patterns above only
    // match at the repo root, not nested inside a worktree directory.
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
