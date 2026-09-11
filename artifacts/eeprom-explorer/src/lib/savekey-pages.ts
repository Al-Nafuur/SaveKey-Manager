// Classic SaveKey format: real per-page occupancy. A page is "free" only if
// every one of its bytes is still the EEPROM's blank value (0xFF) — any
// other byte anywhere in the page means something has actually been written
// there, regardless of what the allocation registry claims about the slot.

import type { DetectedDevice, PicoBridge } from './pico-bridge';
import { readDeviceBytes, resolveDeviceAddress } from './tinyelf-format';

export async function readPageOccupancy(
  bridge: PicoBridge,
  device: DetectedDevice,
  pageSize: number,
  totalPages: number,
): Promise<boolean[]> {
  const bytes = await readDeviceBytes(bridge, device, 0, pageSize * totalPages);
  const occupied: boolean[] = new Array(totalPages);
  for (let page = 0; page < totalPages; page++) {
    const start = page * pageSize;
    let hasData = false;
    for (let i = start; i < start + pageSize; i++) {
      if (bytes[i] !== 0xff) {
        hasData = true;
        break;
      }
    }
    occupied[page] = hasData;
  }
  return occupied;
}

// Reads the raw bytes for an inclusive page range (e.g. an allocation
// entry's pageStart..pageEnd) — one flat byte array, in page order.
export async function readPageRange(
  bridge: PicoBridge,
  device: DetectedDevice,
  pageSize: number,
  pageStart: number,
  pageEnd: number,
): Promise<Uint8Array> {
  const byteOffset = pageStart * pageSize;
  const length = (pageEnd - pageStart + 1) * pageSize;
  return readDeviceBytes(bridge, device, byteOffset, length);
}

// Writes bytes back to an inclusive page range, one physical EEPROM page
// (pageSize bytes) per WRITE command — a single write must not cross the
// chip's actual page boundary, and pageSize here is chosen to match it
// (e.g. 64 bytes for the classic 24LC256-class SaveKey chip). `data` must
// be exactly (pageEnd - pageStart + 1) * pageSize bytes.
export async function writePageRange(
  bridge: PicoBridge,
  device: DetectedDevice,
  pageSize: number,
  pageStart: number,
  pageEnd: number,
  data: Uint8Array,
): Promise<void> {
  const pageCount = pageEnd - pageStart + 1;
  if (data.length !== pageCount * pageSize) {
    throw new Error(`Expected exactly ${pageCount * pageSize} bytes, got ${data.length}.`);
  }
  for (let i = 0; i < pageCount; i++) {
    const chunk = data.subarray(i * pageSize, (i + 1) * pageSize);
    const { addr, memAddr } = resolveDeviceAddress(device, (pageStart + i) * pageSize);
    await bridge.write(addr, memAddr, chunk);
  }
}

// Classic SaveKey/AtariVox "System Settings" page (page 0): an 8-byte ASCII
// signature "ATARIVOX" followed by a TV Mode byte, per the original AtariVox
// Programmer's Guide and the AtariAge allocation list — confirmed to be the
// same on a plain SaveKey (it's the same EEPROM format, just without the
// SpeakJet chip). Bytes $09 onward are documented as unused/reserved, so
// they're left at the EEPROM's blank value (0xFF) rather than zeroed.
const SAVEKEY_SIGNATURE = [0x41, 0x54, 0x41, 0x52, 0x49, 0x56, 0x4f, 0x58]; // "ATARIVOX"
const TV_MODE_OFFSET = 8;

// Bit 7: 0 = PAL, 1 = NTSC. Bit 6: 0 = 60 Hz, 1 = 50 Hz.
export const SAVEKEY_TV_MODE_BYTES = {
  ntsc60: 0b1000_0000,
  ntsc50: 0b1100_0000,
  pal60: 0b0000_0000,
  pal50: 0b0100_0000,
} as const;
export type SaveKeyTvMode = keyof typeof SAVEKEY_TV_MODE_BYTES;

export function buildSaveKeySystemPage(pageSize: number, tvMode: SaveKeyTvMode): Uint8Array {
  const page = new Uint8Array(pageSize).fill(0xff);
  page.set(SAVEKEY_SIGNATURE, 0);
  page[TV_MODE_OFFSET] = SAVEKEY_TV_MODE_BYTES[tvMode];
  return page;
}

// "Format as SaveKey" only ever means (re)writing this one system page —
// unlike TinyELF FORMAT there's no VTOC/directory to lay out, and existing
// game save data on other pages must never be touched. Skips the write
// entirely if the page already matches, per the project's wear-leveling rule.
export async function formatSaveKeyDevice(
  bridge: PicoBridge,
  device: DetectedDevice,
  pageSize: number,
  tvMode: SaveKeyTvMode,
  onProgress?: (message: string) => void,
): Promise<void> {
  const desired = buildSaveKeySystemPage(pageSize, tvMode);
  onProgress?.('Checking system block…');
  const current = await readPageRange(bridge, device, pageSize, 0, 0);
  if (current.every((byte, i) => byte === desired[i])) {
    onProgress?.('System block already matches — nothing written.');
    return;
  }
  onProgress?.('Writing SaveKey system block (page 0)…');
  await writePageRange(bridge, device, pageSize, 0, 0, desired);
  onProgress?.('Format complete.');
}
