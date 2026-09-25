import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  { ignores: ["dist/", "coverage/"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
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
    // Vite's config runs in Node and belongs to the root (Node) project.
    ignores: ["src/web/vite.config.ts"],
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
    // Architecture guard: the client talks to the server only over HTTP and
    // the wire protocol in src/shared, never by importing server code.
    files: ["src/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/**"],
              message:
                "src/web must not import from src/server; share types through src/shared.",
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
