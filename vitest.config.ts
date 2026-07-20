import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    passWithNoTests: true,
    exclude: ["**/dist/**", "**/node_modules/**", "**/.claude/worktrees/**"],
  },
});
