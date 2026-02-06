#!/bin/bash

# Deploy to AWS ECS
# Usage: ./scripts/deploy-aws.sh <aws-region> <ecr-repository-url>

set -e

AWS_REGION=${1:-us-east-1}
ECR_REPO=${2:-}
IMAGE_TAG=${3:-latest}

if [ -z "$ECR_REPO" ]; then
  echo "Usage: ./scripts/deploy-aws.sh <aws-region> <ecr-repository-url>"
  exit 1
fi

echo "🏗️  Building Docker image..."
docker build -t remi-backend:$IMAGE_TAG .

echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR_REPO

echo "📦 Tagging image..."
docker tag remi-backend:$IMAGE_TAG $ECR_REPO/remi-backend:$IMAGE_TAG
docker tag remi-backend:$IMAGE_TAG $ECR_REPO/remi-backend:latest

echo "🚀 Pushing to ECR..."
docker push $ECR_REPO/remi-backend:$IMAGE_TAG
docker push $ECR_REPO/remi-backend:latest

echo "✅ Deployment package ready!"
echo "Next steps:"
echo "1. Update your ECS task definition with the new image:"
echo "   $ECR_REPO/remi-backend:latest"
echo "2. Deploy with: aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment"
