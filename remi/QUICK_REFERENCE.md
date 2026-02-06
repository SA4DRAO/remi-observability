# Quick Reference Guide

## Directory Tree

```
remi/
├── src/
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatDisplay.tsx
│   │   │   └── ChatDisplay.css
│   │   ├── Input/
│   │   │   ├── ChatInput.tsx
│   │   │   └── ChatInput.css
│   │   └── PageSelector/
│   │       ├── PageSelector.tsx
│   │       └── PageSelector.css
│   ├── services/
│   │   └── agent-service.ts
│   ├── hooks/
│   │   ├── useChat.ts
│   │   └── usePages.ts
│   ├── types/
│   │   ├── agent.ts
│   │   └── index.ts
│   ├── utils/
│   │   ├── api-client.ts
│   │   └── logger.ts
│   ├── config/
│   │   └── env.ts
│   ├── context/ (for future use)
│   ├── App.tsx
│   ├── main.tsx
│   ├── App.css
│   └── index.css
├── public/
├── .github/workflows/
│   └── deploy.yml
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── k8s-deployment.yaml
├── .env.example
├── .env.development
├── .env.production
├── .gitignore
├── package.json
├── vite.config.ts
├── tsconfig.json
├── eslint.config.js
├── README_NEW.md
├── ARCHITECTURE.md
├── DEPLOYMENT.md
└── RESTRUCTURING_SUMMARY.md
```

## Command Reference

### Development
```bash
npm install              # Install dependencies
npm run dev             # Start dev server (port 5173)
npm run build           # Production build
npm run preview         # Preview build locally
npm run lint            # Check code quality
npm run lint:fix        # Fix linting issues
npm run type-check      # TypeScript check
```

### Docker
```bash
npm run docker:build    # Build image
npm run docker:run      # Run container (port 3000)
docker-compose up       # Full dev stack
```

### Kubernetes
```bash
kubectl apply -f k8s-deployment.yaml
kubectl get pods -l app=remi
kubectl logs deployment/remi-frontend
```

## Architecture at a Glance

```
┌─────────────────────────────────────────┐
│  User Interface (Components)             │
│  ├── ChatDisplay                         │
│  ├── ChatInput                          │
│  └── PageSelector                       │
└──────────────┬──────────────────────────┘
               │ uses
┌──────────────▼──────────────────────────┐
│  Custom Hooks (State Management)        │
│  ├── useChat                            │
│  └── usePages                           │
└──────────────┬──────────────────────────┘
               │ calls
┌──────────────▼──────────────────────────┐
│  Services (Business Logic)               │
│  └── agent-service.ts                   │
└──────────────┬──────────────────────────┘
               │ uses
┌──────────────▼──────────────────────────┐
│  Utilities (Infrastructure)             │
│  ├── api-client.ts (HTTP)               │
│  └── logger.ts (Logging)                │
└──────────────┬──────────────────────────┘
               │ reads from
┌──────────────▼──────────────────────────┐
│  Configuration                          │
│  └── env.ts (Environment vars)          │
└─────────────────────────────────────────┘
```

## Environment Variables

### Development
```
VITE_API_URL=http://localhost:3100
VITE_ENV=development
VITE_ENABLE_DEBUG=true
```

### Production
```
VITE_API_URL=https://api.example.com
VITE_ENV=production
VITE_ENABLE_DEBUG=false
```

## Cloud Deployment Matrix

| Platform | Config File | Command |
|----------|------------|---------|
| **Local** | docker-compose.yml | `docker-compose up` |
| **Docker** | Dockerfile | `docker build & run` |
| **Kubernetes** | k8s-deployment.yaml | `kubectl apply` |
| **AWS ECS** | Dockerfile | Push to ECR |
| **Google Cloud Run** | Dockerfile | `gcloud run deploy` |
| **Azure ACI** | Dockerfile | `az container create` |
| **Heroku** | Dockerfile | `git push heroku` |

## Key Files Explained

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component, orchestrates everything |
| `src/config/env.ts` | Environment variables (centralized) |
| `src/utils/api-client.ts` | HTTP requests with error handling |
| `src/services/agent-service.ts` | API calls for agent functionality |
| `src/hooks/useChat.ts` | Chat state and logic |
| `Dockerfile` | Container image definition |
| `k8s-deployment.yaml` | Kubernetes deployment config |
| `.github/workflows/deploy.yml` | CI/CD automation |

## Type System

```typescript
// Main types (src/types/agent.ts)
interface AgentResponse {
  success: boolean;
  reply: string;
  actionsLog: string[];
  sessionId: string;
  pageId: string;
  actionCount: number;
  currentUrl: string;
  error?: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "agent";
  content: string;
  pageId?: string;
  currentUrl?: string;
  timestamp: Date;
}

interface PageInfo {
  id: string;
  title?: string;
  url?: string;
}
```

## API Integration Pattern

```typescript
// Service layer
export const agentService = {
  async sendMessage(message: string, pageId: string) {
    return apiClient.post<AgentResponse>('/agent', {
      message,
      pageId
    });
  }
};

// Hook layer
export const useChat = () => {
  const sendMessage = async (input: string) => {
    const response = await agentService.sendMessage(input, pageId);
    // Update state
  };
};

// Component layer
const App = () => {
  const { messages, sendMessage } = useChat();
  // Render UI
};
```

## Deployment Checklist

- [ ] Set `VITE_API_URL` to production API endpoint
- [ ] Set `VITE_ENV` to `production`
- [ ] Set `VITE_ENABLE_DEBUG` to `false`
- [ ] Review Dockerfile for security
- [ ] Set up Docker registry credentials
- [ ] Create Kubernetes secrets if needed
- [ ] Set up monitoring/logging
- [ ] Configure domain name
- [ ] Set up SSL/TLS certificates
- [ ] Test health checks
- [ ] Configure auto-scaling

## Monitoring & Logs

```bash
# View application logs
kubectl logs deployment/remi-frontend

# Stream logs in real-time
kubectl logs -f deployment/remi-frontend

# View specific pod logs
kubectl logs pod-name

# Check pod events
kubectl describe pod pod-name

# View resource usage
kubectl top nodes
kubectl top pods
```

## Performance Tips

1. Keep components small and focused
2. Use React.memo for expensive components
3. Memoize callback functions with useCallback
4. Use custom hooks to share logic
5. Lazy load routes with React.lazy
6. Monitor bundle size with Vite analyzer
7. Use CDN for static assets
8. Enable caching in Kubernetes
9. Set resource limits
10. Monitor API response times

## Security Checklist

- [ ] No hardcoded API keys or secrets
- [ ] Environment variables for all config
- [ ] HTTPS in production
- [ ] CORS properly configured
- [ ] Input validation on forms
- [ ] Content Security Policy headers
- [ ] Regular dependency updates
- [ ] Security scanning in CI/CD
- [ ] Rate limiting on API calls
- [ ] Error message sanitization

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs container-id

# Or for Kubernetes
kubectl logs pod-name
kubectl describe pod pod-name
```

### API connection issues
- Check `VITE_API_URL` is correct
- Verify API service is running
- Check network policies
- Look for CORS errors in console

### High memory usage
- Check for memory leaks
- Reduce number of replicas
- Increase memory limits
- Profile with DevTools

### Slow performance
- Check API response times
- Monitor bundle size
- Look for unnecessary re-renders
- Profile with Lighthouse

---

**For detailed information, see:** 
- README_NEW.md (Quick start)
- ARCHITECTURE.md (Design patterns)
- DEPLOYMENT.md (Cloud deployment)
