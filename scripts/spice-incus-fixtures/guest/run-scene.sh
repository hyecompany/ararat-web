#!/usr/bin/env bash
# Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

set -euo pipefail

SCENARIO="${1:-initial-grid}"
GUI_USER=""
GUI_UID=""
ACTIVE_XORG_AUTH="$(ps -eo args | sed -n 's/.* -auth \([^ ]*\).*/\1/p' | head -n 1 || true)"
if [ -n "${ACTIVE_XORG_AUTH}" ] && [ -e "${ACTIVE_XORG_AUTH}" ]; then
  GUI_UID="$(stat -c '%u' "${ACTIVE_XORG_AUTH}" 2>/dev/null || true)"
  GUI_USER="$(getent passwd "${GUI_UID}" | cut -d: -f1 || true)"
fi
if [ -z "${GUI_UID}" ]; then
  ACTIVE_XORG_USER="$(ps -eo user,args | awk '/[X]org/ { print $1; exit }' || true)"
  if [ -n "${ACTIVE_XORG_USER}" ]; then
    GUI_USER="${ACTIVE_XORG_USER}"
    GUI_UID="$(id -u "${GUI_USER}" 2>/dev/null || true)"
  fi
fi
if [ -z "${GUI_UID}" ]; then
  GUI_UID="$(find /run/user -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -n | head -n 1 || true)"
  if [ -n "${GUI_UID}" ]; then
    GUI_USER="$(getent passwd "${GUI_UID}" | cut -d: -f1 || true)"
  fi
fi

if [ -n "${ARARAT_SPICE_E2E_STATE_DIR:-}" ]; then
  STATE_DIR="${ARARAT_SPICE_E2E_STATE_DIR}"
elif [ -n "${GUI_USER}" ] && [ "${GUI_USER}" != "gdm" ] && getent passwd "${GUI_USER}" | cut -d: -f6 | grep -q '^/home/'; then
  STATE_DIR="/home/${GUI_USER}/ararat-spice-e2e"
else
  STATE_DIR="/var/tmp/ararat-spice-e2e"
fi
XAUTHORITY_PATH="${XAUTHORITY:-${ACTIVE_XORG_AUTH}}"
if [ -z "${XAUTHORITY_PATH}" ] && [ -n "${GUI_UID}" ] && [ -d "/run/user/${GUI_UID}" ]; then
  XAUTHORITY_PATH="$(find "/run/user/${GUI_UID}" -maxdepth 1 -name '.mutter-Xwaylandauth.*' -print 2>/dev/null | sort | head -n 1 || true)"
fi
if [ -z "${XAUTHORITY_PATH}" ] && [ -n "${GUI_UID}" ] && [ -f "/run/user/${GUI_UID}/gdm/Xauthority" ]; then
  XAUTHORITY_PATH="/run/user/${GUI_UID}/gdm/Xauthority"
fi
if [ -z "${XAUTHORITY_PATH}" ] && [ -n "${GUI_USER}" ] && [ -f "/home/${GUI_USER}/.Xauthority" ]; then
  XAUTHORITY_PATH="/home/${GUI_USER}/.Xauthority"
fi
mkdir -p "${STATE_DIR}"
chmod 0777 "${STATE_DIR}"
rm -f "${STATE_DIR}/events.json" "${STATE_DIR}/x11-scene.json" "${STATE_DIR}/active-scenario.json" 2>/dev/null || true
rm -f /var/crash/* 2>/dev/null || true
systemctl stop apport.service whoopsie.service update-notifier.service 2>/dev/null || true
pkill -f 'apport-gtk|update-notifier|whoopsie|system-crash|gnome-abrt|zenity.*crash' 2>/dev/null || true

cat >"${STATE_DIR}/active-scenario.json" <<JSON
{
  "scenario": "${SCENARIO}",
  "startedAt": "$(date --iso-8601=seconds)",
  "display": "${DISPLAY:-}",
  "waylandDisplay": "${WAYLAND_DISPLAY:-}",
  "xauthority": "${XAUTHORITY_PATH}",
  "guiUser": "${GUI_USER}",
  "guiUid": "${GUI_UID}"
}
JSON

SCRIPT_DIR="$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  systemctl stop ararat-spice-e2e-scene.service 2>/dev/null || true
  systemctl reset-failed ararat-spice-e2e-scene.service 2>/dev/null || true
  pkill -f 'scene-driver.py --x11-scene|firefox|chromium|google-chrome|apport-gtk|update-notifier|whoopsie' 2>/dev/null || true
  if [ -n "${GUI_USER}" ] && [ "${GUI_USER}" != "gdm" ] && command -v runuser >/dev/null 2>&1; then
    chown -R "${GUI_USER}:${GUI_USER}" "${STATE_DIR}" || true
    runuser -u "${GUI_USER}" -- env \
      DISPLAY="${DISPLAY:-:0}" \
      WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}" \
      XAUTHORITY="${XAUTHORITY_PATH}" \
      XDG_RUNTIME_DIR="/run/user/${GUI_UID}" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${GUI_UID}/bus" \
      gsettings set com.ubuntu.update-notifier show-apport-crashes false 2>/dev/null || true
  fi
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run \
      --unit=ararat-spice-e2e-scene \
      --collect \
      --quiet \
      --property=Restart=no \
      --setenv=DISPLAY="${DISPLAY:-:0}" \
      --setenv=WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}" \
      --setenv=XAUTHORITY="${XAUTHORITY_PATH}" \
      --setenv=XDG_RUNTIME_DIR="${GUI_UID:+/run/user/${GUI_UID}}" \
      --setenv=DBUS_SESSION_BUS_ADDRESS="${GUI_UID:+unix:path=/run/user/${GUI_UID}/bus}" \
      --setenv=ARARAT_SPICE_E2E_GUI_USER="${GUI_USER}" \
      --setenv=ARARAT_SPICE_E2E_GUI_UID="${GUI_UID}" \
      --setenv=ARARAT_SPICE_E2E_XAUTHORITY="${XAUTHORITY_PATH}" \
      /usr/bin/python3 "${SCRIPT_DIR}/scene-driver.py" --x11-scene "${SCENARIO}" "${STATE_DIR}"
  else
    nohup env \
      DISPLAY="${DISPLAY:-:0}" \
      WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}" \
      XAUTHORITY="${XAUTHORITY_PATH}" \
      XDG_RUNTIME_DIR="${GUI_UID:+/run/user/${GUI_UID}}" \
      DBUS_SESSION_BUS_ADDRESS="${GUI_UID:+unix:path=/run/user/${GUI_UID}/bus}" \
      ARARAT_SPICE_E2E_GUI_USER="${GUI_USER}" \
      ARARAT_SPICE_E2E_GUI_UID="${GUI_UID}" \
      ARARAT_SPICE_E2E_XAUTHORITY="${XAUTHORITY_PATH}" \
      python3 "${SCRIPT_DIR}/scene-driver.py" --x11-scene "${SCENARIO}" "${STATE_DIR}" \
      >>"${STATE_DIR}/scene-driver.log" 2>&1 &
  fi
  env \
    DISPLAY="${DISPLAY:-:0}" \
    WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}" \
    XAUTHORITY="${XAUTHORITY_PATH}" \
    XDG_RUNTIME_DIR="${GUI_UID:+/run/user/${GUI_UID}}" \
    DBUS_SESSION_BUS_ADDRESS="${GUI_UID:+unix:path=/run/user/${GUI_UID}/bus}" \
    ARARAT_SPICE_E2E_GUI_USER="${GUI_USER}" \
    ARARAT_SPICE_E2E_GUI_UID="${GUI_UID}" \
    ARARAT_SPICE_E2E_XAUTHORITY="${XAUTHORITY_PATH}" \
    ARARAT_SPICE_E2E_CHILD_LOG="${STATE_DIR}/scene-driver.log" \
    ARARAT_SPICE_E2E_EXTERNAL_X11="1" \
    python3 "${SCRIPT_DIR}/scene-driver.py" "${SCENARIO}" "${STATE_DIR}"
else
  echo "{\"scenario\":\"${SCENARIO}\",\"status\":\"missing-python3\"}" >"${STATE_DIR}/events.json"
fi
