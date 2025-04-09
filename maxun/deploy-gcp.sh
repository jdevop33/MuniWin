#!/bin/bash
# Deployment script for Maxun service to Google Cloud Run

# Exit on error
set -e

# Configuration
PROJECT_ID=${PROJECT_ID:-councilinsight-prod}
REGION=${REGION:-us-central1}
SERVICE_NAME=${SERVICE_NAME:-maxun-service}
REPOSITORY=${REPOSITORY:-maxun-repo}
IMAGE_NAME=${IMAGE_NAME:-maxun-service}
GCS_BUCKET=${GCS_BUCKET:-councilinsight-data}
MEMORY=${MEMORY:-1Gi}
CPU=${CPU:-1}
MAX_INSTANCES=${MAX_INSTANCES:-10}
MIN_INSTANCES=${MIN_INSTANCES:-0}

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL environment variable is required"
  exit 1
fi

echo "Deploying Maxun service to Google Cloud Run..."
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Service name: $SERVICE_NAME"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed. Please install it first."
  exit 1
fi

# Ensure project is set
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com

# Create Artifact Registry repository if it doesn't exist
if ! gcloud artifacts repositories describe $REPOSITORY --location=$REGION &> /dev/null; then
  echo "Creating Artifact Registry repository $REPOSITORY..."
  gcloud artifacts repositories create $REPOSITORY \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for Maxun robots"
fi

# Create GCS bucket if it doesn't exist
if ! gsutil ls -b gs://$GCS_BUCKET &> /dev/null; then
  echo "Creating GCS bucket $GCS_BUCKET..."
  gsutil mb -l $REGION gs://$GCS_BUCKET
  gsutil iam ch allUsers:objectViewer gs://$GCS_BUCKET
fi

# Build and push the Docker image
echo "Building and pushing Docker image..."
gcloud builds submit \
  --tag $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_NAME \
  --timeout=20m \
  .

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory $MEMORY \
  --cpu $CPU \
  --max-instances $MAX_INSTANCES \
  --min-instances $MIN_INSTANCES \
  --set-env-vars="DATABASE_URL=$DATABASE_URL,GCS_BUCKET_NAME=$GCS_BUCKET,NODE_ENV=production"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')
echo "Maxun service deployed successfully to: $SERVICE_URL"

# Create a scheduled job for the Oak Bay council scraper
read -p "Do you want to set up a scheduled job for the Oak Bay council scraper? (y/n) " CREATE_JOB
if [[ "$CREATE_JOB" =~ ^[Yy]$ ]]; then
  JOB_NAME="oakbay-council-scraper"
  SCHEDULE="0 2 * * *"  # Run at 2:00 AM every day
  
  # Check if the job already exists
  if gcloud scheduler jobs describe $JOB_NAME &> /dev/null; then
    gcloud scheduler jobs delete $JOB_NAME --quiet
  fi
  
  echo "Creating scheduled job $JOB_NAME..."
  gcloud scheduler jobs create http $JOB_NAME \
    --schedule="$SCHEDULE" \
    --uri="$SERVICE_URL/api/maxun/robots/oakbay-council-robot/run" \
    --http-method=POST \
    --message-body="{}" \
    --headers="Content-Type=application/json"
  
  echo "Scheduled job created. It will run at $SCHEDULE."
fi

echo ""
echo "Deployment completed successfully!"
echo "Important: Update your Vercel environment variables with:"
echo "VITE_MAXUN_URL=$SERVICE_URL"
echo "GCS_BUCKET_NAME=$GCS_BUCKET"