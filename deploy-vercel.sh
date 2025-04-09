#!/bin/bash
# Helper script for deploying to Vercel

# Exit on any error
set -e

# Check for vercel CLI
if ! command -v vercel &> /dev/null; then
  echo "Vercel CLI not found. Installing..."
  npm install -g vercel
fi

# Check if we are logged in to Vercel
vercel whoami &> /dev/null || {
  echo "Not logged in to Vercel. Please log in:"
  vercel login
}

# Ask for environment variables
echo "Setting up Vercel project environment variables..."

# Function to get or validate environment variable
get_env_var() {
  local var_name=$1
  local prompt_msg=$2
  local default_val=$3
  local current_val=""
  
  # Check if environment variable is already set
  if [ -n "${!var_name}" ]; then
    current_val=${!var_name}
    read -p "$prompt_msg (current: $current_val): " input
    if [ -n "$input" ]; then
      echo "$input"
    else
      echo "$current_val"
    fi
  else
    read -p "$prompt_msg (default: $default_val): " input
    if [ -n "$input" ]; then
      echo "$input"
    else
      echo "$default_val"
    fi
  fi
}

# Get environment variables
DATABASE_URL=$(get_env_var "DATABASE_URL" "Enter your Neon PostgreSQL database URL" "postgresql://user:password@hostname:port/database")
MAXUN_URL=$(get_env_var "VITE_MAXUN_URL" "Enter your Maxun service URL (after deploying to Cloud Run)" "")
ENABLE_MAXUN=$(get_env_var "VITE_ENABLE_MAXUN_INTEGRATION" "Enable Maxun integration? (true/false)" "true")

# Confirm settings
echo ""
echo "========== Deployment Settings =========="
echo "Database URL: $DATABASE_URL"
echo "Maxun URL: $MAXUN_URL"
echo "Enable Maxun: $ENABLE_MAXUN"
echo "========================================"
echo ""

read -p "Do these settings look correct? (y/n): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Deployment canceled."
  exit 1
fi

# Create .env.production file for Vercel
cat > .env.production << EOL
DATABASE_URL=$DATABASE_URL
VITE_MAXUN_URL=$MAXUN_URL
VITE_ENABLE_MAXUN_INTEGRATION=$ENABLE_MAXUN
NODE_ENV=production
EOL

echo "Created .env.production file for Vercel"

# Deploy to Vercel
echo "Deploying to Vercel..."
vercel --prod

echo ""
echo "Deployment complete!"
echo "Your application is now live on Vercel. You can view it at the URL provided above."
echo ""
echo "Next steps:"
echo "1. Complete your Maxun service deployment to Google Cloud Run"
echo "2. Update your Vercel environment variables with the final Maxun URL"
echo ""
echo "Thank you for using CouncilInsight!"