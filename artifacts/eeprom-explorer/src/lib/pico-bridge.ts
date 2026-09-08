// Talks to the pico-bridge bring-up firmware (firmware/pico-bridge) over Web
// Serial. There's no defined USB command protocol yet (see that project's
// README — CDC-vs-HID is still an open decision), so this is a walking
// skeleton: it reads the firmware's free-running human-readable bus-scan
// output and parses it, rather than requesting a scan on demand.

export type DetectedDevice = {
  // First I2C address (0x50-style, 7-bit) that ACKed in a contiguous run.
  startAddress: number;
  // How many consecutive addresses ACKed as part of the same device.
  addressCount: number;
  capacityBytes: number;
};

// Per the SaveKey Plus hardware notes: a larger EEPROM exposes itself over
// several consecutive I2C addresses, each covering a 64 KiB block — so N
// contiguous ACKing addresses means one physical device of N * 64 KiB.
const BYTES_PER_ADDRESS_BLOCK = 64 * 1024;

const BANNER_RE = /---\s*SaveKey Plus bridge: bus scan/;
const LINE_RE = /0x([0-9A-Fa-f]{2}):\s*(ACK|no response)/;

export function groupContiguousAddresses(ackedAddresses: number[]): DetectedDevice[] {
  const sorted = [...ackedAddresses].sort((a, b) => a - b);
  const devices: DetectedDevice[] = [];
  for (const address of sorted) {
    const last = devices[devices.length - 1];
    if (last && address === last.startAddress + last.addressCount) {
      last.addressCount += 1;
      last.capacityBytes += BYTES_PER_ADDRESS_BLOCK;
    } else {
      devices.push({ startAddress: address, addressCount: 1, capacityBytes: BYTES_PER_ADDRESS_BLOCK });
    }
  }
  return devices;
}

// Incrementally parses the firmware's repeating output:
//   --- SaveKey Plus bridge: bus scan ---
//     0x50: ACK (device present)
//     0x51: no response
//     ...
// A scan is considered complete (and reported) the moment the *next*
// banner line arrives, since the firmware never prints an explicit
// end-of-scan marker.
export class BusScanParser {
  private pending = '';
  private ackedAddresses: number[] = [];
  private sawBanner = false;

  constructor(private readonly onScanComplete: (devices: DetectedDevice[]) => void) {}

  feed(chunk: string): void {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    for (const rawLine of lines) {
      this.consumeLine(rawLine.trim());
    }
  }

  private consumeLine(line: string): void {
    if (!line) return;
    if (BANNER_RE.test(line)) {
      if (this.sawBanner) {
        this.onScanComplete(groupContiguousAddresses(this.ackedAddresses));
      }
      this.ackedAddresses = [];
      this.sawBanner = true;
      return;
    }
    const match = LINE_RE.exec(line);
    if (match && match[2] === 'ACK') {
      this.ackedAddresses.push(parseInt(match[1], 16));
    }
  }
}

export type PicoBridgeConnection = {
  disconnect: () => Promise<void>;
};

// Baud rate is meaningless for a USB-CDC virtual serial port, but the Web
// Serial API requires one to be supplied to open().
const CDC_BAUD_RATE = 115200;

export async function connectPicoBridge(
  onScanComplete: (devices: DetectedDevice[]) => void,
  onDisconnect: (error?: unknown) => void,
): Promise<PicoBridgeConnection> {
  if (!navigator.serial) {
    throw new Error('Web Serial is not supported in this browser (use Chrome or Edge).');
  }

  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: CDC_BAUD_RATE });

  const reader = port.readable?.getReader();
  if (!reader) {
    await port.close();
    throw new Error('Serial port has no readable stream.');
  }

  const parser = new BusScanParser(onScanComplete);
  const decoder = new TextDecoder();
  let cancelled = false;

  void (async () => {
    try {
      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (!cancelled) onDisconnect(error);
      return;
    } finally {
      reader.releaseLock();
    }
    if (!cancelled) onDisconnect();
  })();

  return {
    disconnect: async () => {
      cancelled = true;
      await reader.cancel().catch(() => {});
      await port.close().catch(() => {});
    },
  };
}
