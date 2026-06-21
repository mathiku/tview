#!/usr/bin/env bash
# Setup bot-trader as user systemd services on Ubuntu 24 (or similar).
# Usage: bash deploy/install-ubuntu.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${USER}"
HOME_DIR="${HOME}"
NODE_MIN=20

echo "=== Bot Trader — Ubuntu install ==="
echo "Project: ${ROOT}"
echo "User:    ${USER_NAME}"
echo ""

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p process.versions.node.split('.')[0])" -lt "${NODE_MIN}" ]]; then
  echo "Installing Node.js ${NODE_MIN}…"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN}.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node $(node -v)"
echo "Installing npm dependencies…"
cd "${ROOT}"
npm install

mkdir -p "${HOME_DIR}/.config/systemd/user"

install_unit() {
  local src="$1" dest="$2"
  sed \
    -e "s|%i|${USER_NAME}|g" \
    -e "s|%h|${HOME_DIR}|g" \
    -e "s|WorkingDirectory=.*|WorkingDirectory=${ROOT}|g" \
    "${src}" > "${dest}"
}

install_unit "${ROOT}/deploy/bot-trader-paper.service" "${HOME_DIR}/.config/systemd/user/bot-trader-paper.service"
install_unit "${ROOT}/deploy/bot-trader-dashboard.service" "${HOME_DIR}/.config/systemd/user/bot-trader-dashboard.service"

systemctl --user daemon-reload
systemctl --user enable bot-trader-paper.service bot-trader-dashboard.service
systemctl --user restart bot-trader-paper.service bot-trader-dashboard.service

# Run services after logout (headless laptop)
sudo loginctl enable-linger "${USER_NAME}" 2>/dev/null || true

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo ""
echo "=== Done ==="
echo "Paper bot:   systemctl --user status bot-trader-paper"
echo "Dashboard:   systemctl --user status bot-trader-dashboard"
echo ""
echo "View logs:   journalctl --user -u bot-trader-paper -f"
echo "Local UI:    http://127.0.0.1:5051"
if [[ -n "${LAN_IP}" ]]; then
  echo "LAN UI:      http://${LAN_IP}:5051  (from other devices on your network)"
fi
echo ""
echo "Disable laptop sleep:"
echo "  Settings → Power → Automatic Suspend → Off (on battery & plugged in)"
