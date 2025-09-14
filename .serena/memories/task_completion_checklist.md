# Task Completion Checklist

When completing any coding task in this project, always run these commands:

## Required Checks (in order)
1. **Type checking**: `npm run typecheck`
   - Ensures no TypeScript errors
   - Must pass before proceeding

2. **Linting**: `npm run lint`
   - Checks for ESLint violations
   - Fix automatically with `npm run lint:fix` if needed

3. **Format check**: `npm run format:check`
   - Verifies Prettier formatting
   - Fix with `npm run format:write` if needed

4. **Combined check**: `npm run check`
   - Runs both lint and typecheck
   - Use this as final verification

## Additional Checks (as needed)
- If database schema changed: `npm run db:generate`
- If adding new dependencies: `npm install`
- Before committing: Review changes with `git diff`

## Quick Command
For comprehensive validation, run:
```bash
npm run check && npm run format:check
```

This ensures code quality, type safety, and consistent formatting.