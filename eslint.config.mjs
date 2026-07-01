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
    // Dead reference source — decoded/extracted from the Claude Design HTML
    // exports, ported FROM (see comments throughout components/dashboard/),
    // never imported by the live app and never built. See CLAUDE.md's
    // "Prototype source" reference note.
    "prototype-src/**",
    "outputs/**",
  ]),
]);

export default eslintConfig;
