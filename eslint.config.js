import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

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
  prettier,
]);
