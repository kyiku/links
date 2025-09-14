# Code Style and Conventions

## TypeScript Configuration
- **Target**: ES2022
- **Module**: ESNext with Bundler resolution
- **Strict Mode**: Enabled with all strict checks
- **Additional Checks**:
  - `noUncheckedIndexedAccess`: true (array access safety)
  - `checkJs`: true (JavaScript file checking)
  - `verbatimModuleSyntax`: true (explicit imports/exports)
- **Path Alias**: `~/*` maps to `./src/*`

## ESLint Rules
- Uses TypeScript ESLint recommended configurations
- Type-aware linting enabled
- Key rules:
  - Prefer type imports with inline style
  - Unused variables allowed with `_` prefix
  - No misused promises
  - Report unused disable directives

## Prettier Configuration
- Integrated with Tailwind CSS plugin
- Default Prettier settings apply
- Formats: `.ts`, `.tsx`, `.js`, `.jsx`, `.mdx` files

## Naming Conventions
- **Files**: 
  - React components: PascalCase (e.g., `GameCanvas.tsx`)
  - Utilities/configs: camelCase or kebab-case
  - Next.js special files: lowercase (e.g., `page.tsx`, `layout.tsx`)
- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE or PascalCase

## React/Next.js Patterns
- Using Next.js 15 App Router
- React 19 with latest features
- Server Components by default
- Client components marked with `"use client"`
- tRPC for type-safe API calls

## Database Conventions
- Prisma schema uses:
  - PascalCase for model names
  - camelCase for field names
  - Explicit indexes where needed
  - Proper relations with foreign keys