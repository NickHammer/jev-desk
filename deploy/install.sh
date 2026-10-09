#!/usr/bin/env bash
# Installs the 15-minute timer. Run it as your normal user (it asks for sudo itself):
#     bash deploy/install.sh
set -euo pipefail
if [ "$(id -u)" = "0" ]; then
  echo "Run this as your normal user, not with sudo. It will ask for sudo when needed."
  exit 1
fi
DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
[ -x "$DIR/.venv/bin/python" ] || { echo "No .venv in $DIR. Create it first (see README)."; exit 1; }
[ -f "$DIR/.env" ] || { echo "No .env in $DIR. Add your keys first."; exit 1; }
chmod +x "$DIR/run_all.sh"

echo "Installing for user '$USER_NAME' with the project in $DIR"
for unit in jev-desk.service jev-desk.timer; do
  sed -e "s|__USER__|$USER_NAME|g" -e "s|__DIR__|$DIR|g" "$DIR/deploy/$unit" \
    | sudo tee "/etc/systemd/system/$unit" > /dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now jev-desk.timer

echo
systemctl list-timers jev-desk.timer --no-pager
echo
echo "Installed. Watch it live:   journalctl -u jev-desk -f"
echo "Run one cycle right now:    sudo systemctl start jev-desk.service"
echo "Stop it for good:           sudo systemctl disable --now jev-desk.timer"
