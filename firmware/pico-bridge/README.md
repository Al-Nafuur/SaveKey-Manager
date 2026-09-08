# pico-bridge

Firmware for the Raspberry Pi Pico (RP2040) that sits between the SaveKey Plus and the host running SaveKey-Manager.

Acts purely as a USB ↔ I²C bridge: it executes block-level read/write commands sent by the app and talks I²C to the SaveKey's EEPROM(s). It has no knowledge of the SaveKey allocation-list format or the TinyELF Basic filesystem — all layout/format logic lives in [artifacts/eeprom-explorer](../../artifacts/eeprom-explorer).

Not part of the pnpm workspace — this is a plain Pico SDK / CMake project (C), unrelated to the Node toolchain used elsewhere in this repo.

## Prototype wiring

I2C0 on the Pico's physical header pins 6/7, which are GPIO4 (SDA) and GPIO5 (SCL) — not GPIO6/GPIO7 (physical pin number ≠ GPIO number; that mix-up cost a long debugging session). Plus 3.3V and GND to the SaveKey Plus. See [src/i2c_bus.h](src/i2c_bus.h) if these ever change.

## Status

- [x] I²C driver: init, probe, write, read ([src/i2c_bus.c](src/i2c_bus.c))
- [x] Bring-up firmware ([src/main.c](src/main.c)): scans 0x50–0x57 every few seconds and prints the results over USB CDC (virtual COM port) — flash this now to sanity-check the wiring, no host app needed yet.
- [ ] USB command protocol (PING / GET_INFO / I2C_PROBE / I2C_READ / I2C_WRITE) — pending a CDC-vs-HID decision, see below.
- [ ] Desktop/browser-side transport (Web Serial vs WebHID)

### CDC vs HID (open decision)

Not yet decided. Trade-offs as of 2026-09-08:

Client is confirmed to be a plain browser PWA hosted on GitHub Pages (no Electron/Tauri wrapper) — so **both** transports are equally constrained: Web Serial and WebHID are each Chromium-only (Chrome/Edge/Opera), unsupported in Firefox and Safari. That's a fixed cost either way, not a differentiator between CDC and HID.

- **CDC** (virtual COM port, what the bring-up firmware uses today): easy to debug with any terminal program (PuTTY, `screen`, ...) — no custom tooling needed. On Windows, USB-CDC-ACM generally works via the inbox driver on Windows 10+, but is more prone to edge cases (misbehaving descriptors, locked-down corporate machines blocking driver installs) than HID.
- **HID**: zero driver installation ever, on any OS — same class as keyboards/mice, the most plug-and-play option for non-technical users. Downside: packets capped at 64 bytes per report, so bulk EEPROM reads (e.g. a 256 KiB dump) need app-level chunking — more protocol code, though not a real performance problem at these data sizes. Also harder to debug ad-hoc (no generic terminal tool).

Given the confirmed all-browser-PWA architecture and a PC-focused, non-technical user base, HID's zero-driver-friction is the stronger argument — but not yet finalized. Revisit and pick one before implementing the USB command protocol.

## Building

Easiest path: install the **"Raspberry Pi Pico"** extension in VS Code — it offers to install the SDK and toolchain for you, then "Compile" / "Run" build and flash this project directly (open this `firmware/pico-bridge` folder as the project root).

Manual CLI build (requires the [pico-sdk](https://github.com/raspberrypi/pico-sdk) and an `arm-none-eabi` toolchain installed separately):

```
export PICO_SDK_PATH=/path/to/pico-sdk   # or PowerShell: $env:PICO_SDK_PATH = "..."
mkdir build && cd build
cmake -G Ninja ..
ninja
```

This produces `build/pico_bridge.uf2`. Hold the Pico's BOOTSEL button while plugging it in (it mounts as a USB mass-storage drive), then copy `pico_bridge.uf2` onto it — it flashes and reboots automatically.

To watch the bring-up output, open the Pico's USB serial port (any baud rate — it's a virtual CDC port, not real UART) in a terminal program (PuTTY, `screen`, the Arduino IDE's Serial Monitor, etc.).
