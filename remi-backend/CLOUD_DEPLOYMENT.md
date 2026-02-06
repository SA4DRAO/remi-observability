# Remi Backend - Cloud Deployment Guide

This guide covers deploying the Remi Backend to various cloud platforms.

## Prerequisites

- Docker installed locally
- Cloud provider CLI tools installed
- Environment variables configured

## Quick Start Options

### Option 1: Docker Compose (Local Testing)

```bash
npm run docker:up
npm run docker:logs
npm run docker:down
```

### Option 2: Kubernetes (Any Cloud)

```bash
# Prepare cluster and deploy
bash scripts/deploy-k8s.sh remi docker.io/yourorg/remi-backend:latest
```

### Option 3: AWS ECS/Fargate

```bash
bash scripts/deploy-aws.sh us-east-1 123456789.dkr.ecr.us-east-1.amazonaws.com
```

### Option 4: Google Cloud Run

```bash
bash scripts/deploy-gcp.sh my-gcp-project us-central1
```

---

## Detailed Deployment Instructions

### AWS ECS/Fargate

#### 1. Setup AWS Infrastructure

```bash
# Create ECR repository
aws ecr create-repository --repository-name remi-backend --region us-east-1

# Get repository URL
aws ecr describe-repositories --repository-names remi-backend --region us-east-1
```

#### 2. Build and Push Image

```bash
bash scripts/deploy-aws.sh us-east-1 <your-ecr-uri>
```

#### 3. Create ECS Task Definition

```json
{
  "family": "remi-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "remi-backend",
      "image": "<ecr-uri>/remi-backend:latest",
      "portMappings": [
        {
          "containerPort": 3100,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "LOG_LEVEL", "value": "info"},
        {"name": "BROWSER_HEADLESS", "value": "true"}
      ],
      "secrets": [
        {
          "name": "OPENAI_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:openai-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/remi-backend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### 4. Create ECS Service

```bash
aws ecs create-service \
  --cluster remi-cluster \
  --service-name remi-backend \
  --task-definition remi-backend:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=remi-backend,containerPort=3100"
```

#### 5. Configure Auto-Scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/remi-cluster/remi-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --policy-name remi-cpu-scaling \
  --service-namespace ecs \
  --resource-id service/remi-cluster/remi-backend \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 300
  }'
```

---

### Google Cloud Run

#### 1. Setup GCP Project

```bash
# Set project
gcloud config set project MY_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

#### 2. Store Secret

```bash
echo -n "your-openai-api-key" | \
  gcloud secrets create openai-api-key --data-file=-
```

#### 3. Deploy

```bash
bash scripts/deploy-gcp.sh MY_PROJECT_ID us-central1
```

#### 4. Grant Secret Access

```bash
gcloud secrets add-iam-policy-binding openai-api-key \
  --member serviceAccount:PROJECT_ID@appspot.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
```

#### 5. Setup Custom Domain

```bash
# Map custom domain to Cloud Run service
gcloud beta run domain-mappings create \
  --domain remi.example.com \
  --service remi-backend \
  --region us-central1
```

---

### Kubernetes (on Any Cloud)

#### 1. Prepare Cluster

```bash
# Create namespace
kubectl create namespace remi

# Create secret
kubectl create secret generic remi-secrets \
  --from-literal=openai-api-key=$OPENAI_API_KEY \
  -n remi
```

#### 2. Deploy with Script

```bash
bash scripts/deploy-k8s.sh remi docker.io/myorg/remi-backend:latest
```

#### 3. Verify Deployment

```bash
# Check pods
kubectl get pods -n remi

# Check service
kubectl get service remi-backend -n remi

# View logs
kubectl logs -n remi deployment/remi-backend
```

#### 4. Setup Ingress (HTTPS)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: remi-ingress
  namespace: remi
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - remi.example.com
    secretName: remi-tls
  rules:
  - host: remi.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: remi-backend
            port:
              number: 80
```

---

## Environment Variables by Cloud Provider

### AWS ECS/Fargate

Use AWS Secrets Manager for sensitive data:

```bash
aws secretsmanager create-secret \
  --name remi-openai-key \
  --secret-string "your-api-key"
```

Then reference in task definition with `valueFrom`.

### Google Cloud Run

Use Secret Manager:

```bash
gcloud secrets create openai-api-key --data-file=-
```

### Kubernetes

Use Kubernetes Secrets:

```bash
kubectl create secret generic remi-secrets \
  --from-literal=openai-api-key=$OPENAI_API_KEY
```

---

## Monitoring & Logging

### AWS CloudWatch

```bash
# View logs
aws logs tail /ecs/remi-backend --follow

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name remi-cpu-high \
  --alarm-description "Alert when CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 60 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold
```

### Google Cloud Logging

```bash
gcloud logging read "resource.type=cloud_run_revision" --limit 50
```

### Kubernetes Logging

```bash
kubectl logs -n remi deployment/remi-backend --follow
```

---

## Performance Tuning

### Database & Cache (Optional)

For production, consider adding:

- **Redis**: Session caching, rate limiting
- **PostgreSQL**: Persistent state storage
- **S3/GCS**: Screenshot storage

### Browser Configuration

For cloud environments:

```env
BROWSER_HEADLESS=true        # Always true in cloud
BROWSER_TIMEOUT=30000        # Increase for cloud latency
BROWSER_SANDBOX=true         # Enable for security
```

### Resource Limits

Recommended for cloud:

```
Memory: 512MB - 1GB (per instance)
CPU: 500m - 1000m (per instance)
Timeout: 30-60 seconds (API level)
Max Instances: 10-100 (depends on browser costs)
```

---

## Cost Optimization

### AWS

- Use **Spot Instances** (30% cheaper)
- **Reserved Capacity** for baseline load
- Monitor **CloudWatch** metrics
- Set up **auto-scaling** based on demand

### Google Cloud Run

- Billing by request + execution time
- Automatic scaling (no idle costs)
- Always cheaper for intermittent workloads
- Use **Memory allocation** wisely

### Kubernetes

- Use **Horizontal Pod Autoscaler** (HPA)
- Implement **Pod Disruption Budgets**
- Monitor **resource requests/limits**
- Consider **spot/preemptible** nodes

---

## Troubleshooting

### Common Issues

1. **Browser crashes in cloud**
   - Increase memory allocation
   - Enable headless mode
   - Add `--disable-dev-shm-usage`

2. **Timeout errors**
   - Increase `BROWSER_TIMEOUT`
   - Check network connectivity
   - Verify DNS resolution

3. **High costs**
   - Reduce max instances
   - Optimize browser actions
   - Cache responses when possible

4. **Authentication failures**
   - Verify secret management setup
   - Check IAM/RBAC permissions
   - Confirm API keys are correctly injected

---

## Next Steps

1. Choose your cloud provider
2. Set up infrastructure (VPC, security groups, etc.)
3. Run appropriate deployment script
4. Configure monitoring and alerting
5. Set up CI/CD pipeline for automated deployments

For questions or issues, refer to:
- AWS ECS: https://docs.aws.amazon.com/ecs/
- Google Cloud Run: https://cloud.google.com/docs/run
- Kubernetes: https://kubernetes.io/docs/
