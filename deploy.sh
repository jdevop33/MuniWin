#!/bin/bash

# CouncilInsight Deployment Script
# This script helps build and deploy the CouncilInsight application to GCP Cloud Run

# Settings
PROJECT_ID="oak-bay-councilinsight"  # Replace with your actual GCP project ID
REGION="us-central1"                 # Replace with your preferred region
SERVICE_NAME="councilinsight"

# Color codes for pretty output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Print header
echo -e "${GREEN}==== CouncilInsight Deployment Tool ====${NC}"
echo -e "This tool helps deploy CouncilInsight to Google Cloud Run"
echo

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"
PREREQS_OK=true

if ! command_exists docker; then
  echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
  PREREQS_OK=false
fi

if ! command_exists gcloud; then
  echo -e "${RED}Google Cloud SDK is not installed. Please install it first.${NC}"
  PREREQS_OK=false
fi

if [ "$PREREQS_OK" = false ]; then
  echo -e "${RED}Please install the missing prerequisites and try again.${NC}"
  exit 1
fi

echo -e "${GREEN}Prerequisites check passed!${NC}"
echo

# Build Docker image
build_image() {
  echo -e "${YELLOW}Building Docker image...${NC}"
  docker build -t $SERVICE_NAME .
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}Docker build failed!${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}Docker image built successfully!${NC}"
}

# Tag and push the image to Google Container Registry
tag_and_push() {
  echo -e "${YELLOW}Tagging and pushing image to Google Container Registry...${NC}"
  
  # Tag the image
  docker tag $SERVICE_NAME gcr.io/$PROJECT_ID/$SERVICE_NAME
  
  # Push to GCR
  gcloud auth configure-docker -q
  docker push gcr.io/$PROJECT_ID/$SERVICE_NAME
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to push image to GCR!${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}Image pushed to Google Container Registry successfully!${NC}"
}

# Deploy to Cloud Run
deploy_to_cloud_run() {
  echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
  
  gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars="NODE_ENV=production" \
    --memory 1Gi
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}Deployment to Cloud Run failed!${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}Deployment to Cloud Run successful!${NC}"
}

# Main execution
case "$1" in
  build)
    build_image
    ;;
  push)
    tag_and_push
    ;;
  deploy)
    deploy_to_cloud_run
    ;;
  all)
    build_image
    tag_and_push
    deploy_to_cloud_run
    ;;
  *)
    echo -e "${YELLOW}Usage: $0 {build|push|deploy|all}${NC}"
    echo
    echo "Commands:"
    echo "  build   - Build the Docker image locally"
    echo "  push    - Tag and push the Docker image to Google Container Registry"
    echo "  deploy  - Deploy the image to Cloud Run"
    echo "  all     - Execute all steps (build, push, deploy)"
    exit 1
    ;;
esac

echo -e "${GREEN}==== Operation completed successfully! ====${NC}"
exit 0