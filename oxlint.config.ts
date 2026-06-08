import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  options: { typeAware: true },
  rules: {
    "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    "no-eq-null": "off",
    "promise/avoid-new": "off",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/strict-boolean-expressions": "off",
    "unicorn/prefer-event-target": "off",
  },
});
