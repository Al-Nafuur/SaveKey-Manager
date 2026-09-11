// Talks to the PicoBridge firmware (firmware/pico-bridge) over Web Serial
// using its text-command protocol (see that project's README): PING, SCAN,
// READ <addr> <memaddr> <len>, WRITE <addr> <memaddr> <len> + raw bytes.

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

function toHex(value: number, length: number): string {
  return value.toString(16).padStart(length, '0');
}

// Reads a byte stream either line-by-line or in exact-length chunks,
// buffering whatever's left over between calls — needed because Web Serial
// hands back arbitrarily-sized chunks that don't line up with the
// protocol's own line/payload boundaries.
class ByteStreamReader {
  private buffer = new Uint8Array(0);

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(): Promise<boolean> {
    const { value, done } = await this.reader.read();
    if (done) return false;
    if (value && value.length > 0) {
      const merged = new Uint8Array(this.buffer.length + value.length);
      merged.set(this.buffer);
      merged.set(value, this.buffer.length);
      this.buffer = merged;
    }
    return true;
  }

  async readLine(): Promise<string> {
    for (;;) {
      const newlineIndex = this.buffer.indexOf(10); // '\n'
      if (newlineIndex !== -1) {
        const lineBytes = this.buffer.slice(0, newlineIndex);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        const text = new TextDecoder().decode(lineBytes);
        return text.endsWith('\r') ? text.slice(0, -1) : text;
      }
      if (!(await this.fill())) throw new Error('PicoBridge: port closed while waiting for a response.');
    }
  }

  async readExact(count: number): Promise<Uint8Array> {
    while (this.buffer.length < count) {
      if (!(await this.fill())) throw new Error('PicoBridge: port closed while waiting for data.');
    }
    const result = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return result;
  }
}

export class PicoBridge {
  private readonly streamReader: ByteStreamReader;
  private readonly textEncoder = new TextEncoder();
  // Serializes commands so concurrent calls (e.g. two buttons clicked at
  // once) can't interleave their command/response lines on the wire.
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly port: SerialPort,
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>,
  ) {
    this.streamReader = new ByteStreamReader(reader);
  }

  static async connect(): Promise<PicoBridge> {
    if (!navigator.serial) {
      throw new Error('Web Serial is not supported in this browser (use Chrome, Edge, or Firefox 151+).');
    }
    const port = await navigator.serial.requestPort();
    // Baud rate is meaningless for a USB-CDC virtual serial port, but Web
    // Serial requires one to be supplied to open().
    await port.open({ baudRate: 115200 });

    const reader = port.readable?.getReader();
    const writer = port.writable?.getWriter();
    if (!reader || !writer) {
      await port.close();
      throw new Error('Serial port has no readable/writable stream.');
    }
    return new PicoBridge(port, reader, writer);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async sendLine(line: string): Promise<void> {
    await this.writer.write(this.textEncoder.encode(`${line}\n`));
  }

  private async expectOk(): Promise<string> {
    const line = await this.streamReader.readLine();
    if (line.startsWith('ERR')) throw new Error(`PicoBridge: ${line}`);
    if (!line.startsWith('OK')) throw new Error(`PicoBridge: unexpected response "${line}"`);
    return line;
  }

  ping(): Promise<void> {
    return this.enqueue(async () => {
      await this.sendLine('PING');
      await this.expectOk();
    });
  }

  scan(): Promise<DetectedDevice[]> {
    return this.enqueue(async () => {
      await this.sendLine('SCAN');
      const acked: number[] = [];
      for (;;) {
        const line = await this.streamReader.readLine();
        if (line.startsWith('ACK ')) {
          acked.push(parseInt(line.slice(4), 16));
          continue;
        }
        if (line.startsWith('OK')) break;
        if (line.startsWith('ERR')) throw new Error(`PicoBridge: ${line}`);
        throw new Error(`PicoBridge: unexpected response "${line}"`);
      }
      return groupContiguousAddresses(acked);
    });
  }

  read(addr: number, memAddr: number, len: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      await this.sendLine(`READ ${toHex(addr, 2)} ${toHex(memAddr, 4)} ${len}`);
      const header = await this.expectOk();
      const declaredLen = Number(header.split(' ')[1]);
      if (!Number.isFinite(declaredLen)) throw new Error(`PicoBridge: bad READ response "${header}"`);
      return this.streamReader.readExact(declaredLen);
    });
  }

  write(addr: number, memAddr: number, data: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      await this.sendLine(`WRITE ${toHex(addr, 2)} ${toHex(memAddr, 4)} ${data.length}`);
      await this.writer.write(data);
      await this.expectOk();
    });
  }

  disconnect(): Promise<void> {
    return this.enqueue(async () => {
      await this.reader.cancel().catch(() => {});
      this.reader.releaseLock();
      this.writer.releaseLock();
      await this.port.close().catch(() => {});
    });
  }
}
