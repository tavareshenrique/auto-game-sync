# Agent Instructions

This document outlines guidelines and mandatory steps that agentic AI assistants must follow when working on this repository.

## Verification Protocol

To maintain codebase health and prevent regressions, you **must** run the following verification steps whenever you complete a task, fix a bug, or make changes:

1. **Linting Check**: Validate project code style and formatting using:
   ```bash
   pnpm run lint
   ```
2. **Formatting Check**: Verify that all files adhere to Prettier rules:
   ```bash
   pnpm run format:check
   ```
3. **TypeScript Typecheck**: Ensure there are no compilation or type errors:
   ```bash
   pnpm run typecheck
   ```
4. **Test Suite**: Run the automated test suite to ensure functionality remains correct:
   ```bash
   pnpm run test
   ```

Always resolve any errors, warnings, or format check failures before submitting or opening a Pull Request.
