#!/bin/bash

# Deploy to Google Cloud Run
# Usage: ./scripts/deploy-gcp.sh <project-id> <region>

set -e

PROJECT_ID=${1:-}
REGION=${2:-us-central1}

if [ -z "$PROJECT_ID" ]; then
  echo "Usage: ./scripts/deploy-gcp.sh <project-id> [region]"
  exit 1
fi

echo "🏗️  Building Docker image..."
docker build -t gcr.io/$PROJECT_ID/remi-backend:latest .

echo "🚀 Pushing to Google Container Registry..."
docker push gcr.io/$PROJECT_ID/remi-backend:latest

echo "📋 Deploying to Cloud Run..."
gcloud run deploy remi-backend \
  --image gcr.io/$PROJECT_ID/remi-backend:latest \
  --platform managed \
  --region $REGION \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 100 \
  --set-env-vars NODE_ENV=production,LOG_LEVEL=info \
  --allow-unauthenticated

echo "✅ Deployment complete!"
gcloud run services describe remi-backend --region $REGION
