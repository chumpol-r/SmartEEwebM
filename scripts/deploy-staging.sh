#!/bin/bash
# SmartEE Web - Staging Deployment Script
# Usage: ./scripts/deploy-staging.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="SmartEE Web"
APP_DIR="/var/www/smartee-staging"
BACKUP_DIR="/var/backups/smartee"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BRANCH="staging"
MAX_BACKUPS=10

echo -e "${GREEN}🚀 Starting ${APP_NAME} Staging Deployment${NC}"
echo "================================================"
echo "Timestamp: $TIMESTAMP"
echo "Branch: $BRANCH"
echo "App Directory: $APP_DIR"
echo ""

# Function to print colored messages
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Pre-flight checks
log_info "Running pre-flight checks..."

if [ ! -d "$APP_DIR" ]; then
    log_error "Application directory not found: $APP_DIR"
    exit 1
fi

if ! command_exists git; then
    log_error "Git is not installed"
    exit 1
fi

if ! command_exists node; then
    log_error "Node.js is not installed"
    exit 1
fi

if ! command_exists pm2; then
    log_error "PM2 is not installed"
    exit 1
fi

log_info "Pre-flight checks passed ✓"
echo ""

# Create backup directory
log_info "Creating backup directory..."
mkdir -p "$BACKUP_DIR"

# Backup current version
log_info "Creating backup of current version..."
cd "$APP_DIR"
tar -czf "$BACKUP_DIR/smartee-staging-$TIMESTAMP.tar.gz" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='dist' \
    . || {
    log_warn "Backup creation failed, but continuing..."
}

# Clean old backups (keep only last MAX_BACKUPS)
log_info "Cleaning old backups (keeping last $MAX_BACKUPS)..."
cd "$BACKUP_DIR"
ls -t smartee-staging-*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f

# Pull latest code
log_info "Fetching latest code from Git..."
cd "$APP_DIR"
git fetch origin

log_info "Checking out $BRANCH branch..."
git checkout "$BRANCH"

log_info "Pulling latest changes..."
git pull origin "$BRANCH"

COMMIT_HASH=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=%B)
log_info "Deployed commit: $COMMIT_HASH"
log_info "Commit message: $COMMIT_MSG"
echo ""

# Install backend dependencies
log_info "Installing backend dependencies..."
cd "$APP_DIR/server"
npm ci --production --silent || {
    log_error "Backend dependency installation failed"
    exit 1
}

# Install frontend dependencies
log_info "Installing frontend dependencies..."
cd "$APP_DIR/client"
npm ci --silent || {
    log_error "Frontend dependency installation failed"
    exit 1
}

# Build frontend
log_info "Building frontend..."
npm run build || {
    log_error "Frontend build failed"
    exit 1
}

# Run database migrations (if any)
# Uncomment if you have migration scripts
# log_info "Running database migrations..."
# cd "$APP_DIR/server"
# npm run migrate || {
#     log_error "Database migration failed"
#     exit 1
# }

# Restart services
log_info "Restarting PM2 services..."
pm2 restart smartee-api-staging || {
    log_error "Failed to restart API service"
    exit 1
}

pm2 restart smartee-worker-staging || {
    log_warn "Failed to restart worker service (may not be running)"
}

# Wait for services to start
log_info "Waiting for services to start..."
sleep 5

# Health check
log_info "Running health check..."
HEALTH_CHECK_URL="http://localhost:3002/api/health"
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_CHECK_URL" || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    log_info "Health check passed ✓"
else
    log_error "Health check failed (HTTP $HEALTH_RESPONSE)"
    log_error "Rolling back deployment..."
    
    # Rollback
    cd "$APP_DIR"
    git reset --hard HEAD~1
    pm2 restart all
    
    exit 1
fi

# Show PM2 status
log_info "PM2 Process Status:"
pm2 list

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Deployment Details:"
echo "  - Timestamp: $TIMESTAMP"
echo "  - Commit: $COMMIT_HASH"
echo "  - Branch: $BRANCH"
echo "  - Backup: $BACKUP_DIR/smartee-staging-$TIMESTAMP.tar.gz"
echo ""
echo "Next Steps:"
echo "  - Monitor logs: pm2 logs smartee-api-staging"
echo "  - Check status: pm2 status"
echo "  - View app: http://staging.smartee.example.com"
echo ""

# Send notification (optional - uncomment if you have Slack webhook)
# SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
# curl -X POST -H 'Content-type: application/json' \
#     --data "{\"text\":\"✅ SmartEE Staging deployed successfully\n\nCommit: $COMMIT_HASH\nMessage: $COMMIT_MSG\"}" \
#     "$SLACK_WEBHOOK"

exit 0
