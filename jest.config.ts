import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  // *.integration.test.ts also matches *.test.ts above (the glob only checks
  // the suffix), so it must be explicitly excluded here — these hit a real,
  // live tenant schema over the network and need real credentials
  // (SUPABASE_SERVICE_ROLE_KEY, .env.local), neither of which exist in CI.
  // Run them explicitly via `npm run test:integration`
  // (jest.integration.config.ts), never as part of this default suite.
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "\\.integration\\.test\\.ts$"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
};

export default config;
