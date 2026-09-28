import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  { ignores: ["dist/", "coverage/", "playwright-report/", "test-results/"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `const { version, ...content } = snapshot` discards version on purpose
      // (suppression compares everything except it). That rest sibling is not unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Architecture guard: wire types in src/shared must stay dependency-free of
    // the server and web layers, so both can safely import them. Checked by the
    // linter rather than by memory.
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/**", "**/web/**"],
              message:
                "src/shared must not import from src/server or src/web (keep the wire types dependency-free).",
            },
          ],
        },
      ],
    },
  },
  {
    // The browser client has its own tsconfig (DOM types, bundler resolution,
    // no Node types). The project service only discovers files named
    // tsconfig.json, so point the parser at it explicitly.
    files: ["src/web/**/*.{ts,tsx}"],
    // These run in Node and belong to the root (Node) project: Vite's config,
    // and the tests that read web assets from disk, with their helpers.
    ignores: [
      "src/web/vite.config.ts",
      "src/web/**/*.node.test.ts",
      "src/web/**/*.node.ts",
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: false,
        project: ["./tsconfig.web.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ["src/web/**/*.{ts,tsx}"], ...reactHooks.configs.flat.recommended },
  {
    // Architecture guards for the client: it talks to the server only over
    // HTTP and the wire protocol in src/shared, never by importing server
    // code; and it may import only types from shared/protocol, which builds
    // Zod schemas as it loads and would put Zod in the browser bundle.
    files: ["src/web/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/**"],
              message:
                "src/web must not import from src/server; share types through src/shared.",
            },
            {
              // Both forms: bundler resolution also accepts the bare path.
              group: ["**/shared/protocol", "**/shared/protocol.js"],
              allowTypeImports: true,
              message:
                "Import only types from shared/protocol (it loads Zod); runtime values such as socketPath live in shared/socket.",
            },
          ],
        },
      ],
    },
  },
  {
    // Classic scripts served as is from Vite's public directory, such as the
    // blocking no-flash theme script: browser globals, script mode, and no
    // type information, since no tsconfig covers them.
    files: ["src/web/public/**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.browser,
      sourceType: "script",
      parserOptions: { projectService: false, project: null },
    },
  },
  {
    // Build and check scripts run in Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
