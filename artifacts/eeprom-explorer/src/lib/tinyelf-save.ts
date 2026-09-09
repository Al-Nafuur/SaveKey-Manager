// TinyELF Basic filesystem: SAVE (write a file onto a formatted device).
//
// Wear-leveling: only touches the VTOC sector, the one directory sector
// containing the new entry, and the newly-allocated (previously free) data
// sectors — never rewrites unrelated sectors.

import type { DetectedDevice, PicoBridge } from './pico-bridge';
import {
  SECTOR_CONTROL_BYTES,
  SECTOR_LINK_NONE,
  decodeSectorControl,
  encodeSectorControl,
  readDeviceBytes,
  resolveDeviceAddress,
  writeSectors,
  type TinyElfLayout,
} from './tinyelf-format';
import { DIRECTORY_ENTRY_SIZE, DirEntryFlag, readDirectoryRaw } from './tinyelf-directory';

// All our supported capacities (4 KiB-256 KiB) land on exactly 1 VTOC
// sector — see computeTinyElfLayout's vtocSectors math — so VTOC
// read-modify-write never needs to consider more than one.
function vtocBitIndex(sector: number): { byteIndex: number; bitMask: number } {
  return { byteIndex: sector >> 3, bitMask: 0x80 >> (sector & 7) };
}

function isSectorFree(vtoc: Uint8Array, sector: number): boolean {
  const { byteIndex, bitMask } = vtocBitIndex(sector);
  return (vtoc[byteIndex] & bitMask) !== 0;
}

function markSectorAllocated(vtoc: Uint8Array, sector: number): void {
  const { byteIndex, bitMask } = vtocBitIndex(sector);
  vtoc[byteIndex] &= ~bitMask;
}

function findFreeSectors(vtoc: Uint8Array, layout: TinyElfLayout, count: number): number[] {
  const free: number[] = [];
  for (let sector = layout.dataStart; sector < layout.totalSectors && free.length < count; sector++) {
    if (isSectorFree(vtoc, sector)) free.push(sector);
  }
  if (free.length < count) {
    throw new Error(`Not enough free space: need ${count} sectors, found ${free.length}.`);
  }
  return free;
}

// Splits "NAME.EXT" into Atari-style 8.3 parts, uppercased. Longer parts are
// truncated (no error) — good enough for a first SAVE implementation.
export function atariNameParts(filename: string): { name: string; extension: string } {
  const dot = filename.lastIndexOf('.');
  const rawName = dot === -1 ? filename : filename.slice(0, dot);
  const rawExt = dot === -1 ? '' : filename.slice(dot + 1);
  return {
    name: rawName.toUpperCase().slice(0, 8),
    extension: rawExt.toUpperCase().slice(0, 3),
  };
}

function padField(value: string, length: number): Uint8Array {
  const buf = new Uint8Array(length).fill(0x20); // space-padded
  const bytes = new TextEncoder().encode(value.slice(0, length));
  buf.set(bytes, 0);
  return buf;
}

function findFreeDirectorySlot(directoryBytes: Uint8Array, maxFiles: number): number {
  for (let slot = 0; slot < maxFiles; slot++) {
    const flags = directoryBytes[slot * DIRECTORY_ENTRY_SIZE];
    if (flags === DirEntryFlag.NEVER_USED || (flags & DirEntryFlag.DELETED) !== 0) return slot;
  }
  throw new Error('Directory is full — no free entry slot.');
}

export type SavedFile = {
  slot: number;
  fileNumber: number;
  startSector: number;
  sectorCount: number;
  name: string;
  extension: string;
};

export async function saveFile(
  bridge: PicoBridge,
  device: DetectedDevice,
  layout: TinyElfLayout,
  filename: string,
  data: Uint8Array,
): Promise<SavedFile> {
  const dataBytesPerSector = layout.sectorSize - SECTOR_CONTROL_BYTES;
  const sectorsNeeded = Math.max(1, Math.ceil(data.length / dataBytesPerSector));

  const vtoc = await readDeviceBytes(bridge, device, layout.vtocStart * layout.sectorSize, layout.sectorSize);
  const directoryBytes = await readDirectoryRaw(bridge, device, layout);

  const slot = findFreeDirectorySlot(directoryBytes, layout.maxFiles);
  const fileNumber = slot; // directory slot index doubles as the file number (matches classic DOS 2.x)
  const sectors = findFreeSectors(vtoc, layout, sectorsNeeded);

  // Write the newly-allocated data sectors, each chained to the next.
  for (let i = 0; i < sectors.length; i++) {
    const sector = sectors[i];
    const isLast = i === sectors.length - 1;
    const chunkStart = i * dataBytesPerSector;
    const chunkEnd = Math.min(data.length, chunkStart + dataBytesPerSector);
    const bytesUsed = chunkEnd - chunkStart;
    const nextSector = isLast ? SECTOR_LINK_NONE : sectors[i + 1];

    const sectorBytes = new Uint8Array(layout.sectorSize);
    sectorBytes.set(data.subarray(chunkStart, chunkEnd), 0);
    const control = encodeSectorControl(bytesUsed, fileNumber, nextSector);
    sectorBytes.set(control, dataBytesPerSector);

    const { addr, memAddr } = resolveDeviceAddress(device, sector * layout.sectorSize);
    await bridge.write(addr, memAddr, sectorBytes);
    markSectorAllocated(vtoc, sector);
  }

  // VTOC: always exactly 1 sector for every capacity we support (see
  // computeTinyElfLayout) — rewrite it whole, no sub-sector diffing needed.
  await writeSectors(bridge, device, layout.vtocStart, vtoc, layout.sectorSize);

  // Directory: patch only the one entry, rewrite only the one sector it
  // lives in — the rest of the directory region is untouched.
  const entriesPerSector = Math.floor(layout.sectorSize / 16);
  const entrySectorIndex = Math.floor(slot / entriesPerSector);
  const entryOffsetInSector = (slot % entriesPerSector) * DIRECTORY_ENTRY_SIZE;
  const directorySectorStart = entrySectorIndex * layout.sectorSize;
  const directorySector = directoryBytes.subarray(directorySectorStart, directorySectorStart + layout.sectorSize);
  const patchedSector = new Uint8Array(directorySector); // copy, don't mutate the read buffer in place

  const { name, extension } = atariNameParts(filename);
  const entryFlags = DirEntryFlag.IN_USE | DirEntryFlag.CREATED_BY_DOS2;
  patchedSector[entryOffsetInSector] = entryFlags;
  patchedSector[entryOffsetInSector + 1] = sectors.length & 0xff;
  patchedSector[entryOffsetInSector + 2] = (sectors.length >> 8) & 0xff;
  patchedSector[entryOffsetInSector + 3] = sectors[0] & 0xff;
  patchedSector[entryOffsetInSector + 4] = (sectors[0] >> 8) & 0xff;
  patchedSector.set(padField(name, 8), entryOffsetInSector + 5);
  patchedSector.set(padField(extension, 3), entryOffsetInSector + 13);

  await writeSectors(bridge, device, layout.directoryStart + entrySectorIndex, patchedSector, layout.sectorSize);

  return { slot, fileNumber, startSector: sectors[0], sectorCount: sectors.length, name, extension };
}

// Walks the sector chain starting at `startSector`, using each sector's
// trailing control info (bytesUsed + next-sector pointer) to know exactly
// where the real content ends and where to go next — LOAD's counterpart to
// SAVE's chain-writing above.
export async function loadFileContent(
  bridge: PicoBridge,
  device: DetectedDevice,
  layout: TinyElfLayout,
  startSector: number,
): Promise<Uint8Array> {
  const dataBytesPerSector = layout.sectorSize - SECTOR_CONTROL_BYTES;
  const chunks: Uint8Array[] = [];
  const visited = new Set<number>();
  let sector = startSector;

  while (sector !== SECTOR_LINK_NONE) {
    if (visited.has(sector)) throw new Error(`Sector chain loop detected at sector ${sector}.`);
    visited.add(sector);

    const sectorBytes = await readDeviceBytes(bridge, device, sector * layout.sectorSize, layout.sectorSize);
    const control = decodeSectorControl(
      sectorBytes[dataBytesPerSector],
      sectorBytes[dataBytesPerSector + 1],
      sectorBytes[dataBytesPerSector + 2],
    );
    chunks.push(sectorBytes.subarray(0, control.bytesUsed));
    sector = control.nextSector;
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
