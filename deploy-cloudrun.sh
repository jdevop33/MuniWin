#!/bin/bash
# Deployment script for the entire application to Google Cloud Run

# Exit on error
set -e

# Configuration
PROJECT_ID=${PROJECT_ID:-councilinsight-prod}
REGION=${REGION:-us-central1}
WEB_SERVICE_NAME=${WEB_SERVICE_NAME:-councilinsight-web}
MAXUN_SERVICE_NAME=${MAXUN_SERVICE_NAME:-maxun-service}
REPOSITORY=${REPOSITORY:-councilinsight-repo}

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL environment variable is required"
  exit 1
fi

echo "Deploying CouncilInsight to Google Cloud Run..."
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Web Service name: $WEB_SERVICE_NAME"
echo "Maxun Service name: $MAXUN_SERVICE_NAME"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed. Please install it first."
  exit 1
fi

# Ensure project is set
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com storage.googleapis.com

# Create Artifact Registry repository if it doesn't exist
if ! gcloud artifacts repositories describe $REPOSITORY --location=$REGION &> /dev/null; then
  echo "Creating Artifact Registry repository $REPOSITORY..."
  gcloud artifacts repositories create $REPOSITORY \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for CouncilInsight"
fi

# Deploy Maxun service first
echo "Deploying Maxun service..."
cd maxun

# Create temporary Dockerfile for the Maxun service
cat > Dockerfile << 'EOF'
FROM node:18-slim

WORKDIR /app

# Install puppeteer dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils

COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0
CMD ["node", "server.js"]
EOF

# Build and deploy Maxun service
gcloud builds submit \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$MAXUN_SERVICE_NAME \
  .

gcloud run deploy $MAXUN_SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$MAXUN_SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars="DATABASE_URL=$DATABASE_URL,NODE_ENV=production"

# Get the Maxun service URL
MAXUN_URL=$(gcloud run services describe $MAXUN_SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')
echo "Maxun service deployed at: $MAXUN_URL"

# Return to project root
cd ..

# Create temporary Dockerfile for the Web service
cat > Dockerfile << 'EOF'
FROM node:18 as builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:18-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server ./server

EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
EOF

# Build and deploy Web service
echo "Deploying Web service..."
gcloud builds submit \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$WEB_SERVICE_NAME \
  .

gcloud run deploy $WEB_SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$WEB_SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-env-vars="DATABASE_URL=$DATABASE_URL,VITE_MAXUN_URL=$MAXUN_URL,NODE_ENV=production"

# Get the Web service URL
WEB_URL=$(gcloud run services describe $WEB_SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')

echo "============================================================"
echo "Deployment Complete!"
echo "============================================================"
echo "Web application: $WEB_URL"
echo "Maxun service: $MAXUN_URL"
echo "============================================================"
echo "Don't forget to update your environment variables if needed."
echo "============================================================"