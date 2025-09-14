# Progate Project Links - Project Overview

## Purpose
This is a T3 Stack application with a 2D vertical scrolling shooter game demo. The project includes:
- A web application built with Next.js 15
- Game demo at `/game` path with Canvas-based 2D shooter
- User authentication via NextAuth.js
- Database integration with Prisma ORM (SQLite)
- Type-safe API with tRPC

## Tech Stack
- **Framework**: Next.js 15.2.3 (with App Router)
- **Language**: TypeScript 5.8.2
- **React**: React 19.0.0
- **Database**: Prisma 6.5.0 with SQLite
- **Authentication**: NextAuth.js 5.0.0-beta
- **API**: tRPC 11.0.0
- **Styling**: Tailwind CSS 4.0.15
- **State Management**: TanStack React Query 5.69.0
- **Build Tool**: Next.js with Turbo mode

## Project Structure
```
/
├── prisma/           # Database schema and migrations
├── public/           # Static assets
│   └── maps/        # Game map images
├── src/
│   ├── app/         # Next.js App Router pages
│   │   ├── api/     # API routes
│   │   ├── game/    # Game demo components
│   │   └── _components/
│   ├── server/      # Server-side code
│   ├── trpc/        # tRPC configuration
│   └── styles/      # Global styles
└── Configuration files (tsconfig, eslint, prettier, etc.)
```

## Game Features
- Path: `/game`
- Controls: W/A/S/D for movement, Space to shoot
- Background: Uses map screenshots from `public/maps/map1.jpg` or `map1.png`
- Data persistence: Game results recorded via tRPC/Prisma in the `Run` table
- Recent features:
  - Camera viewport with image cropping
  - Serpentine route following via tRPC
  - Map router for route generation
  - Vertical scrolling with climbing effect