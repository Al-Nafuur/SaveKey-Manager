# pico-bridge

Firmware for the Raspberry Pi Pico (RP2040) that sits between the SaveKey Plus and the host running SaveKey-Manager.

Acts purely as a USB ↔ I²C bridge: it executes block-level read/write commands sent by the app and talks I²C to the SaveKey's EEPROM(s). It has no knowledge of the SaveKey allocation-list format or the TinyELF Basic filesystem — all layout/format logic lives in [artifacts/eeprom-explorer](../../artifacts/eeprom-explorer).

Not part of the pnpm workspace — this is a plain Pico SDK / CMake project (C), unrelated to the Node toolchain used elsewhere in this repo.

## Prototype wiring

I2C0 on the Pico's physical header pins 6/7, which are GPIO4 (SDA) and GPIO5 (SCL) — not GPIO6/GPIO7 (physical pin number ≠ GPIO number; that mix-up cost a long debugging session). Plus 3.3V and GND to the SaveKey Plus. See [src/i2c_bus.h](src/i2c_bus.h) if these ever change.

## Status

- [x] I²C driver: init, probe, write, read ([src/i2c_bus.c](src/i2c_bus.c))
- [x] Bring-up firmware ([src/main.c](src/main.c)): scans 0x50–0x57 every few seconds and prints the results over USB CDC (virtual COM port) — flash this now to sanity-check the wiring, no host app needed yet.
- [ ] USB command protocol (PING / GET_INFO / I2C_PROBE / I2C_READ / I2C_WRITE) — transport decided (below), protocol design itself still to do.
- [x] Desktop/browser-side transport: **CDC over Web Serial** (decided 2026-09-09)

### CDC vs HID — decided: CDC

Went with CDC/Web Serial, not HID, once the walking-skeleton test (see `artifacts/eeprom-explorer/src/lib/pico-bridge.ts`) proved it out on real hardware: connected fine, and correctly told apart the SaveKey Plus's two devices (0x50 + 0x54-0x57) from a normal single-EEPROM SaveKey after hotplugging. Deciding factor: CDC keeps debugging easy (any terminal program can watch the bring-up output directly), and the earlier concern about Web Serial being Chromium-only turned out to be a wash anyway — WebHID has the exact same restriction, so it bought nothing there. HID's zero-driver-install advantage stayed theoretical; CDC's debuggability is real and already paying off.

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
