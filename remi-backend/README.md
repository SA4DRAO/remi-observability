# Remi Browser Agent - Production-Ready Backend

A scalable, cloud-ready LLM-powered browser automation agent built with Node.js, TypeScript, Express, Puppeteer, and OpenAI.

## 🚀 Features

- **Type-Safe**: Full TypeScript with strict mode enabled
- **Modular Architecture**: Service-oriented design with clear separation of concerns
- **Cloud-Ready**: Docker support, environment configuration, health checks
- **Error Handling**: Comprehensive error handling and logging
- **API Documentation**: RESTful API with clear endpoints
- **Scalable**: Designed for horizontal scaling and cloud deployment
- **Production Configuration**: Environment variables, graceful shutdown, structured logging

## 📋 Project Structure

```
backend/
├── src/
│   ├── config/              # Configuration management
│   │   └── index.ts        # Config loader and validator
│   ├── middleware/          # Express middleware
│   │   ├── error-handler.ts
│   │   ├── request-logger.ts
│   │   └── validator.ts
│   ├── routes/              # Route handlers
│   │   ├── agent.routes.ts
│   │   ├── page.routes.ts
│   │   ├── screenshot.routes.ts
│   │   ├── health.routes.ts
│   │   └── index.ts
│   ├── services/            # Business logic
│   │   ├── browser.service.ts      # Puppeteer wrapper
│   │   ├── action-executor.service.ts # Action execution
│   │   ├── ai.service.ts           # OpenAI integration
│   │   ├── screenshot.service.ts   # Screenshot handling
│   │   ├── logger.ts               # Structured logging
│   │   └── index.ts
│   ├── types/               # TypeScript type definitions
│   │   ├── index.ts
│   │   └── config.ts
│   └── index.ts            # Application entry point
├── screenshots/            # Screenshot storage
├── .env.example           # Environment variables template
├── .eslintrc.json        # ESLint configuration
├── .prettierrc.json      # Prettier configuration
├── Dockerfile            # Docker image definition
├── docker-compose.yml    # Docker Compose configuration
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.6+
- **Framework**: Express 5.2+
- **Browser Automation**: Puppeteer 24.37+
- **AI Integration**: OpenAI SDK 6.18+
- **Middleware**: CORS, dotenv
- **Development**: ts-node, nodemon, ESLint, Prettier

## 📦 Installation

### Prerequisites

- Node.js 20+ or Docker
- OpenAI API Key

### Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Configure .env:**
   ```env
   NODE_ENV=development
   PORT=3100
   OPENAI_API_KEY=your_api_key_here
   CORS_ORIGINS=http://localhost:5173,http://localhost:3000
   LOG_LEVEL=debug
   ```

4. **Install Chromium (if needed):**
   - See [CHROMIUM_SETUP.md](./CHROMIUM_SETUP.md) for detailed instructions
   - macOS: `brew install chromium` or `brew install google-chrome`
   - Ubuntu: `sudo apt-get install chromium-browser` or `google-chrome-stable`
   - Windows: Download from https://www.google.com/chrome/
   - Docker: Chromium is pre-installed

## 🚀 Running the Application

### Local Development

```bash
# Start with file watching
npm run dev:watch

# Or start once
npm run dev
```

### Build and Production

```bash
# Compile TypeScript
npm run build

# Start production server
npm start
```

### Docker / Podman

```bash
# Using Docker
docker build -t remi-backend .
docker run -p 3100:3100 -e OPENAI_API_KEY=your_key remi-backend

# Or with Docker Compose
docker-compose up --build

# Using Podman
podman build -t remi-backend .
podman run -p 3100:3100 -e OPENAI_API_KEY=your_key remi-backend

# Or with podman-compose
podman-compose up --build

# View logs
docker logs <container-id>        # Docker
podman logs <container-id>        # Podman
```

## 📝 API Endpoints

### Health & Info
- `GET /health` - Health check
- `GET /info` - Server information

### Agent Operations
- `POST /agent` - Execute browser actions
  ```json
  {
    "message": "Navigate to Google and search for 'TypeScript'",
    "pageId": "page1"
  }
  ```

### Page Management
- `GET /pages` - List all active pages
- `GET /pages/:pageId` - Get page status
- `DELETE /pages/:pageId` - Close a page

### Screenshots
- `POST /screenshot/:pageId` - Capture page screenshot
- `GET /html/:pageId` - Get page HTML and form elements

## 🔧 Configuration

All configuration is managed through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 3100 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `OPENAI_API_KEY` | - | Required: OpenAI API key |
| `LOG_LEVEL` | info | Logging level (debug, info, warn, error) |
| `CORS_ORIGINS` | localhost:* | Comma-separated allowed origins |
| `BROWSER_HEADLESS` | true | Run browser in headless mode |
| `BROWSER_TIMEOUT` | 15000 | Browser action timeout (ms) |
| `BROWSER_SANDBOX` | false | Enable sandbox mode |

## 📊 Logging

The application uses structured logging with timestamps and levels:

```
[2024-01-20T10:30:45.123Z] INFO   Server running at http://0.0.0.0:3100
[2024-01-20T10:30:46.456Z] DEBUG  Browser initialized
[2024-01-20T10:30:47.789Z] ERROR  Error: Timeout waiting for selector
```

## 🐳 Docker Deployment

### Local Development with Docker

```bash
npm run docker:rebuild
```

### Cloud Deployment

The Dockerfile uses multi-stage builds for optimized images:

1. **Build Stage**: Compiles TypeScript
2. **Production Stage**: Runs only compiled JavaScript with production dependencies
3. **Health Check**: Built-in container health monitoring
4. **Security**: Non-root user execution

#### AWS Deployment (ECS/Fargate)

```bash
# Build image for ECR
docker build -t remi-backend:latest .

# Push to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <aws-account>.dkr.ecr.us-east-1.amazonaws.com

docker tag remi-backend:latest <aws-account>.dkr.ecr.us-east-1.amazonaws.com/remi-backend:latest
docker push <aws-account>.dkr.ecr.us-east-1.amazonaws.com/remi-backend:latest
```

#### Google Cloud Run

```bash
# Build and push to GCR
gcloud builds submit --tag gcr.io/<project-id>/remi-backend

# Deploy
gcloud run deploy remi-backend \
  --image gcr.io/<project-id>/remi-backend \
  --platform managed \
  --region us-central1 \
  --set-env-vars OPENAI_API_KEY=<key>
```

#### Kubernetes

```bash
# Create namespace
kubectl create namespace remi

# Create secret for API key
kubectl create secret generic openai-key \
  --from-literal=OPENAI_API_KEY=<your-key> \
  -n remi

# Deploy using Helm or kubectl
kubectl apply -f k8s/deployment.yaml -n remi
```

## 🔍 Development

### Code Quality

```bash
# Type checking
npm run type-check

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
```

### Project Standards

- **TypeScript**: Strict mode enabled, no implicit any
- **Code Style**: Prettier formatting + ESLint rules
- **Error Handling**: All async functions must handle errors
- **Logging**: Use Logger service for all logging
- **Configuration**: All settings via environment variables
- **Documentation**: JSDoc comments for public APIs

## 📚 Service Layer

### BrowserService
Manages Puppeteer browser instances and pages with singleton pattern.

```typescript
const browser = BrowserService.getInstance(config.browser, logger);
const page = await browser.getPage('page-id');
```

### AIService
Handles OpenAI API integration for converting messages to actions.

```typescript
const actions = await aiService.getBrowserActions("Click the submit button");
```

### ActionExecutor
Executes browser actions with proper error handling.

```typescript
const result = await actionExecutor.executeAction(page, action);
```

### Logger
Structured logging with levels and timestamps.

```typescript
logger.info('Message', data);
logger.error('Error occurred', error);
```

## 🔐 Security Considerations

- All secrets stored in environment variables
- Non-root user in Docker container
- CORS configuration for allowed origins
- Input validation on all endpoints
- Graceful error handling without exposing internals
- Security headers recommended (use with reverse proxy)

## 🚦 Health & Monitoring

- Built-in health check endpoint
- Structured logging for monitoring
- Docker health checks configured
- Graceful shutdown on signals (SIGINT, SIGTERM)
- Uptime tracking in health responses

## 🐛 Troubleshooting

### Browser/Chromium Issues

**Problem:** "Chromium not found" or "Browser launch failed"

**Solutions:**
1. Install Chromium: See [CHROMIUM_SETUP.md](./CHROMIUM_SETUP.md)
2. Set custom path: `BROWSER_EXECUTABLE_PATH=/path/to/chrome` in `.env`
3. Use Docker: `docker-compose up` (pre-installed)

See [CHROMIUM_SETUP.md](./CHROMIUM_SETUP.md) for complete troubleshooting guide.

### OpenAI API Issues

**Problem:** "OPENAI_API_KEY is not set"

**Solution:**
```bash
# Add to .env
OPENAI_API_KEY=sk-...your-key...

# Restart the application
npm start
```

### Port Already in Use

**Problem:** "EADDRINUSE: address already in use :::3100"

**Solutions:**
```bash
# Use a different port
PORT=3101 npm start

# Or kill the process using port 3100
# macOS/Linux:
lsof -ti:3100 | xargs kill -9
# Windows:
netstat -ano | findstr :3100
taskkill /PID <PID> /F
```

### CORS Issues

**Problem:** "CORS policy: Cross-Origin Request Blocked"

**Solution:**
```bash
# Add your frontend URL to .env
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,https://example.com
```

### Memory Issues

**Problem:** "JavaScript heap out of memory"

**Solutions:**
1. Increase Node memory:
   ```bash
   NODE_OPTIONS=--max-old-space-size=4096 npm start
   ```

2. Reduce browser instances (use page pooling)

3. Close old pages: `DELETE /pages/{pageId}`

## 🤝 Contributing

1. Maintain TypeScript strict mode
2. Format with Prettier before committing
3. Pass ESLint checks
4. Add type definitions for new code
5. Document public APIs
6. Use Logger service for all logging

## 📄 License

ISC

---

**Ready for cloud deployment** with Docker, Kubernetes, and major cloud providers (AWS, GCP, Azure).
