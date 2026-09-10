// Classic SaveKey format: real per-page occupancy. A page is "free" only if
// every one of its bytes is still the EEPROM's blank value (0xFF) — any
// other byte anywhere in the page means something has actually been written
// there, regardless of what the allocation registry claims about the slot.

import type { DetectedDevice, PicoBridge } from './pico-bridge';
import { readDeviceBytes } from './tinyelf-format';

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
