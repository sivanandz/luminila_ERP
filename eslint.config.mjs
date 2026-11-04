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
    "scripts/**",
    "src/scripts/**",
    "wppconnect-sidecar/**",
    "pocketbase/**",
    "src-tauri/**",
    "scratch/**",
    // Machine-owned agent artifacts:
    ".zcode/**",
    // Nested Next.js apps' build output and scratch/example trees — the flat
    // config above replaces eslint-config-next's default ignores, so these
    // must be listed explicitly or lint scans generated chunks (thousands of
    // false errors/warnings).
    "server-dist/**",
    "storefront/.next/**",
    "storefront_example/**",
    // Separate Next.js app with its own package.json and no lint script —
    // the root lint never intended to scan it.
    "storefront/**",
    // Standalone check script (CommonJS) and draft migration scripts, same
    // convention as scripts/** above.
    "pb-check.cjs",
    "docs/migrations-draft/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          // `_`-prefixed bindings are the convention for intentionally-unused values
          "varsIgnorePattern": "^_",
          "argsIgnorePattern": "^_",
          "caughtErrors": "all",
          "caughtErrorsIgnorePattern": "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      // Downgrade the new react-hooks effect-lint rule to a warning: many
      // pre-existing effects across the codebase (including modules owned by
      // other teams) follow the synchronous-setState pattern and are tracked
      // for refactor — not something to block the build on.
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
