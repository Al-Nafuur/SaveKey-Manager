// The only two operations the filesystem/page routines in lib/ need from the
// thing they talk to. PicoBridge (real hardware over Web Serial) satisfies it
// structurally; EepromImage below is the other implementation — an emulator's
// SaveKey/AtariVox EEPROM file held in memory, so FORMAT, SAVE, LOAD and the
// hex editors work on it unchanged.

import type { DetectedDevice } from './pico-bridge';

export interface EepromBus {
  read(addr: number, memAddr: number, len: number): Promise<Uint8Array>;
  write(addr: number, memAddr: number, data: Uint8Array): Promise<void>;
}

const BLOCK_BYTES = 0x10000;

// Where an image pretends to live on the bus. Only matters for
// resolveDeviceAddress()'s addr arithmetic — the image itself is addressed
// relative to it, and its drive is never labelled from this address.
export const IMAGE_START_ADDRESS = 0x50;

// Stella (savekey_eeprom.dat / atarivox_eeprom.dat) and Gopher2600 (savekey)
// both store exactly 32 KiB. The other sizes are this app's own Backup files
// of differently sized or formatted drives.
export const IMAGE_SIZES = [4, 8, 16, 32, 64, 128, 256].map((kib) => kib * 1024);
export const BLANK_IMAGE_BYTES = 32 * 1024;

export function isSupportedImageSize(bytes: number): boolean {
  return IMAGE_SIZES.includes(bytes);
}

export class EepromImage implements EepromBus {
  readonly data: Uint8Array;
  readonly name: string;
  readonly device: DetectedDevice;
  // Set by every write; cleared once the content has been saved/downloaded.
  dirty: boolean;

  constructor(data: Uint8Array, name: string, dirty = false) {
    if (!isSupportedImageSize(data.length)) {
      throw new Error(`Unsupported image size ${data.length} bytes.`);
    }
    this.data = data;
    this.name = name;
    this.dirty = dirty;
    // Up to 64 KiB is one I2C address, like a single SaveKey chip; larger
    // images (Backups of a multi-address drive) span N x 64 KiB addresses.
    this.device = {
      startAddress: IMAGE_START_ADDRESS,
      addressCount: Math.max(1, data.length / BLOCK_BYTES),
      capacityBytes: data.length,
    };
  }

  static blank(name: string): EepromImage {
    // A fresh EEPROM reads all $FF, which is also how Stella initializes a
    // new savekey_eeprom.dat. Dirty from the start: it doesn't exist on disk.
    return new EepromImage(new Uint8Array(BLANK_IMAGE_BYTES).fill(0xff), name, true);
  }

  private offsetFor(addr: number, memAddr: number, len: number): number {
    const offset = (addr - IMAGE_START_ADDRESS) * BLOCK_BYTES + memAddr;
    if (addr < IMAGE_START_ADDRESS || offset < 0 || offset + len > this.data.length) {
      throw new Error(`Access at ${offset}+${len} is outside ${this.name} (${this.data.length} bytes).`);
    }
    return offset;
  }

  async read(addr: number, memAddr: number, len: number): Promise<Uint8Array> {
    const offset = this.offsetFor(addr, memAddr, len);
    return this.data.slice(offset, offset + len);
  }

  async write(addr: number, memAddr: number, data: Uint8Array): Promise<void> {
    const offset = this.offsetFor(addr, memAddr, data.length);
    this.data.set(data, offset);
    this.dirty = true;
  }
}
