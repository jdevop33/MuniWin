#!/bin/bash

# Maxun Setup and Management Script for CouncilInsight

echo "===== Maxun Management for CouncilInsight ====="

function start_maxun() {
  echo "Starting Maxun Docker containers..."
  docker-compose up -d
  echo "Maxun should be starting. Frontend will be accessible at http://localhost:5174"
  echo "After startup completes, follow these steps:"
  echo "1. Create an account at http://localhost:5174"
  echo "2. Log in to the Maxun dashboard"
  echo "3. Go to the 'API Key' section to generate your API key"
  echo "4. Save the API key for use with CouncilInsight"
}

function stop_maxun() {
  echo "Stopping Maxun Docker containers..."
  docker-compose down
  echo "Maxun containers stopped"
}

function status_maxun() {
  echo "Checking Maxun container status..."
  docker-compose ps
}

function show_help() {
  echo "Usage: ./maxun-setup.sh [command]"
  echo "Commands:"
  echo "  start    - Start Maxun containers"
  echo "  stop     - Stop Maxun containers"
  echo "  status   - Check Maxun container status"
  echo "  help     - Show this help message"
}

# Process command line arguments
case "$1" in
  start)
    start_maxun
    ;;
  stop)
    stop_maxun
    ;;
  status)
    status_maxun
    ;;
  help|*)
    show_help
    ;;
esac