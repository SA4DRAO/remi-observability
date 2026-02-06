# Cloud Deployment Guide

## Overview
This project is structured for cloud deployment with:
- **Multi-stage Docker builds** for optimized production images
- **Environment-based configuration** for different deployment targets
- **Kubernetes manifests** for container orchestration
- **GitHub Actions CI/CD** for automated testing and deployment

## Directory Structure

```
remi/
├── src/
│   ├── components/       # Reusable React components
│   │   ├── Chat/        # Chat display component
│   │   ├── Input/       # Input component
│   │   └── PageSelector/ # Page selector component
│   ├── services/        # API services & business logic
│   ├── hooks/           # Custom React hooks
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── config/          # Environment & configuration
│   ├── context/         # React context providers
│   ├── App.tsx          # Main App component
│   └── main.tsx         # Entry point
├── public/              # Static assets
├── Dockerfile           # Production container image
├── docker-compose.yml   # Local development setup
├── k8s-deployment.yaml  # Kubernetes deployment
└── .env.example         # Example environment variables
```

## Deployment Options

### 1. Docker (Local Development)

```bash
# Build image
docker build -t remi-frontend .

# Run container
docker run -p 3000:3000 \
  -e VITE_API_URL=http://localhost:3100 \
  remi-frontend

# Or use docker-compose
docker-compose up --build
```

### 2. Kubernetes (Recommended for Production)

```bash
# Apply configuration
kubectl apply -f k8s-deployment.yaml

# Check status
kubectl get pods -l app=remi
kubectl describe svc remi-frontend-service

# Scale replicas
kubectl scale deployment remi-frontend --replicas=3

# View logs
kubectl logs -f deployment/remi-frontend
```

### 3. Cloud Platforms

#### AWS (ECS/Fargate)
- Push image to ECR: `aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com`
- Create ECS task definition with Docker image
- Deploy to Fargate cluster

#### Google Cloud (Cloud Run)
- Push to Artifact Registry
- Deploy: `gcloud run deploy remi-frontend --image <image-url> --platform managed`

#### Azure (Container Instances)
- Push to ACR: `az acr build --registry <registry> --image remi:latest .`
- Deploy: `az container create --resource-group <rg> --image <image-url>`

#### Heroku
```bash
heroku login
heroku create remi-frontend
heroku container:push web
heroku container:release web
```

## Environment Configuration

Create `.env` files for different environments:

```bash
# Development
VITE_API_URL=http://localhost:3100
VITE_ENV=development
VITE_ENABLE_DEBUG=true

# Staging
VITE_API_URL=https://api-staging.example.com
VITE_ENV=staging
VITE_ENABLE_DEBUG=false

# Production
VITE_API_URL=https://api.example.com
VITE_ENV=production
VITE_ENABLE_DEBUG=false
```

## CI/CD Pipeline

The `.github/workflows/deploy.yml` file enables:
- Automated testing on PRs
- Linting and type checking
- Docker image building
- Automatic deployment to production on merge to main

## Monitoring & Logging

### Health Checks
- Liveness probe: Checks if container is running
- Readiness probe: Checks if container is ready to serve traffic
- Configure in k8s-deployment.yaml

### Logging
```bash
# View application logs
kubectl logs deployment/remi-frontend
kubectl logs deployment/remi-frontend -f  # Follow logs
kubectl logs deployment/remi-frontend --tail=100  # Last 100 lines
```

## Scaling

### Horizontal Scaling
```bash
kubectl scale deployment remi-frontend --replicas=5
```

### Resource Limits
Configured in k8s-deployment.yaml - adjust based on your needs:
- Memory: 128Mi (request) / 256Mi (limit)
- CPU: 100m (request) / 500m (limit)

## Security Best Practices

1. **Environment Variables**: Never commit `.env` files
2. **Image Security**: Use base images from official registries
3. **Container Scanning**: Scan images for vulnerabilities
4. **HTTPS**: Use TLS/SSL certificates in production
5. **CORS**: Configure appropriate CORS policies in API

## Troubleshooting

### Container won't start
```bash
# Check container logs
docker logs <container-id>

# Or for Kubernetes
kubectl logs <pod-name>
kubectl describe pod <pod-name>
```

### High memory usage
- Reduce replicas
- Increase resource limits in k8s-deployment.yaml
- Profile application for memory leaks

### API connection issues
- Check VITE_API_URL environment variable
- Verify API service is accessible
- Check network policies and firewalls

## Next Steps

1. Set up Docker registry (Docker Hub, ECR, GCR, ACR)
2. Configure CI/CD pipeline with GitHub Actions
3. Set up Kubernetes cluster (EKS, GKE, AKS)
4. Configure domain and SSL certificates
5. Set up monitoring (Prometheus, DataDog, etc.)
6. Configure auto-scaling policies
