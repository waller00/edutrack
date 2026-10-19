#!/usr/bin/env bash
#
# install.sh — Instala el watchdog de contenedores de EduTrack en el host.
#
# Ejecutar como root desde el repo:
#   sudo ./deploy/systemd/install.sh
#
# Copia el script y las unidades, crea los directorios de estado y métricas,
# deja /etc/edutrack/watchdog.env en modo dry-run y habilita el timer.

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: ejecutar como root (sudo $0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/container-watchdog.sh"
UNIT_DIR="$ROOT/deploy/systemd"

[[ -f "$SCRIPT" ]] || { echo "ERROR: falta $SCRIPT" >&2; exit 1; }

install -m 0755 "$SCRIPT" /usr/local/bin/edutrack-container-watchdog.sh
install -m 0644 "$UNIT_DIR/edutrack-container-watchdog.service" /etc/systemd/system/
install -m 0644 "$UNIT_DIR/edutrack-container-watchdog.timer" /etc/systemd/system/
install -d -m 0755 /etc/edutrack /var/lib/edutrack-watchdog/state /var/lib/edutrack-watchdog/textfile

if [[ ! -f /etc/edutrack/watchdog.env ]]; then
  install -m 0640 "$UNIT_DIR/watchdog.env.example" /etc/edutrack/watchdog.env
  echo "Creado /etc/edutrack/watchdog.env con WATCHDOG_DRY_RUN=1."
  echo "Revisalo y pasalo a 0 cuando confirmes el comportamiento en los logs."
fi

systemctl daemon-reload
systemctl enable --now edutrack-container-watchdog.timer
systemctl start edutrack-container-watchdog.service || true

echo
echo "Instalado. Estado:"
echo "  systemctl status edutrack-container-watchdog.timer"
echo "  journalctl -u edutrack-container-watchdog -n 50 --no-pager"
echo
echo "Falta que node-exporter lea las metricas: reiniciar el stack de monitoring"
echo "con el volumen /var/lib/edutrack-watchdog/textfile montado."
