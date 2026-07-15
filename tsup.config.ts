import { defineConfig } from "tsup";

export default defineConfig([
  // For bundlers: readable ESM/CJS, left unminified on purpose — the
  // consumer's bundler minifies to its own targets, and unminified source
  // keeps their stack traces and debugging usable.
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  // For a plain <script> tag: minified IIFE exposing window.CalendarDigest,
  // for pages with no build step.
  {
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "CalendarDigest",
    minify: true,
    sourcemap: false,
    clean: false,
  },
]);
