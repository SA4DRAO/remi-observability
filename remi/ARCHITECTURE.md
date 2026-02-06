# Project Structure & Best Practices

## Architecture Overview

This is a production-ready React + TypeScript application with a modern, scalable architecture designed for cloud deployment.

### Folder Structure

```
src/
├── components/          # React components (UI building blocks)
│   ├── Chat/           # ChatDisplay component
│   ├── Input/          # ChatInput component
│   └── PageSelector/   # PageSelector component
├── hooks/              # Custom React hooks
│   ├── useChat.ts      # Chat state management
│   └── usePages.ts     # Pages fetching logic
├── services/           # Business logic & API calls
│   └── agent-service.ts # Agent API integration
├── types/              # TypeScript interfaces
│   ├── agent.ts        # Domain types
│   └── index.ts        # Type exports
├── utils/              # Utility functions
│   ├── api-client.ts   # HTTP client with error handling
│   └── logger.ts       # Structured logging
├── config/             # Configuration management
│   └── env.ts          # Environment variables
├── context/            # React context providers (for future use)
├── assets/             # Static images, fonts, etc.
├── App.tsx             # Root component
├── main.tsx            # Entry point
├── App.css             # App styles
└── index.css           # Global styles
```

## Best Practices Implemented

### 1. **Separation of Concerns**
- **Components**: UI rendering only
- **Services**: Business logic and API calls
- **Hooks**: State management and side effects
- **Utils**: Reusable functions
- **Types**: Centralized type definitions

### 2. **State Management**
- Custom hooks (`useChat`, `usePages`) for component-level state
- Services for API coordination
- Ready for Redux/Zustand if needed

### 3. **Error Handling**
- Centralized error handling in API client
- Try-catch blocks in services
- User-friendly error messages
- Logging utility for debugging

### 4. **Configuration Management**
- Environment-based config
- `.env` files for different environments
- Type-safe config access via `config` object

### 5. **TypeScript**
- Strong typing throughout
- Centralized type definitions
- Interface segregation

### 6. **Code Organization**
- Single Responsibility Principle
- DRY (Don't Repeat Yourself)
- Modular and testable code

### 7. **Cloud-Ready Features**
- Docker containerization
- Environment-based configuration
- Health checks built-in
- Graceful error handling
- Structured logging
- Kubernetes manifests
- CI/CD pipeline

## Dependency Management

### Core Dependencies
- **react** (19.2.0): UI library
- **@formkit/auto-animate**: Smooth animations

### Dev Dependencies
- **TypeScript** (5.9.3): Type safety
- **Vite** (7.2.4): Build tool
- **ESLint**: Code linting
- **React ESLint Plugins**: React-specific linting rules

## Development Workflow

### Starting Development
```bash
# Install dependencies
npm install

# Start dev server (with hot reload)
npm run dev

# Open http://localhost:5173
```

### Building for Production
```bash
# Build optimized bundle
npm run build

# Preview production build
npm run preview
```

### Code Quality
```bash
# Run linter
npm run lint
```

## Adding New Features

### Adding a New Component
1. Create folder: `src/components/MyComponent/`
2. Create files:
   - `MyComponent.tsx`: Component logic
   - `MyComponent.css`: Component styles
3. Export from components folder
4. Import in parent component

### Adding a New Service
1. Create file: `src/services/my-service.ts`
2. Define functions for API calls
3. Use `apiClient` for HTTP requests
4. Export functions as service object
5. Use in hooks or components

### Adding a New Hook
1. Create file: `src/hooks/useMyHook.ts`
2. Implement hook logic
3. Use services and utilities
4. Export hook
5. Use in components

## Testing Strategy (Recommended)

```bash
# Add testing libraries
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom

# Create test files alongside source
src/components/Chat/__tests__/ChatDisplay.test.tsx
src/services/__tests__/agent-service.test.ts
src/hooks/__tests__/useChat.test.ts
```

## Performance Optimization

1. **Code Splitting**: Vite handles this automatically
2. **Lazy Loading**: React.lazy() for route-based components
3. **Memoization**: React.memo() for expensive components
4. **Image Optimization**: Serve via CDN in production
5. **Bundle Analysis**: `vite-plugin-visualizer` for bundle size

## Security Considerations

1. **API Key Management**: Keep in backend, not frontend
2. **HTTPS Only**: Use HTTPS in production
3. **CORS Configuration**: Whitelist allowed origins
4. **Input Validation**: Validate user input
5. **XSS Prevention**: React sanitizes by default
6. **Environment Variables**: Never commit secrets

## Documentation

- Add JSDoc comments to complex functions
- Keep README.md updated with setup instructions
- Document API integration changes
- Comment on non-obvious logic

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/add-new-feature

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/add-new-feature
```

## Future Improvements

1. Add unit tests with Vitest
2. Add E2E tests with Cypress
3. Implement error boundary components
4. Add state management (Redux/Zustand)
5. Add service worker for offline support
6. Implement analytics
7. Add accessibility (a11y) improvements
8. Add internationalization (i18n)
