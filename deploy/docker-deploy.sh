#!/bin/bash
# =============================================================================
# Sub2API Docker Deployment Preparation Script (custom / GHCR)
# =============================================================================
# This script prepares deployment files for this fork's custom image channel:
#   - Downloads docker-compose.local.yml and .env.example from custom branch
#   - Generates secure secrets (JWT_SECRET, TOTP_ENCRYPTION_KEY, POSTGRES_PASSWORD)
#   - Uses floating custom as the default image (override with a custom-<short_sha> tag)
#   - Creates necessary data directories
#
# After running this script, you can start services with:
#   docker compose up -d
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Fork defaults (override before running the script if needed)
# ---------------------------------------------------------------------------
# GitHub owner/repo used for raw file downloads
GITHUB_REPO="${GITHUB_REPO:-Micah123321/sub2api}"
# Branch that carries deploy assets for this fork
GITHUB_REF="${GITHUB_REF:-custom}"
# Runtime image (must include tag). custom is the default deployment target.
DEFAULT_SUB2API_IMAGE="${SUB2API_IMAGE:-ghcr.io/micah123321/sub2api:custom}"
# GHCR repository without tag (used by in-app custom update channel)
DEFAULT_SUB2API_CUSTOM_IMAGE="${SUB2API_CUSTOM_IMAGE:-ghcr.io/micah123321/sub2api}"

GITHUB_RAW_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_REF}/deploy"

# Print colored message
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Generate random secret
generate_secret() {
    openssl rand -hex 32
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Cross-platform in-place sed for KEY=VALUE lines
set_env_var() {
    local key="$1"
    local value="$2"
    local file="$3"
    # Escape characters that break sed replacement (/, &, \)
    local escaped
    escaped=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')
    if sed --version >/dev/null 2>&1; then
        # GNU sed (Linux)
        sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
    else
        # BSD sed (macOS)
        sed -i '' "s|^${key}=.*|${key}=${escaped}|" "$file"
    fi
}

# Download helper (curl preferred)
download_file() {
    local url="$1"
    local dest="$2"
    if command_exists curl; then
        curl -fsSL "$url" -o "$dest"
    elif command_exists wget; then
        wget -q "$url" -O "$dest"
    else
        print_error "Neither curl nor wget is installed. Please install one of them."
        exit 1
    fi
}

# Main installation function
main() {
    echo ""
    echo "=========================================="
    echo "  Sub2API Custom Docker Deployment"
    echo "=========================================="
    echo ""
    print_info "Source: ${GITHUB_REPO}@${GITHUB_REF}"
    print_info "Image:  ${DEFAULT_SUB2API_IMAGE}"
    echo ""

    # Check if openssl is available
    if ! command_exists openssl; then
        print_error "openssl is not installed. Please install openssl first."
        exit 1
    fi

    # Check if deployment already exists
    if [ -f "docker-compose.yml" ] && [ -f ".env" ]; then
        print_warning "Deployment files already exist in current directory."
        read -p "Overwrite existing files? (y/N): " -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Cancelled."
            exit 0
        fi
    fi

    # Download docker-compose.local.yml and save as docker-compose.yml
    print_info "Downloading docker-compose.yml from ${GITHUB_REF}..."
    if ! download_file "${GITHUB_RAW_URL}/docker-compose.local.yml" "docker-compose.yml"; then
        print_error "Failed to download docker-compose.local.yml"
        print_error "URL: ${GITHUB_RAW_URL}/docker-compose.local.yml"
        exit 1
    fi
    print_success "Downloaded docker-compose.yml"

    # Download .env.example
    print_info "Downloading .env.example..."
    if ! download_file "${GITHUB_RAW_URL}/.env.example" ".env.example"; then
        print_error "Failed to download .env.example"
        print_error "URL: ${GITHUB_RAW_URL}/.env.example"
        exit 1
    fi
    print_success "Downloaded .env.example"

    # Generate .env file with auto-generated secrets
    print_info "Generating secure secrets and custom channel defaults..."
    echo ""

    JWT_SECRET=$(generate_secret)
    TOTP_ENCRYPTION_KEY=$(generate_secret)
    POSTGRES_PASSWORD=$(generate_secret)

    cp .env.example .env

    set_env_var "JWT_SECRET" "${JWT_SECRET}" .env
    set_env_var "TOTP_ENCRYPTION_KEY" "${TOTP_ENCRYPTION_KEY}" .env
    set_env_var "POSTGRES_PASSWORD" "${POSTGRES_PASSWORD}" .env
    set_env_var "SUB2API_IMAGE" "${DEFAULT_SUB2API_IMAGE}" .env
    set_env_var "SUB2API_CUSTOM_IMAGE" "${DEFAULT_SUB2API_CUSTOM_IMAGE}" .env
    set_env_var "APPLE_CONTAINER_SUB2API_IMAGE" "${DEFAULT_SUB2API_IMAGE}" .env
    set_env_var "SUB2API_UPDATE_METHOD" "docker" .env

    # Create data directories
    print_info "Creating data directories..."
    mkdir -p data postgres_data redis_data
    print_success "Created data directories"

    # Set secure permissions for .env file (readable/writable only by owner)
    chmod 600 .env
    echo ""

    # Display completion message
    echo "=========================================="
    echo "  Preparation Complete!"
    echo "=========================================="
    echo ""
    echo "Image channel (custom / GHCR):"
    echo "  SUB2API_IMAGE:         ${DEFAULT_SUB2API_IMAGE}"
    echo "  SUB2API_CUSTOM_IMAGE:  ${DEFAULT_SUB2API_CUSTOM_IMAGE}"
    echo ""
    echo "Generated secure credentials:"
    echo "  POSTGRES_PASSWORD:     ${POSTGRES_PASSWORD}"
    echo "  JWT_SECRET:            ${JWT_SECRET}"
    echo "  TOTP_ENCRYPTION_KEY:   ${TOTP_ENCRYPTION_KEY}"
    echo ""
    print_warning "These credentials have been saved to .env file."
    print_warning "Please keep them secure and do not share publicly!"
    echo ""
    if [ -n "${SUB2API_GHCR_TOKEN:-}" ]; then
        print_info "SUB2API_GHCR_TOKEN is set in the environment; add it to .env if packages are private."
    else
        print_info "If GHCR package is private, set SUB2API_GHCR_TOKEN in .env (read:packages)."
        print_info "  docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin"
    fi
    echo ""
    echo "Directory structure:"
    echo "  docker-compose.yml        - Docker Compose configuration (custom image)"
    echo "  .env                      - Environment variables (generated secrets)"
    echo "  .env.example              - Example template (for reference)"
    echo "  data/                     - Application data (will be created on first run)"
    echo "  postgres_data/            - PostgreSQL data"
    echo "  redis_data/               - Redis data"
    echo ""
    echo "Next steps:"
    echo "  1. (Optional) Edit .env — e.g. pin SUB2API_IMAGE=...:custom-<sha>"
    echo "  2. If package is private: docker login ghcr.io"
    echo "  3. Start services:"
    echo "     docker compose up -d"
    echo ""
    echo "  4. View logs:"
    echo "     docker compose logs -f sub2api"
    echo ""
    echo "  5. Access Web UI:"
    echo "     http://localhost:8080"
    echo ""
    echo "Upgrade (custom channel image):"
    echo "  docker compose pull"
    echo "  docker compose up -d"
    echo ""
    print_info "If admin password is not set in .env, it will be auto-generated."
    print_info "Check logs for the generated admin password on first startup."
    echo ""
}

# Run main function
main "$@"
