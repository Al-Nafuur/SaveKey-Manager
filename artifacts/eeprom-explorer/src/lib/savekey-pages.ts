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
