#!/bin/bash
# Make all shell scripts executable
chmod +x scripts/*.sh

echo "✅ Shell scripts are now executable"
echo ""
echo "You can now run:"
echo "  bash scripts/dev-setup.sh       # Setup local development"
echo "  bash scripts/deploy-aws.sh      # Deploy to AWS"
echo "  bash scripts/deploy-gcp.sh      # Deploy to Google Cloud"
echo "  bash scripts/deploy-k8s.sh      # Deploy to Kubernetes"
