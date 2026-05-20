# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install

bun run dev      # Vite dev server with HMR
bun run build    # tsc -b && vite build → dist/
bun run lint
bun run format   # prettier --write (with prettier-plugin-tailwindcss)
bun run preview  # serve dist/ locally
```

No tests.

## Architecture

Standalone React 19 marketing site, independent of the observability platform packages.

**Pages** (`src/pages/`): `Home`, `Features`, `Solutions`, `Pricing`, `Contact` — routed via React Router v7.

**Styling**: Tailwind CSS v3 with `@tailwindcss/forms` and `autoprefixer` via PostCSS. Uses `prettier-plugin-tailwindcss` to auto-sort class names on format.

**Animations**: Framer Motion for page transitions and component reveals.

**SEO**: `react-helmet-async` manages `<head>` tags per page.

**Forms**: Zod is included for contact form validation.

This package shares no code with `remi/remi/` (the observability dashboard) or `remi-backend/`. It has its own `node_modules` and build pipeline.
