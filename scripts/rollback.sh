#!/bin/bash
# SmartEE Web - Rollback Script
# Usage: ./scripts/rollback.sh [backup-file or commit-hash]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
APP_DIR="/var/www/smartee-staging"
BACKUP_DIR="/var/backups/smartee"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo -e "${YELLOW}⚠️  SmartEE Web - Rollback Procedure${NC}"
echo "================================================"

# Check if argument provided
if [ -z "$1" ]; then
    log_info "No argument provided. Available options:"
    echo ""
    echo "1. Rollback to previous Git commit:"
    echo "   ./scripts/rollback.sh git"
    echo ""
    echo "2. Rollback to specific backup:"
    echo "   ./scripts/rollback.sh <backup-filename>"
    echo ""
    echo "Available backups:"
    ls -lht "$BACKUP_DIR"/smartee-staging-*.tar.gz 2>/dev/null | head -5 || echo "No backups found"
    exit 0
fi

# Confirm rollback
read -p "Are you sure you want to rollback? This will stop the application. (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    log_info "Rollback cancelled"
    exit 0
fi

cd "$APP_DIR"

# Git rollback
if [ "$1" = "git" ]; then
    log_info "Rolling back to previous Git commit..."
    
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    log_info "Current commit: $CURRENT_COMMIT"
    
    git log --oneline -n 5
    echo ""
    read -p "Enter commit hash to rollback to (or press Enter for previous commit): " COMMIT_HASH
    
    if [ -z "$COMMIT_HASH" ]; then
        COMMIT_HASH="HEAD~1"
    fi
    
    log_info "Rolling back to: $COMMIT_HASH"
    git checkout "$COMMIT_HASH"
    
    log_info "Reinstalling dependencies..."
    cd server && npm ci --production --silent
    cd ../client && npm ci --silent && npm run build
    
    log_info "Restarting services..."
    pm2 restart all
    
    log_info "Rollback completed ✓"
    
# Backup file rollback
else
    BACKUP_FILE="$1"
    
    # If only filename provided, prepend backup directory
    if [[ "$BACKUP_FILE" != /* ]]; then
        BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
    fi
    
    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
    
    log_info "Rolling back from backup: $BACKUP_FILE"
    
    # Stop services
    log_info "Stopping services..."
    pm2 stop all || log_warn "Failed to stop some services"
    
    # Create emergency backup of current state
    EMERGENCY_BACKUP="$BACKUP_DIR/emergency-backup-$(date +%Y%m%d_%H%M%S).tar.gz"
    log_info "Creating emergency backup: $EMERGENCY_BACKUP"
    tar -czf "$EMERGENCY_BACKUP" \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='logs' \
        --exclude='dist' \
        -C "$APP_DIR" . || log_warn "Emergency backup failed"
    
    # Remove current files (except .env and logs)
    log_info "Removing current files..."
    find "$APP_DIR" -mindepth 1 -maxdepth 1 \
        ! -name '.env' \
        ! -name 'logs' \
        ! -name '.git' \
        -exec rm -rf {} + || log_error "Failed to remove files"
    
    # Extract backup
    log_info "Extracting backup..."
    tar -xzf "$BACKUP_FILE" -C "$APP_DIR" || {
        log_error "Failed to extract backup"
        exit 1
    }
    
    # Reinstall dependencies
    log_info "Reinstalling dependencies..."
    cd "$APP_DIR/server" && npm ci --production --silent
    cd "$APP_DIR/client" && npm ci --silent && npm run build
    
    # Restart services
    log_info "Restarting services..."
    pm2 restart all
    
    log_info "Rollback completed ✓"
fi

# Health check
sleep 5
log_info "Running health check..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3002/api/health" || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
    log_info "Health check passed ✓"
else
    log_error "Health check failed (HTTP $HEALTH_RESPONSE)"
    log_error "Please check logs: pm2 logs"
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}Rollback procedure completed${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Check application status:"
echo "  - PM2 status: pm2 status"
echo "  - View logs: pm2 logs"
echo ""

exit 0
