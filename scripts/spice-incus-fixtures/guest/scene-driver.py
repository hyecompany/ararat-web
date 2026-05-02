#!/usr/bin/env python3
# Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

"""
Guest-side deterministic scene driver for real-Incus SPICE e2e tests.

Golden VMs should install this directory at /opt/ararat-spice-e2e and expose
/opt/ararat-spice-e2e/run-scene.sh. The host runner intentionally treats this
as a black-box guest workload: it asks the guest to render or exercise a scene,
then validates the browser/client output externally.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
import ctypes
from pathlib import Path


if len(sys.argv) > 1 and sys.argv[1] == "--x11-scene":
    SCENARIO = sys.argv[2] if len(sys.argv) > 2 else "initial-grid"
    STATE_DIR = Path(sys.argv[3] if len(sys.argv) > 3 else "/tmp/ararat-spice-e2e")
else:
    SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "initial-grid"
    STATE_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/ararat-spice-e2e")
STATE_DIR.mkdir(parents=True, exist_ok=True)


def write_events(status: str, **extra: object) -> None:
    payload = {
        "scenario": SCENARIO,
        "status": status,
        "timestamp": time.time(),
        "guiUser": os.environ.get("ARARAT_SPICE_E2E_GUI_USER"),
        "guiUid": os.environ.get("ARARAT_SPICE_E2E_GUI_UID"),
        "display": os.environ.get("DISPLAY"),
        "waylandDisplay": os.environ.get("WAYLAND_DISPLAY"),
        "xauthority": os.environ.get("XAUTHORITY"),
        "xdgRuntimeDir": os.environ.get("XDG_RUNTIME_DIR"),
        **extra,
    }
    (STATE_DIR / "events.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def run_best_effort(command: list[str]) -> bool:
    try:
        subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True
    except Exception:
        return False


def start_background(command: list[str]) -> subprocess.Popen[bytes] | None:
    try:
        log_file = os.environ.get("ARARAT_SPICE_E2E_CHILD_LOG")
        log_handle = open(log_file, "ab", buffering=0) if log_file else subprocess.DEVNULL
        return subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    except Exception:
        return None


def wait_x11_scene_status(timeout: float = 8.0) -> dict[str, object]:
    state_path = STATE_DIR / "x11-scene.json"
    deadline = time.monotonic() + timeout
    latest: dict[str, object] = {"ok": False, "reason": "x11-scene-status-timeout"}
    while time.monotonic() < deadline:
        if state_path.exists():
            try:
                latest = json.loads(state_path.read_text(encoding="utf-8"))
            except Exception as error:
                latest = {"ok": False, "reason": f"x11-scene-status-unreadable: {error}"}
            if latest.get("ok") is True or latest.get("reason"):
                return latest
        time.sleep(0.1)
    return latest


def run_quiet(command: list[str]) -> bool:
    try:
        subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        return True
    except Exception:
        return False


class XKeyEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("root", ctypes.c_ulong),
        ("subwindow", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("x_root", ctypes.c_int),
        ("y_root", ctypes.c_int),
        ("state", ctypes.c_uint),
        ("keycode", ctypes.c_uint),
        ("same_screen", ctypes.c_int),
    ]


class XButtonEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("root", ctypes.c_ulong),
        ("subwindow", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("x_root", ctypes.c_int),
        ("y_root", ctypes.c_int),
        ("state", ctypes.c_uint),
        ("button", ctypes.c_uint),
        ("same_screen", ctypes.c_int),
    ]


class XMotionEvent(ctypes.Structure):
    _fields_ = XKeyEvent._fields_


class XEvent(ctypes.Union):
    _fields_ = [
        ("type", ctypes.c_int),
        ("xkey", XKeyEvent),
        ("xbutton", XButtonEvent),
        ("xmotion", XMotionEvent),
        ("pad", ctypes.c_long * 24),
    ]


class XSetWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("background_pixmap", ctypes.c_ulong),
        ("background_pixel", ctypes.c_ulong),
        ("border_pixmap", ctypes.c_ulong),
        ("border_pixel", ctypes.c_ulong),
        ("bit_gravity", ctypes.c_int),
        ("win_gravity", ctypes.c_int),
        ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong),
        ("backing_pixel", ctypes.c_ulong),
        ("save_under", ctypes.c_int),
        ("event_mask", ctypes.c_long),
        ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", ctypes.c_int),
        ("colormap", ctypes.c_ulong),
        ("cursor", ctypes.c_ulong),
    ]


def run_x11_scene(scene: str, state_dir: Path) -> int:
    try:
        x11 = ctypes.CDLL("libX11.so.6")
    except OSError as error:
        (state_dir / "x11-scene.json").write_text(
            json.dumps({"ok": False, "reason": f"libX11-unavailable: {error}"}, indent=2),
            encoding="utf-8",
        )
        return 2

    x_error_handler_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)

    @x_error_handler_type
    def ignore_x_error(_display: ctypes.c_void_p, _event: ctypes.c_void_p) -> int:
        return 0

    x11.XSetErrorHandler.argtypes = [x_error_handler_type]
    x11.XSetErrorHandler(ignore_x_error)
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultScreen.argtypes = [ctypes.c_void_p]
    x11.XDefaultScreen.restype = ctypes.c_int
    x11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XRootWindow.restype = ctypes.c_ulong
    x11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XCreateSimpleWindow.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_uint,
        ctypes.c_uint,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    x11.XCreateSimpleWindow.restype = ctypes.c_ulong
    x11.XChangeWindowAttributes.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.POINTER(XSetWindowAttributes),
    ]
    x11.XSelectInput.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_long]
    x11.XStoreName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_char_p]
    x11.XMapRaised.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XRaiseWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x11.XInternAtom.restype = ctypes.c_ulong
    x11.XChangeProperty.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_int,
    ]
    x11.XGrabKeyboard.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    x11.XGrabKeyboard.restype = ctypes.c_int
    x11.XGetInputFocus.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_int),
    ]
    x11.XCreateGC.restype = ctypes.c_void_p
    x11.XCreateGC.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
    x11.XSetForeground.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    x11.XFillRectangle.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_uint,
    ]
    x11.XCopyArea.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_int,
    ]
    x11.XDrawString.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
    ]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XPending.argtypes = [ctypes.c_void_p]
    x11.XPending.restype = ctypes.c_int
    x11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
    x11.XLookupString.argtypes = [
        ctypes.POINTER(XKeyEvent),
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    x11.XLookupString.restype = ctypes.c_int
    x11.XDefaultVisual.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDefaultVisual.restype = ctypes.c_void_p
    x11.XDefaultDepth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDefaultDepth.restype = ctypes.c_int
    x11.XCreateImage.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_int,
    ]
    x11.XCreateImage.restype = ctypes.c_void_p
    x11.XPutImage.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_uint,
    ]

    display = x11.XOpenDisplay(None)
    if not display:
        (state_dir / "x11-scene.json").write_text(
            json.dumps({"ok": False, "reason": "x11-display-unavailable"}, indent=2),
            encoding="utf-8",
        )
        return 3

    screen = x11.XDefaultScreen(display)
    root = x11.XRootWindow(display, screen)
    width = int(x11.XDisplayWidth(display, screen))
    height = int(x11.XDisplayHeight(display, screen))
    window = x11.XCreateSimpleWindow(display, root, 0, 0, width, height, 0, 0, 0x101018)
    attributes = XSetWindowAttributes()
    # Keep this managed by Mutter/Xwayland. Override-redirect windows stay on top,
    # but real SPICE keyboard events pass through the compositor focus model and
    # may never reach unmanaged Xwayland windows.
    attributes.override_redirect = 0
    attributes.event_mask = (
        0x00008000  # ExposureMask
        | 0x00000001  # KeyPressMask
        | 0x00000002  # KeyReleaseMask
        | 0x00000004  # ButtonPressMask
        | 0x00000008  # ButtonReleaseMask
        | 0x00000040  # PointerMotionMask
        | 0x00020000  # StructureNotifyMask
    )
    x11.XChangeWindowAttributes(display, window, 0x00000200 | 0x00000800, ctypes.byref(attributes))
    event_mask = (
        0x00008000  # ExposureMask
        | 0x00000001  # KeyPressMask
        | 0x00000002  # KeyReleaseMask
        | 0x00000004  # ButtonPressMask
        | 0x00000008  # ButtonReleaseMask
        | 0x00000040  # PointerMotionMask
        | 0x00020000  # StructureNotifyMask
    )
    x11.XSelectInput(display, window, event_mask)
    x11.XStoreName(display, window, f"Ararat SPICE E2E {scene}".encode())
    atom_type = 4  # XA_ATOM
    wm_state = x11.XInternAtom(display, b"_NET_WM_STATE", 0)
    wm_state_fullscreen = x11.XInternAtom(display, b"_NET_WM_STATE_FULLSCREEN", 0)
    wm_state_above = x11.XInternAtom(display, b"_NET_WM_STATE_ABOVE", 0)
    states = (ctypes.c_ulong * 2)(wm_state_fullscreen, wm_state_above)
    x11.XChangeProperty(
        display,
        window,
        wm_state,
        atom_type,
        32,
        0,
        ctypes.cast(states, ctypes.c_void_p),
        2,
    )
    x11.XMapRaised(display, window)
    x11.XFlush(display)
    time.sleep(0.2)
    x11.XSetInputFocus(display, window, 2, 0)
    x11.XGrabKeyboard(display, window, 1, 1, 1, 0)
    gc = x11.XCreateGC(display, window, 0, None)
    visual = x11.XDefaultVisual(display, screen)
    depth = x11.XDefaultDepth(display, screen)
    z_pixmap = 2
    image_cache: dict[tuple[int, int], tuple[bytearray, object, ctypes.c_void_p]] = {}

    events: list[dict[str, object]] = []
    typed = ""

    def pixel(red: int, green: int, blue: int) -> int:
        return (red << 16) | (green << 8) | blue

    def set_color(red: int, green: int, blue: int) -> None:
        x11.XSetForeground(display, gc, pixel(red, green, blue))

    def rect(x: int, y: int, w: int, h: int, color: tuple[int, int, int]) -> None:
        set_color(*color)
        x11.XFillRectangle(display, window, gc, int(x), int(y), int(w), int(h))

    def text(x: int, y: int, value: str, color: tuple[int, int, int] = (255, 255, 255)) -> None:
        set_color(*color)
        data = value.encode("utf-8", "replace")
        x11.XDrawString(display, window, gc, int(x), int(y), data, len(data))

    def marker(x: int, y: int, color: tuple[int, int, int], label: str, text_color=(255, 255, 255)) -> None:
        rect(x, y, 124, 124, (255, 255, 255))
        rect(x + 6, y + 6, 112, 112, color)
        text(x + 42, y + 68, label, text_color)

    def grid_background_region(x: int, y: int, w: int, h: int) -> None:
        x0 = max(0, int(x))
        y0 = max(0, int(y))
        x1 = min(width, int(x + w))
        y1 = min(height, int(y + h))
        if x1 <= x0 or y1 <= y0:
            return
        rect(x0, y0, x1 - x0, y1 - y0, (27, 28, 42))
        start_x = (x0 // 64) * 64
        for gx in range(start_x, x1 + 1, 64):
            if gx >= x0:
                rect(gx, y0, 1, y1 - y0, (54, 56, 76))
        start_y = (y0 // 64) * 64
        for gy in range(start_y, y1 + 1, 64):
            if gy >= y0:
                rect(x0, gy, x1 - x0, 1, (54, 56, 76))

    def draw_static_landmarks_overlay(scene_label: str, frame: int = 0) -> None:
        marker(170, 24, (220, 32, 32), "TL")
        marker(max(0, width - 144), 24, (224, 192, 48), "TR", (17, 17, 17))
        marker(24, max(0, height - 144), (32, 92, 220), "BL")
        marker(max(0, width - 144), max(0, height - 144), (208, 32, 200), "BR")
        cx = max(0, width // 2 - 90)
        cy = max(0, height // 2 - 90)
        rect(cx - 10, cy - 10, 200, 200, (242, 242, 242))
        rect(cx, cy, 180, 180, (36, 180, 80))
        text(cx + 50, cy + 96, "CENTER", (5, 20, 10))
        label_x = max(0, width // 2 - 170)
        rect(label_x, 28, min(420, max(1, width - label_x)), 34, (27, 28, 42))
        text(label_x + 8, 52, f"{scene_label.upper()} {frame}", (255, 255, 255))

    def draw_static_landmarks(scene_label: str, frame: int = 0) -> None:
        grid_background_region(0, 0, width, height)
        draw_static_landmarks_overlay(scene_label, frame)

    def subtract_rect(
        base: tuple[int, int, int, int],
        cut: tuple[int, int, int, int],
    ) -> list[tuple[int, int, int, int]]:
        bx, by, bw, bh = base
        cx, cy, cw, ch = cut
        bx1 = bx + bw
        by1 = by + bh
        cx1 = cx + cw
        cy1 = cy + ch
        ix0 = max(bx, cx)
        iy0 = max(by, cy)
        ix1 = min(bx1, cx1)
        iy1 = min(by1, cy1)
        if ix1 <= ix0 or iy1 <= iy0:
            return [base]
        pieces: list[tuple[int, int, int, int]] = []
        if by < iy0:
            pieces.append((bx, by, bw, iy0 - by))
        if iy1 < by1:
            pieces.append((bx, iy1, bw, by1 - iy1))
        if bx < ix0:
            pieces.append((bx, iy0, ix0 - bx, iy1 - iy0))
        if ix1 < bx1:
            pieces.append((ix1, iy0, bx1 - ix1, iy1 - iy0))
        return [piece for piece in pieces if piece[2] > 0 and piece[3] > 0]

    def restore_grid_excluding_landmarks(x: int, y: int, w: int, h: int) -> None:
        pending: list[tuple[int, int, int, int]] = [
            (
                max(0, int(x)),
                max(0, int(y)),
                max(0, min(width, int(x + w)) - max(0, int(x))),
                max(0, min(height, int(y + h)) - max(0, int(y))),
            )
        ]
        cx = max(0, width // 2 - 90)
        cy = max(0, height // 2 - 90)
        label_x = max(0, width // 2 - 170)
        protected = [
            (170, 24, 124, 124),
            (max(0, width - 144), 24, 124, 124),
            (24, max(0, height - 144), 124, 124),
            (max(0, width - 144), max(0, height - 144), 124, 124),
            (cx - 10, cy - 10, 200, 200),
            (label_x, 28, min(420, max(1, width - label_x)), 34),
        ]
        for protected_rect in protected:
            next_pending: list[tuple[int, int, int, int]] = []
            for piece in pending:
                next_pending.extend(subtract_rect(piece, protected_rect))
            pending = next_pending
        for piece_x, piece_y, piece_w, piece_h in pending:
            grid_background_region(piece_x, piece_y, piece_w, piece_h)

    def image_for_size(area_w: int, area_h: int) -> tuple[bytearray, object, ctypes.c_void_p] | None:
        key = (area_w, area_h)
        cached = image_cache.get(key)
        if cached:
            return cached
        byte_length = area_w * area_h * 4
        storage = bytearray(byte_length)
        c_array = (ctypes.c_char * byte_length).from_buffer(storage)
        image = x11.XCreateImage(
            display,
            visual,
            depth,
            z_pixmap,
            0,
            ctypes.cast(c_array, ctypes.c_void_p),
            area_w,
            area_h,
            32,
            area_w * 4,
        )
        if not image:
            return None
        cached = (storage, c_array, image)
        image_cache[key] = cached
        return cached

    def fill_large_video_image(storage: bytearray, area_w: int, area_h: int, frame: int) -> None:
        tile_w = max(8, area_w // 64)
        tile_h = max(8, area_h // 36)
        rows = math.ceil(area_h / tile_h)
        cols = math.ceil(area_w / tile_w)
        for row in range(rows):
            y0 = row * tile_h
            y1 = min(area_h, y0 + tile_h)
            for col in range(cols):
                x0 = col * tile_w
                x1 = min(area_w, x0 + tile_w)
                red = (col * 37 + row * 17 + frame * 11) % 256
                green = (col * 13 + row * 43 + frame * 7) % 256
                blue = (col * 29 + row * 23 + frame * 19) % 256
                if (row + col + frame) % 11 == 0:
                    red = 255 - red
                    green = 255 - green
                segment = bytes((blue, green, red, 0)) * max(0, x1 - x0)
                for y in range(y0, y1):
                    offset = (y * area_w + x0) * 4
                    storage[offset : offset + len(segment)] = segment

    def draw_large_video_area(frame: int, elapsed: float) -> dict[str, object]:
        phase = int(elapsed / 4.0) % 3
        requested_sizes = ((640, 360), (960, 540), (1152, 648))
        requested_w, requested_h = requested_sizes[phase]
        if phase == 2:
            area_w = min(width - 80, requested_w)
            area_h = min(height - 72, int(area_w * 9 / 16))
            if area_h > height - 72:
                area_h = height - 72
                area_w = int(area_h * 16 / 9)
        else:
            area_w = min(requested_w, max(320, width - 120))
            area_h = min(requested_h, max(180, height - 120))
        area_w = max(320, area_w)
        area_h = max(180, area_h)
        area_x = max(0, (width - area_w) // 2)
        area_y = max(0, (height - area_h) // 2)
        rect(area_x - 10, area_y - 10, area_w + 20, area_h + 20, (248, 250, 252))
        rect(area_x - 4, area_y - 4, area_w + 8, area_h + 8, (2, 6, 23))
        image_entry = image_for_size(area_w, area_h)
        if image_entry:
            storage, _c_array, image = image_entry
            fill_large_video_image(storage, area_w, area_h, frame)
            x11.XPutImage(display, window, gc, image, 0, 0, area_x, area_y, area_w, area_h)
        else:
            rect(area_x, area_y, area_w, area_h, ((frame * 11) % 256, 42, 190))
        pulse_x = area_x + ((frame * 23) % max(1, area_w - 120))
        pulse_y = area_y + ((frame * 17) % max(1, area_h - 80))
        rect(pulse_x, pulse_y, 120, 80, (255, 255, 255))
        rect(pulse_x + 6, pulse_y + 6, 108, 68, ((frame * 5) % 256, 20, 220))
        controls_y = area_y + area_h - 44
        rect(area_x, controls_y, area_w, 44, (8, 13, 24))
        progress_w = max(24, int((area_w - 120) * ((frame % 180) / 179)))
        rect(area_x + 72, controls_y + 18, area_w - 120, 8, (71, 85, 105))
        rect(area_x + 72, controls_y + 18, progress_w, 8, (239, 68, 68))
        rect(area_x + 24, controls_y + 13, 18, 18, (248, 250, 252))
        text(area_x + 24, area_y + 28, f"LARGE VIDEO {area_w}x{area_h} {frame}", (255, 255, 255))
        return {
            "x": area_x,
            "y": area_y,
            "width": area_w,
            "height": area_h,
            "label": f"{area_w}x{area_h}",
        }

    def read_clipboard_text() -> str:
        commands = (
            ["xclip", "-selection", "clipboard", "-o"],
            ["xsel", "--clipboard", "--output"],
            ["wl-paste", "--no-newline"],
        )
        env = os.environ.copy()
        for command in commands:
            try:
                completed = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    env=env,
                    check=True,
                    timeout=2,
                )
                return completed.stdout.decode("utf-8", "replace")
            except Exception:
                continue
        return ""

    active_area_state: dict[str, object] | None = None
    actual_frame_count = 0

    def write_scene_state(status: str, frame: int = 0) -> None:
        focus_window = ctypes.c_ulong(0)
        focus_revert = ctypes.c_int(0)
        try:
            x11.XGetInputFocus(display, ctypes.byref(focus_window), ctypes.byref(focus_revert))
        except Exception:
            focus_window.value = 0
        (state_dir / "x11-scene.json").write_text(
            json.dumps(
                {
                    "ok": True,
                    "driver": "x11-scene-foreground-window",
                    "scenario": scene,
                    "status": status,
                    "width": width,
                    "height": height,
                    "frame": frame,
                    "fpsTarget": target_fps,
                    "actualFrameCount": actual_frame_count,
                    "droppedFramesEstimate": max(0, frame - actual_frame_count),
                    "activeArea": active_area_state,
                    "windowId": int(window),
                    "rootWindowId": int(root),
                    "isRootWindow": int(window) == int(root),
                    "inputFocusWindowId": int(focus_window.value),
                    "inputFocused": int(focus_window.value) == int(window),
                    "typed": typed,
                    "eventCount": len(events),
                    "events": events[-80:],
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    start = time.monotonic()
    last_state_write = 0.0
    last_clipboard_poll = 0.0
    last_clipboard_value = ""
    scroll_copy_initialized = False
    scroll_copy_last_frame = -1
    scroll_copy_row = 0
    scroll_colors = [(254, 240, 138), (134, 239, 172), (147, 197, 253), (240, 171, 252)]
    initial_grid_drawn = False
    delayed_reveal_drawn = False
    fast_motion_initialized = False
    fast_motion_last_frame = -1
    fast_motion_dirty_rects: list[tuple[int, int, int, int]] = []
    large_video_initialized = False
    large_video_last_frame = -1
    large_video_last_area: dict[str, object] | None = None
    target_fps = 60 if scene in {"scroll-copy", "fast-motion", "video-motion", "large-area-video", "cursor-stress", "drag-selection", "window-drag"} else 30
    while True:
        while x11.XPending(display) > 0:
            event = XEvent()
            x11.XNextEvent(display, ctypes.byref(event))
            if event.type == 2:
                buffer = ctypes.create_string_buffer(16)
                length = x11.XLookupString(ctypes.byref(event.xkey), buffer, 15, None, None)
                value = buffer.raw[: max(0, length)].decode("utf-8", "ignore")
                clipboard_value = ""
                if value == "\x16":
                    clipboard_value = read_clipboard_text()
                    if clipboard_value:
                        typed += clipboard_value
                elif value:
                    typed += value
                events.append({
                    "type": "key",
                    "x": event.xkey.x,
                    "y": event.xkey.y,
                    "value": value,
                    "clipboardValue": clipboard_value,
                    "state": event.xkey.state,
                    "at": time.monotonic() - start,
                })
            elif event.type in (4, 5):
                events.append({"type": "button", "x": event.xbutton.x, "y": event.xbutton.y, "button": event.xbutton.button, "at": time.monotonic() - start})
            elif event.type == 6:
                events.append({"type": "pointer", "x": event.xmotion.x, "y": event.xmotion.y, "at": time.monotonic() - start})

        elapsed = time.monotonic() - start
        if scene == "clipboard-client-to-guest" and elapsed - last_clipboard_poll > 0.25:
            last_clipboard_poll = elapsed
            clipboard_value = read_clipboard_text()
            if clipboard_value and clipboard_value != last_clipboard_value:
                last_clipboard_value = clipboard_value
                events.append({
                    "type": "clipboard-poll",
                    "value": clipboard_value,
                    "length": len(clipboard_value),
                    "at": elapsed,
                })
                if "ararat-" in clipboard_value and clipboard_value not in typed:
                    typed += clipboard_value
        frame = int(elapsed * target_fps)
        actual_frame_count += 1
        active_area_state = None
        if frame % 10 == 0:
            x11.XRaiseWindow(display, window)
            x11.XSetInputFocus(display, window, 2, 0)
            x11.XGrabKeyboard(display, window, 1, 1, 1, 0)
        if scene == "scroll-copy":
            panel_w = min(420, max(300, width // 3))
            panel_h = min(420, max(240, height - 260))
            panel_x = max(170, width - panel_w - 120)
            panel_y = min(max(140, height // 4), max(140, height - panel_h - 120))
            row_h = 36
            if not scroll_copy_initialized:
                rect(0, 0, width, height, (27, 28, 42))
                for x in range(0, width, 64):
                    rect(x, 0, 1, height, (54, 56, 76))
                for y in range(0, height, 64):
                    rect(0, y, width, 1, (54, 56, 76))
                marker(170, 24, (220, 32, 32), "TL")
                marker(max(0, width - 144), 24, (224, 192, 48), "TR", (17, 17, 17))
                marker(24, max(0, height - 144), (32, 92, 220), "BL")
                marker(max(0, width - 144), max(0, height - 144), (208, 32, 200), "BR")
                cx = max(0, width // 2 - 90)
                cy = max(0, height // 2 - 90)
                rect(cx - 10, cy - 10, 200, 200, (242, 242, 242))
                rect(cx, cy, 180, 180, (36, 180, 80))
                text(cx + 50, cy + 96, "CENTER", (5, 20, 10))
                rect(panel_x - 6, panel_y - 6, panel_w + 12, panel_h + 12, (248, 250, 252))
                rect(panel_x, panel_y, panel_w, panel_h, (15, 23, 42))
                for index in range(math.ceil(panel_h / row_h)):
                    row_y = panel_y + index * row_h
                    row_height = max(1, min(row_h - 2, panel_y + panel_h - row_y))
                    color = scroll_colors[index % len(scroll_colors)]
                    rect(panel_x, row_y, panel_w, row_height, color)
                    text(panel_x + 14, row_y + 24, f"COPYBITS ROW {index:03d}", (15, 23, 42))
                scroll_copy_initialized = True
            if frame != scroll_copy_last_frame:
                scroll_copy_last_frame = frame
                x11.XCopyArea(
                    display,
                    window,
                    window,
                    gc,
                    panel_x,
                    panel_y + row_h,
                    panel_w,
                    max(1, panel_h - row_h),
                    panel_x,
                    panel_y,
                )
                bottom_y = panel_y + panel_h - row_h
                color = scroll_colors[scroll_copy_row % len(scroll_colors)]
                rect(panel_x, bottom_y, panel_w, min(row_h, panel_y + panel_h - bottom_y), color)
                text(panel_x + 14, bottom_y + 24, f"COPYBITS ROW {scroll_copy_row + 64:03d}", (15, 23, 42))
                rect(max(0, width // 2 - 150), 28, 300, 32, (27, 28, 42))
                text(max(0, width // 2 - 145), 52, f"SCROLL-COPY {frame}", (255, 255, 255))
                scroll_copy_row += 1
        elif scene == "fast-motion":
            if not fast_motion_initialized:
                draw_static_landmarks(scene, frame)
                fast_motion_initialized = True
            if frame != fast_motion_last_frame:
                for dirty_x, dirty_y, dirty_w, dirty_h in fast_motion_dirty_rects:
                    grid_background_region(dirty_x - 8, dirty_y - 8, dirty_w + 16, dirty_h + 16)

                primary_w = min(max(160, 220 + ((frame * 7) % 180)), max(96, width - 420))
                primary_h = min(max(90, 96 + ((frame * 5) % 110)), max(72, height - 330))
                primary_range = max(1, width - primary_w - 380)
                primary_x = min(max(0, 320 + ((frame * 19) % primary_range)), max(0, width - primary_w - 1))
                primary_y_base = 165 + int(78 * math.sin(frame / 7))
                primary_y = min(max(150, primary_y_base), max(80, height - primary_h - 190))

                strip_w = 54
                strip_h = max(120, min(height - 300, 360))
                strip_range = max(1, width - strip_w - 420)
                strip_x = min(max(0, 220 + ((frame * 13) % strip_range)), max(0, width - strip_w - 1))
                strip_y = max(160, min(height - strip_h - 180, 210))

                lower_w = 220
                lower_h = 58
                lower_range = max(1, width - lower_w - 420)
                lower_x = min(max(0, 300 + ((frame * 29) % lower_range)), max(0, width - lower_w - 1))
                lower_y = max(80, height - 220)

                pulse_w = 96
                pulse_h = 96
                pulse_range = max(1, width - pulse_w - 520)
                pulse_x = min(max(0, 420 + ((frame * 37) % pulse_range)), max(0, width - pulse_w - 1))
                pulse_y = max(110, min(height - pulse_h - 240, 260 + int(70 * math.cos(frame / 5))))

                rect(primary_x, primary_y, primary_w, primary_h, ((frame * 47) % 255, 214, 232))
                rect(primary_x + 10, primary_y + 10, max(1, primary_w - 20), max(1, primary_h - 20), ((frame * 23) % 255, 42, 190))
                text(primary_x + 18, primary_y + 42, f"MOTION {frame}", (255, 255, 255))
                rect(strip_x, strip_y, strip_w, strip_h, (42, 86, 154))
                rect(strip_x + 8, strip_y + ((frame * 9) % max(1, strip_h - 72)), max(1, strip_w - 16), 72, (147, 197, 253))
                rect(lower_x, lower_y, lower_w, lower_h, (112, 43, 91))
                rect(lower_x + 8, lower_y + 8, max(1, lower_w - 16), max(1, lower_h - 16), ((frame * 17) % 255, 79, 216))
                rect(pulse_x, pulse_y, pulse_w, pulse_h, (255, 255, 255))
                rect(pulse_x + 8, pulse_y + 8, max(1, pulse_w - 16), max(1, pulse_h - 16), (14, 165, 233))

                fast_motion_dirty_rects = [
                    (primary_x, primary_y, primary_w, primary_h),
                    (strip_x, strip_y, strip_w, strip_h),
                    (lower_x, lower_y, lower_w, lower_h),
                    (pulse_x, pulse_y, pulse_w, pulse_h),
                    (max(0, width // 2 - 170), 28, min(420, max(1, width - max(0, width // 2 - 170))), 34),
                ]
                draw_static_landmarks_overlay(scene, frame)
                active_area_state = {
                    "x": primary_x,
                    "y": primary_y,
                    "width": primary_w,
                    "height": primary_h,
                    "label": "dirty-motion",
                }
                fast_motion_last_frame = frame
        elif scene == "large-area-video":
            if not large_video_initialized:
                draw_static_landmarks(scene, frame)
                large_video_initialized = True
            if frame != large_video_last_frame:
                if large_video_last_area:
                    last_x = int(large_video_last_area.get("x", 0))
                    last_y = int(large_video_last_area.get("y", 0))
                    last_w = int(large_video_last_area.get("width", 0))
                    last_h = int(large_video_last_area.get("height", 0))
                    restore_grid_excluding_landmarks(last_x - 16, last_y - 16, last_w + 32, last_h + 76)
                active_area_state = draw_large_video_area(frame, elapsed)
                draw_static_landmarks_overlay(scene, frame)
                large_video_last_area = active_area_state
                large_video_last_frame = frame
        elif scene == "delayed-reveal" and elapsed < 2.6:
            if not delayed_reveal_drawn:
                rect(0, 0, width, height, (0, 0, 0))
                text(width // 2 - 130, height // 2, "DELAYED REVEAL", (255, 255, 255))
        elif scene == "initial-grid" and initial_grid_drawn:
            pass
        else:
            rect(0, 0, width, height, (27, 28, 42))
            for x in range(0, width, 64):
                rect(x, 0, 1, height, (54, 56, 76))
            for y in range(0, height, 64):
                rect(0, y, width, 1, (54, 56, 76))
            marker(170, 24, (220, 32, 32), "TL")
            marker(max(0, width - 144), 24, (224, 192, 48), "TR", (17, 17, 17))
            marker(24, max(0, height - 144), (32, 92, 220), "BL")
            marker(max(0, width - 144), max(0, height - 144), (208, 32, 200), "BR")
            cx = max(0, width // 2 - 90)
            cy = max(0, height // 2 - 90)
            rect(cx - 10, cy - 10, 200, 200, (242, 242, 242))
            rect(cx, cy, 180, 180, (36, 180, 80))
            text(cx + 50, cy + 96, "CENTER", (5, 20, 10))
            text(width // 2 - 120, 52, f"{scene.upper()} {frame}", (255, 255, 255))
            motion_x = 260 + ((frame * 17) % max(220, width - 540))
            motion_y = 180 + int(120 * math.sin(frame / 10))
            if scene in {"damage-strips", "drag-selection", "window-drag", "fast-motion", "video-motion", "cursor-stress"}:
                rect(motion_x, motion_y, 180 + ((frame * 7) % 180), 80 + ((frame * 5) % 120), ((frame * 47) % 255, 214, 232))
                rect(170 + ((frame * 11) % max(180, width - 360)), 150, 48, max(100, height - 300), (42, 86, 154))
                rect(260 + ((frame * 13) % max(180, width - 430)), 88, 56, max(120, height - 200), (112, 43, 91))
            if scene == "large-area-video":
                active_area_state = draw_large_video_area(frame, elapsed)
                marker(170, 24, (220, 32, 32), "TL")
                marker(max(0, width - 144), 24, (224, 192, 48), "TR", (17, 17, 17))
                marker(24, max(0, height - 144), (32, 92, 220), "BL")
                marker(max(0, width - 144), max(0, height - 144), (208, 32, 200), "BR")
            if scene == "drag-selection":
                rect(motion_x - 30, motion_y - 20, 320, 190, (22, 136, 255))
            if scene == "window-drag":
                rect(motion_x, motion_y, 360, 220, (17, 24, 39))
                rect(motion_x + 6, motion_y + 44, 348, 170, (246, 247, 251))
                rect(motion_x + 6, motion_y + 6, 348, 38, (37, 99, 235))
            if scene == "scroll-copy":
                for index in range(16):
                    row_y = 150 + index * 36 - ((frame * 8) % 72)
                    color = [(254, 240, 138), (134, 239, 172), (147, 197, 253), (240, 171, 252)][index % 4]
                    rect(width - 430, row_y, 300, 34, color)
                    text(width - 415, row_y + 23, f"COPYBITS ROW {index:02d}", (15, 23, 42))
            if scene == "palette-cache":
                colors = [(239, 68, 68), (249, 115, 22), (234, 179, 8), (34, 197, 94), (6, 182, 212), (59, 130, 246), (139, 92, 246), (236, 72, 153)]
                for index in range(32):
                    x = 260 + (index % 8) * 78
                    y = 120 + (index // 8) * 78
                    rect(x, y, 70, 70, (255, 255, 255))
                    rect(x + 5, y + 5, 60, 60, colors[(index + frame) % len(colors)])
            if scene == "mask-rop":
                rect(330, 110, 600, 390, (239 if frame % 2 else 16, 68 if frame % 2 else 187, 68 if frame % 2 else 190))
            if scene in {"click-keyboard", "clipboard-client-to-guest", "clipboard-guest-to-client"}:
                success = "ararat-" in typed
                rect(180, 90, 560, 70, (34, 197, 94) if success else (2, 6, 23))
                text(198, 132, typed[-42:] or "INPUT TARGET", (248, 250, 252))
            if scene == "initial-grid":
                initial_grid_drawn = True
            if scene == "delayed-reveal":
                delayed_reveal_drawn = True
        x11.XFlush(display)
        if time.monotonic() - last_state_write > 0.5:
            write_scene_state("running", frame)
            last_state_write = time.monotonic()
        time.sleep(1 / target_fps)


def prepare_firefox_profile() -> Path:
    profile = STATE_DIR / "firefox-profile"
    profile.mkdir(parents=True, exist_ok=True)
    for lock_name in (".parentlock", "lock"):
        try:
            (profile / lock_name).unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass
    (profile / "prefs.js").write_text(
        "\n".join(
            [
                'user_pref("app.normandy.enabled", false);',
                'user_pref("browser.aboutConfig.showWarning", false);',
                'user_pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);',
                'user_pref("browser.crashReports.unsubmittedCheck.enabled", false);',
                'user_pref("browser.shell.checkDefaultBrowser", false);',
                'user_pref("browser.sessionstore.resume_from_crash", false);',
                'user_pref("browser.startup.homepage_override.mstone", "ignore");',
                'user_pref("datareporting.healthreport.uploadEnabled", false);',
                'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
                'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
                "",
            ]
        ),
        encoding="utf-8",
    )
    return profile


def html_for_scene(scene: str) -> str:
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ararat SPICE E2E {scene}</title>
  <style>
    html, body {{
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #101018;
      cursor: crosshair;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }}
    #stage {{
      width: 100vw;
      height: 100vh;
      position: relative;
      background:
        linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 64px 64px,
        linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 64px 64px,
        #1b1c2a;
    }}
    .marker {{
      position: absolute;
      width: 120px;
      height: 120px;
      display: grid;
      place-items: center;
      color: white;
      font-size: 18px;
      font-weight: 700;
      border: 6px solid white;
      box-sizing: border-box;
    }}
    #tl {{ left: 170px; top: 24px; background: #dc2020; }}
    #tr {{ right: 24px; top: 24px; background: #e0c030; color: #111; }}
    #bl {{ left: 24px; bottom: 24px; background: #205cdc; }}
    #br {{ right: 24px; bottom: 24px; background: #d020c8; }}
    #center {{
      position: absolute;
      left: calc(50% - 90px);
      top: calc(50% - 90px);
      width: 180px;
      height: 180px;
      border-radius: 0;
      background: #24b450;
      border: 10px solid #f2f2f2;
      color: #05140a;
      display: grid;
      place-items: center;
      font-size: 22px;
      font-weight: 900;
    }}
    #motion {{
      position: absolute;
      left: 180px;
      top: 180px;
      width: 180px;
      height: 96px;
      background: #31d6e8;
      border: 8px solid #ffffff;
      box-sizing: border-box;
    }}
    #video-canvas {{
      position: absolute;
      left: calc(50% - 320px);
      top: calc(50% - 180px);
      width: 640px;
      height: 360px;
      display: none;
      border: 10px solid #f8fafc;
      background: #020617;
      box-sizing: border-box;
    }}
    #window {{
      position: absolute;
      left: 360px;
      top: 120px;
      width: 360px;
      height: 220px;
      background: #f6f7fb;
      color: #111827;
      border: 6px solid #111827;
      box-shadow: 18px 18px 0 rgba(0,0,0,0.35);
      display: none;
    }}
    #window-title {{
      height: 38px;
      background: #2563eb;
      color: white;
      display: flex;
      align-items: center;
      padding-left: 14px;
      font-weight: 900;
    }}
    #window-body {{
      padding: 16px;
      font-size: 18px;
      line-height: 1.4;
    }}
    #scroll-panel {{
      position: absolute;
      right: 170px;
      top: 150px;
      width: 280px;
      height: 360px;
      overflow: hidden;
      border: 6px solid #f8fafc;
      background: #0f172a;
      display: none;
    }}
    #scroll-content {{
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
    }}
    .row {{
      height: 36px;
      display: flex;
      align-items: center;
      padding-left: 12px;
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
    }}
    .row:nth-child(4n+1) {{ background: #fef08a; }}
    .row:nth-child(4n+2) {{ background: #86efac; }}
    .row:nth-child(4n+3) {{ background: #93c5fd; }}
    .row:nth-child(4n+4) {{ background: #f0abfc; }}
    #palette {{
      position: absolute;
      left: 250px;
      top: 110px;
      width: 640px;
      display: none;
      grid-template-columns: repeat(8, 72px);
      gap: 12px;
    }}
    .swatch {{
      width: 72px;
      height: 72px;
      border: 5px solid white;
      box-sizing: border-box;
    }}
    #mask {{
      position: absolute;
      left: 260px;
      top: 120px;
      width: 640px;
      height: 360px;
      display: none;
      background:
        radial-gradient(circle at 30% 45%, rgba(255,255,255,0.95) 0 70px, transparent 72px),
        radial-gradient(circle at 62% 45%, rgba(255,255,255,0.95) 0 70px, transparent 72px),
        linear-gradient(135deg, #ef4444 0 25%, #22c55e 25% 50%, #3b82f6 50% 75%, #eab308 75%);
      clip-path: polygon(8% 10%, 92% 10%, 78% 92%, 22% 92%);
      border: 8px solid white;
    }}
    #selection {{
      position: absolute;
      display: none;
      border: 2px solid #1688ff;
      background: rgba(22, 136, 255, 0.28);
    }}
    #log {{
      position: absolute;
      left: 180px;
      bottom: 30px;
      color: #ffffff;
      background: rgba(0,0,0,0.72);
      padding: 12px 16px;
      font-size: 18px;
    }}
    #input {{
      position: absolute;
      left: 180px;
      top: 90px;
      width: 560px;
      height: 70px;
      display: none;
      border: 6px solid #f8fafc;
      background: #020617;
      color: #f8fafc;
      font: 24px ui-monospace, SFMono-Regular, Consolas, monospace;
      padding: 8px 12px;
      box-sizing: border-box;
    }}
    #cover {{
      position: absolute;
      inset: 0;
      display: none;
      place-items: center;
      background: #000;
      color: #fff;
      font-size: 44px;
      font-weight: 900;
      z-index: 10;
    }}
  </style>
</head>
<body>
  <div id="stage">
    <div id="tl" class="marker">TL</div>
    <div id="tr" class="marker">TR</div>
    <div id="bl" class="marker">BL</div>
    <div id="br" class="marker">BR</div>
    <div id="center">CENTER</div>
    <div id="motion"></div>
    <canvas id="video-canvas" width="640" height="360"></canvas>
    <div id="window">
      <div id="window-title">WINDOW DRAG</div>
      <div id="window-body">Uncovered regions must restore cleanly. No stale rectangles.</div>
    </div>
    <div id="scroll-panel"><div id="scroll-content"></div></div>
    <div id="palette"></div>
    <div id="mask">MASK ROP</div>
    <div id="selection"></div>
    <textarea id="input" spellcheck="false"></textarea>
    <div id="log">{scene}</div>
    <div id="cover">DELAYED REVEAL</div>
  </div>
  <script>
    const scene = {json.dumps(scene)};
    const events = [];
    const expectedClipboard = 'ararat-' + scene;
    const stage = document.getElementById('stage');
    const log = document.getElementById('log');
    const motion = document.getElementById('motion');
    const videoCanvas = document.getElementById('video-canvas');
    const videoContext = videoCanvas.getContext('2d');
    const selection = document.getElementById('selection');
    const windowBox = document.getElementById('window');
    const scrollPanel = document.getElementById('scroll-panel');
    const scrollContent = document.getElementById('scroll-content');
    const palette = document.getElementById('palette');
    const mask = document.getElementById('mask');
    const input = document.getElementById('input');
    const cover = document.getElementById('cover');
    for (let index = 0; index < 36; index++) {{
      const row = document.createElement('div');
      row.className = 'row';
      row.textContent = 'COPYBITS ROW ' + String(index).padStart(2, '0');
      scrollContent.appendChild(row);
    }}
    for (let index = 0; index < 32; index++) {{
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.dataset.index = String(index);
      palette.appendChild(swatch);
    }}
    if (scene === 'delayed-reveal') {{
      cover.style.display = 'grid';
      setTimeout(() => {{
        cover.style.display = 'none';
        record('reveal', {{ scene }});
      }}, 2600);
    }}
    if (scene === 'window-drag') {{
      windowBox.style.display = 'block';
    }}
    if (scene === 'scroll-copy') {{
      scrollPanel.style.display = 'block';
    }}
    if (scene === 'palette-cache') {{
      palette.style.display = 'grid';
    }}
    if (scene === 'mask-rop') {{
      mask.style.display = 'grid';
      mask.style.placeItems = 'center';
      mask.style.color = '#020617';
      mask.style.font = '900 42px ui-monospace, SFMono-Regular, Consolas, monospace';
    }}
    if (scene === 'large-area-video') {{
      videoCanvas.style.display = 'block';
      motion.style.display = 'none';
    }}
    if (scene === 'click-keyboard' || scene.startsWith('clipboard')) {{
      input.style.display = 'block';
      input.focus();
    }}
    input.addEventListener('input', () => {{
      record('input', {{ value: input.value }});
      if (input.value.includes(expectedClipboard) || input.value.includes('ararat-click-keyboard')) {{
        input.style.borderColor = '#22c55e';
        input.style.background = '#052e16';
      }}
    }});
    function record(type, data) {{
      events.push({{ type, data, at: performance.now() }});
      log.textContent = scene + ' ' + type + ' ' + Math.round(performance.now());
      document.title = 'Ararat SPICE E2E ' + scene + ' ' + events.length;
      window.__araratSpiceEvents = events;
    }}
    addEventListener('pointermove', (event) => record('pointermove', {{ x: event.clientX, y: event.clientY }}));
    addEventListener('pointerdown', (event) => record('pointerdown', {{ x: event.clientX, y: event.clientY, button: event.button }}));
    addEventListener('pointerup', (event) => record('pointerup', {{ x: event.clientX, y: event.clientY, button: event.button }}));
    addEventListener('keydown', (event) => record('keydown', {{ key: event.key, code: event.code }}));
    let frame = 0;
    function animate() {{
      frame++;
      const w = innerWidth;
      const h = innerHeight;
      if (scene === 'fast-motion' || scene === 'video-motion') {{
        motion.style.left = (60 + ((frame * 17) % Math.max(200, w - 280))) + 'px';
        motion.style.top = (100 + Math.floor(90 * Math.sin(frame / 4))) + 'px';
        motion.style.background = 'rgb(' + ((frame * 17) % 255) + ',214,232)';
      }}
      if (scene === 'large-area-video' && videoContext) {{
        const sizes = [[640, 360], [960, 540], [Math.min(1152, w - 80), Math.min(648, h - 72)]];
        const selected = sizes[Math.floor(performance.now() / 4000) % sizes.length];
        const areaW = Math.max(320, selected[0]);
        const areaH = Math.max(180, selected[1]);
        videoCanvas.width = areaW;
        videoCanvas.height = areaH;
        videoCanvas.style.width = areaW + 'px';
        videoCanvas.style.height = areaH + 'px';
        videoCanvas.style.left = Math.floor((w - areaW) / 2) + 'px';
        videoCanvas.style.top = Math.floor((h - areaH) / 2) + 'px';
        const tileW = Math.max(12, Math.floor(areaW / 48));
        const tileH = Math.max(12, Math.floor(areaH / 27));
        for (let y = 0; y < areaH; y += tileH) {{
          for (let x = 0; x < areaW; x += tileW) {{
            const col = Math.floor(x / tileW);
            const row = Math.floor(y / tileH);
            const red = (col * 37 + row * 17 + frame * 11) % 256;
            const green = (col * 13 + row * 43 + frame * 7) % 256;
            const blue = (col * 29 + row * 23 + frame * 19) % 256;
            videoContext.fillStyle = 'rgb(' + red + ',' + green + ',' + blue + ')';
            videoContext.fillRect(x, y, tileW, tileH);
          }}
        }}
        videoContext.fillStyle = 'rgba(8,13,24,0.94)';
        videoContext.fillRect(0, areaH - 44, areaW, 44);
        videoContext.fillStyle = '#ef4444';
        videoContext.fillRect(72, areaH - 26, Math.max(24, ((frame % 180) / 179) * (areaW - 120)), 8);
        videoContext.fillStyle = '#ffffff';
        videoContext.font = '24px ui-monospace, SFMono-Regular, Consolas, monospace';
        videoContext.fillText('LARGE VIDEO ' + areaW + 'x' + areaH + ' ' + frame, 24, 32);
      }}
      if (scene === 'damage-strips' || scene === 'scroll-copy') {{
        stage.style.backgroundPosition = (frame * 11) + 'px ' + (frame * 3) + 'px';
      }}
      if (scene === 'damage-strips') {{
        motion.style.left = (80 + ((frame * 31) % Math.max(200, w - 280))) + 'px';
        motion.style.top = (80 + ((frame * 13) % Math.max(160, h - 220))) + 'px';
        motion.style.width = (80 + ((frame * 17) % 260)) + 'px';
        motion.style.height = (36 + ((frame * 11) % 170)) + 'px';
        motion.style.background = frame % 2 ? '#fb7185' : '#38bdf8';
      }}
      if (scene === 'drag-selection') {{
        selection.style.display = 'block';
        selection.style.left = (80 + ((frame * 9) % Math.max(180, w - 360))) + 'px';
        selection.style.top = (90 + ((frame * 5) % Math.max(140, h - 280))) + 'px';
        selection.style.width = (180 + ((frame * 7) % 240)) + 'px';
        selection.style.height = (120 + ((frame * 3) % 180)) + 'px';
      }}
      if (scene === 'cursor-stress') {{
        document.body.style.cursor = frame % 2 ? 'crosshair' : 'default';
        motion.style.left = (innerWidth / 2 + Math.floor(120 * Math.sin(frame / 8))) + 'px';
      }}
      if (scene === 'window-drag') {{
        windowBox.style.left = (120 + ((frame * 15) % Math.max(240, w - 520))) + 'px';
        windowBox.style.top = (80 + Math.floor(130 * (1 + Math.sin(frame / 10)))) + 'px';
      }}
      if (scene === 'scroll-copy') {{
        scrollContent.style.top = (-((frame * 13) % 720)) + 'px';
      }}
      if (scene === 'palette-cache') {{
        const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
        for (const swatch of palette.children) {{
          const index = Number(swatch.dataset.index || 0);
          swatch.style.background = colors[(index + frame) % colors.length];
        }}
      }}
      if (scene === 'mask-rop') {{
        mask.style.filter = frame % 2 ? 'invert(0)' : 'invert(1)';
      }}
      requestAnimationFrame(animate);
    }}
    record('ready', {{ scene }});
    animate();
  </script>
</body>
</html>
"""


def main() -> None:
    html_path = STATE_DIR / f"{SCENARIO}.html"
    html_path.write_text(html_for_scene(SCENARIO), encoding="utf-8")
    write_events("ready", html=str(html_path))
    firefox_profile = prepare_firefox_profile()
    external_x11 = os.environ.get("ARARAT_SPICE_E2E_EXTERNAL_X11") == "1"
    x11_process = True
    if not external_x11:
        x11_process = start_background([
            sys.executable,
            str(Path(__file__).resolve()),
            "--x11-scene",
            SCENARIO,
            str(STATE_DIR),
        ]) is not None
    x11_status = wait_x11_scene_status() if x11_process else {
        "ok": False,
        "reason": "x11-scene-process-launch-failed",
    }

    allow_browser_fallback = os.environ.get("ARARAT_SPICE_E2E_ALLOW_BROWSER_FALLBACK") == "1"
    browsers = [] if x11_status.get("ok") is True or not allow_browser_fallback else [
        ["google-chrome", "--new-window", "--kiosk", f"file://{html_path}"],
        ["chromium", "--new-window", "--kiosk", f"file://{html_path}"],
        [
            "env",
            "MOZ_CRASHREPORTER_DISABLE=1",
            "MOZ_CRASHREPORTER_SHUTDOWN=1",
            "MOZ_DISABLE_CRASHREPORTER=1",
            "NO_AT_BRIDGE=1",
            "firefox",
            "--new-instance",
            "--no-remote",
            "--profile",
            str(firefox_profile),
            "--kiosk",
            f"file://{html_path}",
        ],
        ["firefox", "--new-window", f"file://{html_path}"],
        ["xdg-open", f"file://{html_path}"],
    ]
    launched = False
    for command in browsers:
        if run_best_effort(command):
            launched = True
            break

    if SCENARIO == "audio-sine":
        # Best effort: generate a short tone through common Linux audio tools.
        sample_rate = 44100
        frequency = 440.0
        wav = STATE_DIR / "audio-sine.wav"
        import wave
        with wave.open(str(wav), "w") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            frames = bytearray()
            for index in range(sample_rate * 3):
                value = int(12000 * math.sin(2 * math.pi * frequency * index / sample_rate))
                frames += value.to_bytes(2, "little", signed=True)
                frames += value.to_bytes(2, "little", signed=True)
            output.writeframes(frames)
        for command in (["paplay", str(wav)], ["aplay", str(wav)]):
            if run_best_effort(command):
                break

    write_events(
        "launched",
        html=str(html_path),
        x11SceneProcess=x11_process is not None,
        x11SceneReady=x11_status.get("ok") is True,
        x11SceneStatus=x11_status,
        browserLaunched=launched,
        driver="x11-scene" if x11_status.get("ok") is True else "x11-scene-unavailable",
    )
    time.sleep(1)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--x11-scene":
        SCENARIO = sys.argv[2] if len(sys.argv) > 2 else "initial-grid"
        STATE_DIR = Path(sys.argv[3] if len(sys.argv) > 3 else "/tmp/ararat-spice-e2e")
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        raise SystemExit(run_x11_scene(SCENARIO, STATE_DIR))
    main()
