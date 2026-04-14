#!/usr/bin/env bash
set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PSYCHEROS_REPO="https://github.com/zarilewis/Psycheros-alpha.git"
ENTITY_CORE_REPO="https://github.com/zarilewis/entity-core-alpha.git"

# --- Timezone detection ---
detect_timezone() {
  if [[ "$OSTYPE" == darwin* ]]; then
    readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || echo "UTC"
  elif [[ -f /etc/timezone ]]; then
    cat /etc/timezone
  elif [[ -L /etc/localtime ]]; then
    readlink /etc/localtime | sed 's|.*/zoneinfo/||'
  else
    echo "UTC"
  fi
}

echo -e "${CYAN}${BOLD}"
echo "  ====================================="
echo "    Psycheros Alpha Installer"
echo "  ====================================="
echo -e "${NC}"
echo ""

# --- Step 1: Check prerequisites ---
echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"

# Git
if ! command -v git &> /dev/null; then
  echo -e "${RED}  Git is not installed.${NC}"
  if [[ "$OSTYPE" == darwin* ]]; then
    echo -e "  Install it with: ${BOLD}xcode-select --install${NC}"
  else
    echo -e "  Install it via your package manager (apt, dnf, pacman, etc.)"
  fi
  exit 1
fi
echo -e "  Git: $(git --version | head -1)"

# Deno
if command -v deno &> /dev/null; then
  echo -e "  Deno: $(deno --version 2>/dev/null | head -1)"
else
  echo -e "  Deno not found. Installing..."
  curl -fsSL https://deno.land/install.sh | sh
  export DENO_DIR="${DENO_DIR:-$HOME/.deno}"
  export PATH="$DENO_DIR/bin:$PATH"

  if ! command -v deno &> /dev/null; then
    echo -e "${RED}  Deno installation failed.${NC}"
    echo "  Please install manually: https://deno.land"
    exit 1
  fi
  echo -e "  ${GREEN}Deno installed successfully.${NC}"
  echo -e "${YELLOW}  If 'deno' isn't found after restarting your terminal, add to your shell profile:"
  echo "    export DENO_DIR=\"\$HOME/.deno\""
  echo "    export PATH=\"\$DENO_DIR/bin:\$PATH\"${NC}"
fi
echo ""

# --- Step 2: Install directory ---
DEFAULT_DIR="$HOME/psycheros"
echo -e "${YELLOW}[2/4] Choose install location${NC}"
read -rp "  Install directory? [$DEFAULT_DIR]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_DIR}"
INSTALL_DIR="${INSTALL_DIR%/}"
mkdir -p "$INSTALL_DIR"
echo -e "  ${GREEN}Using: $INSTALL_DIR${NC}"
echo ""

# --- Step 3: Clone repos ---
echo -e "${YELLOW}[3/4] Downloading Psycheros and entity-core...${NC}"

clone_repo() {
  local name="$1"
  local url="$2"
  local target="$INSTALL_DIR/$name"

  if [[ -d "$target/.git" ]]; then
    echo -e "  ${CYAN}$name${NC} — already exists, updating..."
    git -C "$target" pull --ff-only
  else
    echo -e "  Cloning ${CYAN}$name${NC}..."
    if ! git clone "$url" "$target" 2>&1; then
      echo -e "  ${RED}Could not clone $name. Check your internet connection and try again.${NC}"
      echo "  Manual command: git clone $url $target"
      exit 1
    fi
  fi
}

clone_repo "Psycheros" "$PSYCHEROS_REPO"
clone_repo "entity-core" "$ENTITY_CORE_REPO"
echo ""

# --- Step 4: Settings ---
echo -e "${YELLOW}[4/4] Configuration${NC}"
echo ""

DETECTED_TZ=$(detect_timezone)

read -rp "  Your name? [You]: " USER_NAME
USER_NAME="${USER_NAME:-You}"

read -rp "  Entity's name? [Assistant]: " ENTITY_NAME
ENTITY_NAME="${ENTITY_NAME:-Assistant}"

read -rp "  Timezone? [$DETECTED_TZ]: " TIMEZONE
TIMEZONE="${TIMEZONE:-$DETECTED_TZ}"

# Write settings
PSYCHEROS_DIR="$INSTALL_DIR/Psycheros"
mkdir -p "$PSYCHEROS_DIR/.psycheros"

cat > "$PSYCHEROS_DIR/.psycheros/general-settings.json" << SETTINGS
{
  "entityName": "${ENTITY_NAME}",
  "userName": "${USER_NAME}",
  "timezone": "${TIMEZONE}"
}
SETTINGS

echo -e "  ${GREEN}Settings saved.${NC}"

# Save dashboard state so the web launcher knows the install directory
printf '{"installDir": "%s"}\n' "$INSTALL_DIR" > "$HOME/.psycheros-launcher-state.json"
echo -e "  ${GREEN}Dashboard state saved.${NC}"
echo ""

# --- Generate launcher scripts ---
echo -e "${YELLOW}Creating launcher scripts...${NC}"

# start.sh
cat > "$INSTALL_DIR/start.sh" << 'START_EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/Psycheros"

echo ""
echo "Starting Psycheros..."
echo ""

# Open browser in background after a short delay
(sleep 3 && {
  if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 2>/dev/null
  elif command -v open &> /dev/null; then
    open http://localhost:3000 2>/dev/null
  fi
}) &

deno task start
START_EOF
chmod +x "$INSTALL_DIR/start.sh"

# stop.sh
cat > "$INSTALL_DIR/stop.sh" << 'STOP_EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/Psycheros"

echo "Stopping Psycheros..."
deno task stop 2>/dev/null || pkill -INT -f "deno.*main.ts" 2>/dev/null || true
echo "Done."
STOP_EOF
chmod +x "$INSTALL_DIR/stop.sh"

# update.sh
cat > "$INSTALL_DIR/update.sh" << 'UPDATE_EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "Updating Psycheros..."
git -C "$DIR/Psycheros" pull --ff-only

echo "Updating entity-core..."
git -C "$DIR/entity-core" pull --ff-only

echo ""
echo "Update complete! Run ./start.sh to launch."
echo ""
UPDATE_EOF
chmod +x "$INSTALL_DIR/update.sh"

echo -e "  ${GREEN}Done.${NC}"
echo ""

# --- All done ---
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo "  Your install directory:"
echo "    $INSTALL_DIR/"
echo "      Psycheros/      (main app)"
echo "      entity-core/    (entity memory & identity)"
echo "      start.sh        (launch Psycheros)"
echo "      stop.sh         (stop Psycheros)"
echo "      update.sh       (pull latest updates)"
echo ""
echo -e "  To get started:"
echo -e "    ${BOLD}cd $INSTALL_DIR && ./start.sh${NC}"
echo ""
echo "  On first run, Deno will download dependencies (this may take a moment)."
echo "  After that, open http://localhost:3000 and add your API key in Settings."
echo ""
