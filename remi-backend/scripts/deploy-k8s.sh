#!/bin/bash

# Deploy to Kubernetes cluster
# Usage: ./scripts/deploy-k8s.sh <namespace> <image-registry>

set -e

NAMESPACE=${1:-remi}
IMAGE_REGISTRY=${2:-remi-backend:latest}

echo "🔧 Creating namespace..."
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

echo "🔐 Creating secrets..."
kubectl create secret generic remi-secrets \
  --from-literal=openai-api-key=$OPENAI_API_KEY \
  -n $NAMESPACE \
  --dry-run=client -o yaml | kubectl apply -f -

echo "📋 Deploying to Kubernetes..."
# Update image in deployment
sed "s|remi-backend:latest|$IMAGE_REGISTRY|g" k8s/deployment.yaml | \
  kubectl apply -f - -n $NAMESPACE

echo "⏳ Waiting for deployment to be ready..."
kubectl rollout status deployment/remi-backend -n $NAMESPACE

echo "✅ Deployment complete!"
echo ""
echo "Access your service:"
kubectl get service remi-backend -n $NAMESPACE
