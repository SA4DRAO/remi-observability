# Remi - AI-Powered Browser Agent Frontend

A production-ready React + TypeScript application with modern best practices, cloud-native architecture, and comprehensive deployment options.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- npm 10+

### Installation

```bash
# Install dependencies
cd remi
npm install

# Start development server
npm run dev

# Open http://localhost:5173
```

## 📦 Available Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload
npm run build           # Build for production
npm run preview         # Preview production build locally
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint issues
npm run type-check      # Check TypeScript types

# Docker
npm run docker:build    # Build Docker image
npm run docker:run      # Run Docker container
```

## 📁 Project Structure

```
src/
├── components/          # React components
│   ├── Chat/           # ChatDisplay with auto-scroll
│   ├── Input/          # ChatInput with form handling
│   └── PageSelector/   # PageSelector dropdown
├── hooks/              # Custom React hooks
│   ├── useChat.ts      # Chat state management
│   └── usePages.ts     # Pages polling
├── services/           # Business logic
│   └── agent-service.ts # Agent API integration
├── types/              # TypeScript interfaces
│   └── agent.ts        # Domain types
├── utils/              # Utility functions
│   ├── api-client.ts   # HTTP client with timeouts
│   └── logger.ts       # Structured logging
├── config/             # Configuration
│   └── env.ts          # Environment variables
└── App.tsx             # Root component
```

## 🏗️ Architecture

### Separation of Concerns
- **Components**: UI rendering and user interaction
- **Services**: Business logic and API communication
- **Hooks**: State management and side effects
- **Utils**: Reusable functions and helpers
- **Types**: Centralized type definitions

### Features
- ✅ Type-safe with TypeScript
- ✅ Modular component architecture
- ✅ Centralized API client with error handling
- ✅ Environment-based configuration
- ✅ Structured logging
- ✅ Responsive design
- ✅ Error boundaries ready
- ✅ Cloud-native architecture

## 🌍 Environment Configuration

Create `.env` files for different environments:

```bash
# .env.development (default)
VITE_API_URL=http://localhost:3100
VITE_ENV=development
VITE_ENABLE_DEBUG=true

# .env.production
VITE_API_URL=https://api.example.com
VITE_ENV=production
VITE_ENABLE_DEBUG=false
```

## 🐳 Docker / Podman Deployment

### Build Image
```bash
# Using Docker
docker build -t remi-frontend .

# Using Podman
podman build -t remi-frontend .
```

### Run Container
```bash
# Using Docker
docker run -p 3000:3000 \
  -e VITE_API_URL=http://api:3100 \
  remi-frontend

# Using Podman
podman run -p 3000:3000 \
  -e VITE_API_URL=http://api:3100 \
  remi-frontend
```

### Docker / Podman Compose
```bash
# Using Docker Compose
docker-compose up --build

# Using Podman Compose (install: pip install podman-compose)
podman-compose up --build
```

## ☸️ Kubernetes Deployment

### Deploy to Cluster
```bash
kubectl apply -f k8s-deployment.yaml
```

### Check Status
```bash
kubectl get pods -l app=remi
kubectl logs deployment/remi-frontend -f
```

### Scale Replicas
```bash
kubectl scale deployment remi-frontend --replicas=3
```

## 📚 API Integration

The project includes a centralized API client with:
- Automatic timeout handling
- Error handling and logging
- Request/response typing
- Retry logic ready

Example usage:
```typescript
import { agentService } from './services/agent-service';

// Send message to agent
const response = await agentService.sendMessage(
  "Go to google.com",
  "page-1"
);

// Get available pages
const pages = await agentService.getPages();
```

## 🔐 Security

- Environment variables for sensitive data
- HTTPS in production
- CORS configuration ready
- Input validation in components
- XSS protection via React

## 📊 Monitoring

### Health Checks
Built-in health checks for:
- Container startup
- Liveness (is it still running?)
- Readiness (can it serve requests?)

Configure in `k8s-deployment.yaml`

### Logging
```typescript
import { logger } from './utils/logger';

logger.info('User logged in', { userId: 123 });
logger.error('API call failed', error);
logger.debug('Debug info', { data: value });
```

## 🚀 Production Deployment

### AWS
```bash
# Push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $REGISTRY
docker tag remi-frontend:latest $REGISTRY/remi-frontend:latest
docker push $REGISTRY/remi-frontend:latest
```

### Google Cloud Run
```bash
gcloud run deploy remi-frontend \
  --image gcr.io/project/remi-frontend \
  --platform managed \
  --region us-central1
```

### Azure
```bash
az container create \
  --resource-group rg-name \
  --name remi-frontend \
  --image acr.azurecr.io/remi-frontend:latest
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment guides.

## 📖 Additional Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architecture and best practices
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Cloud deployment guide
- [.env.example](./.env.example) - Environment variables template

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/name`
2. Make changes and commit: `git commit -am 'feat: add feature'`
3. Push: `git push origin feature/name`
4. Create a Pull Request

## 🔍 Code Quality

- ESLint configuration for consistent code style
- TypeScript for type safety
- Component-based architecture
- Service layer for business logic

## 📝 License

ISC

## 📞 Support

For issues and questions, please open an issue in the repository.
