# Development Commands

## Development
- `npm run dev` - Start development server with Turbo mode
- `npm run preview` - Build and preview production build
- `npm start` - Start production server
- `npm run build` - Build for production

## Code Quality & Testing
- `npm run check` - Run both linting and type checking
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run typecheck` - Run TypeScript type checking
- `npm run format:check` - Check code formatting with Prettier
- `npm run format:write` - Format code with Prettier

## Database Commands
- `npm run db:generate` - Generate Prisma client and run migrations (dev)
- `npm run db:migrate` - Deploy database migrations
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Prisma Studio GUI

## System Commands (macOS/Darwin)
- `git status` - Check git status
- `git diff` - View changes
- `git add .` - Stage all changes
- `git commit -m "message"` - Commit changes
- `ls -la` - List files with details
- `find . -name "*.ts"` - Find TypeScript files
- `grep -r "pattern" .` - Search for pattern in files

## Important Notes
- Always run `npm run check` before committing to ensure code quality
- The project uses strict TypeScript settings with `noUncheckedIndexedAccess`
- ESLint and Prettier are configured and should be used consistently