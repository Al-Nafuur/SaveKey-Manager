// TinyELF Basic filesystem: layout computation and FORMAT.
//
// Design source: "FileSystem Design ChatGPT.txt" (repo root). Several
// specifics were explicitly left open there — the choices below resolve
// them concretely so FORMAT has something definite to write. Revisit if the
// user wants different numbers.
//
// Resolved here (not fully pinned down in the design doc):
// - Sector size steps at 32 KiB and 128 KiB: <=32 KiB -> 64 B, <=128 KiB ->
//   128 B, else -> 256 B (extends the existing 64/128 cutoff in App.tsx's
//   demo `tinyElfLayout()` to also cover the AT24CM02's 256 B pages).
// - Directory sizing: <=8 KiB -> 1 sector, <=16 KiB -> 2, <=32 KiB -> 4,
//   else -> 8 (per-sector entries = floor(sectorSize / 16)).
// - Sector control info stays 3 bytes at every sector size (the doc's own
//   stated preference, to stay close to DOS 2.x).
// - A 4-byte magic ("TELF") plus our own fields, placed AFTER a block of
//   classic Atari DOS 2.x boot-sector fields at the start of sector 0 (user
//   specified the exact DOS 2.x field list; see byte layout below).
//
// Wear-leveling: FORMAT writes ONLY the boot/header sector, VTOC, and
// directory sectors — never the data region. EEPROM write endurance is
// finite; an unformatted/free data sector doesn't need to be zeroed for
// the filesystem to consider it free (the VTOC bitmap is what marks that).
//
// Sector 0 byte layout — classic DOS 2.x boot fields first ($00-$17), then
// TinyELF's own fields ($18 on):
//   $00      BFLAG    1 (NOT bootable — deliberately not 0: there's no real
//                        6502 boot loader after this, so claiming
//                        bootable would be actively wrong)
//   $01      BRCNT    0 (no boot-code sectors follow)
//   $02-$03  BLDADR   0 (unused, no boot code)
//   $04-$05  DOSINI   0 (unused, no boot code)
//   $06-$0E  (boot code area) 0 — no code
//   $0F      DFSFLG   0
//   $10      DFLINK   0
//   $11      BLDISP   sectorSize - SECTOR_CONTROL_BYTES (61/125/253)
//   $12-$13  reserved 0
//   $14-$15  sector size, big-endian (this IS our real sector size — no
//            separate "size code" needed, unlike an earlier draft of this
//            file)
//   $16-$17  total sectors, big-endian
//   $18-$1B  magic "TELF"
//   $1C      FS version (1)
//   $1D      flags (0, reserved)
//   $1E-$1F  VTOC start sector
//   $20-$21  VTOC size in sectors
//   $22-$23  directory start sector
//   $24-$25  directory size in sectors

import type { DetectedDevice, PicoBridge } from './pico-bridge';

export type TinyElfLayout = {
  sectorSize: number;
  totalSectors: number;
  headerSectors: number;
  vtocStart: number;
  vtocSectors: number;
  directoryStart: number;
  directorySectors: number;
  dataStart: number;
  maxFiles: number;
};

const FS_MAGIC = [0x54, 0x45, 0x4c, 0x46]; // "TELF"
const FS_VERSION = 1;
const SECTOR_CONTROL_BYTES = 3;
const BLDISP_OFFSET = 0x11;
const DOS_SECTOR_SIZE_OFFSET = 0x14;
const DOS_TOTAL_SECTORS_OFFSET = 0x16;
const TINYELF_FIELDS_OFFSET = 0x18;

// The sector-chain control info's file-number field is 6 bits (see
// encodeSectorControl/decodeSectorControl) — max 64 distinct files
// regardless of how many directory entries would otherwise fit.
const MAX_FILE_NUMBERS = 64;

export function computeTinyElfLayout(totalBytes: number): TinyElfLayout {
  const sectorSize = totalBytes <= 32 * 1024 ? 64 : totalBytes <= 128 * 1024 ? 128 : 256;
  const totalSectors = Math.floor(totalBytes / sectorSize);
  const entriesPerSector = Math.floor(sectorSize / 16);
  const directorySectorsByCapacity =
    totalBytes <= 8 * 1024 ? 1 : totalBytes <= 16 * 1024 ? 2 : totalBytes <= 32 * 1024 ? 4 : 8;
  // Cap so directorySectors * entriesPerSector never exceeds MAX_FILE_NUMBERS
  // — otherwise sectors would compute directory slots that no file's sector
  // chain could ever validly reference (e.g. 256B sectors x 8 dir sectors
  // would allow 128 files, double what the 6-bit field can address).
  const directorySectors = Math.min(directorySectorsByCapacity, Math.floor(MAX_FILE_NUMBERS / entriesPerSector));
  const headerSectors = 1;
  // One VTOC bit per sector -> ceil(totalSectors / 8) bitmap bytes, rounded
  // up to whole sectors.
  const vtocSectors = Math.max(1, Math.ceil(Math.ceil(totalSectors / 8) / sectorSize));
  const vtocStart = headerSectors;
  const directoryStart = vtocStart + vtocSectors;
  const dataStart = directoryStart + directorySectors;

  return {
    sectorSize,
    totalSectors,
    headerSectors,
    vtocStart,
    vtocSectors,
    directoryStart,
    directorySectors,
    dataStart,
    maxFiles: directorySectors * entriesPerSector,
  };
}

function writeU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

function readU16(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1];
}

// Reads back a header sector and validates the "TELF" magic — returns null
// if the device isn't TinyELF-formatted (or the sector is unreadable/blank).
export function parseHeaderSector(buf: Uint8Array): TinyElfLayout | null {
  const hasMagic = FS_MAGIC.every((byte, i) => buf[TINYELF_FIELDS_OFFSET + i] === byte);
  if (!hasMagic) return null;

  const sectorSize = readU16(buf, DOS_SECTOR_SIZE_OFFSET);
  const totalSectors = readU16(buf, DOS_TOTAL_SECTORS_OFFSET);
  let offset = TINYELF_FIELDS_OFFSET + FS_MAGIC.length + 2; // skip magic, version, flags
  const vtocStart = readU16(buf, offset);
  offset += 2;
  const vtocSectors = readU16(buf, offset);
  offset += 2;
  const directoryStart = readU16(buf, offset);
  offset += 2;
  const directorySectors = readU16(buf, offset);

  const entriesPerSector = Math.floor(sectorSize / 16);
  return {
    sectorSize,
    totalSectors,
    headerSectors: 1,
    vtocStart,
    vtocSectors,
    directoryStart,
    directorySectors,
    dataStart: directoryStart + directorySectors,
    maxFiles: directorySectors * entriesPerSector,
  };
}

export function buildHeaderSector(layout: TinyElfLayout): Uint8Array {
  const buf = new Uint8Array(layout.sectorSize);
  // $00-$17: classic DOS 2.x boot-sector fields (BFLAG/BRCNT/BLDADR/DOSINI
  // stay 0/1 — no real boot code follows, see file header comment).
  buf[0x00] = 1; // BFLAG: not bootable
  buf[BLDISP_OFFSET] = layout.sectorSize - SECTOR_CONTROL_BYTES; // fits a byte for our sizes (61/125/253)
  writeU16(buf, DOS_SECTOR_SIZE_OFFSET, layout.sectorSize);
  writeU16(buf, DOS_TOTAL_SECTORS_OFFSET, layout.totalSectors);

  // $18 on: TinyELF's own fields.
  let offset = TINYELF_FIELDS_OFFSET;
  buf.set(FS_MAGIC, offset);
  offset += FS_MAGIC.length;
  buf[offset++] = FS_VERSION;
  buf[offset++] = 0; // flags, reserved
  writeU16(buf, offset, layout.vtocStart);
  offset += 2;
  writeU16(buf, offset, layout.vtocSectors);
  offset += 2;
  writeU16(buf, offset, layout.directoryStart);
  offset += 2;
  writeU16(buf, offset, layout.directorySectors);

  return buf;
}

export function buildVtocSectors(layout: TinyElfLayout): Uint8Array {
  const buf = new Uint8Array(layout.vtocSectors * layout.sectorSize);
  // Atari DOS 2.x convention: bit = 1 means free, bit = 0 means allocated.
  buf.fill(0xff);
  const markAllocated = (sector: number) => {
    const byteIndex = sector >> 3;
    const bitMask = 0x80 >> (sector & 7);
    buf[byteIndex] &= ~bitMask;
  };
  const reservedSectors = layout.headerSectors + layout.vtocSectors + layout.directorySectors;
  for (let sector = 0; sector < reservedSectors; sector++) markAllocated(sector);
  // Bits past the real sector count are padding within the last VTOC byte —
  // mark them allocated too so they never read back as spuriously free.
  for (let sector = layout.totalSectors; sector < buf.length * 8; sector++) markAllocated(sector);
  return buf;
}

export function buildDirectorySectors(layout: TinyElfLayout): Uint8Array {
  // All-zero: a directory entry's first byte = 0x00 means "never used".
  return new Uint8Array(layout.directorySectors * layout.sectorSize);
}

// Sector-chain control info: the last SECTOR_CONTROL_BYTES bytes of every
// data sector (user-supplied bit layout, generalized to sectorSize-3 rather
// than the classic fixed 128-byte-sector offsets 125/126/127):
//   byte 0 (offset sectorSize-3): number of valid data bytes in this sector
//   byte 1 (offset sectorSize-2): bits 0-5 = file number (0-63),
//                                 bits 6-7 = next-sector number, high 2 bits
//   byte 2 (offset sectorSize-1): next-sector number, low 8 bits
// 10-bit next-sector field -> sectors 0-1023; 0 is never a valid data-chain
// target (it's the boot sector), so it doubles as the "end of chain" marker.
export const SECTOR_LINK_NONE = 0;

export function encodeSectorControl(bytesUsed: number, fileNumber: number, nextSector: number): [number, number, number] {
  const nextHi = (nextSector >> 8) & 0x03;
  const nextLo = nextSector & 0xff;
  return [bytesUsed, (fileNumber & 0x3f) | (nextHi << 6), nextLo];
}

export function decodeSectorControl(byte0: number, byte1: number, byte2: number): { bytesUsed: number; fileNumber: number; nextSector: number } {
  return { bytesUsed: byte0, fileNumber: byte1 & 0x3f, nextSector: ((byte1 >> 6) & 0x03) << 8 | byte2 };
}

// A device can span several consecutive I2C addresses (per the SaveKey
// hardware notes: one 64 KiB block per address) — translate a flat logical
// byte offset within the device into the (i2c address, 16-bit mem address)
// pair PicoBridge actually talks in.
export function resolveDeviceAddress(device: DetectedDevice, byteOffset: number): { addr: number; memAddr: number } {
  const blockIndex = Math.floor(byteOffset / 0x10000);
  return { addr: device.startAddress + blockIndex, memAddr: byteOffset % 0x10000 };
}

// Reads `length` bytes starting at a flat logical byte offset within the
// device, transparently splitting the read at 64 KiB address-block
// boundaries if it crosses one (a single READ command can't span two I2C
// addresses).
export async function readDeviceBytes(
  bridge: PicoBridge,
  device: DetectedDevice,
  byteOffset: number,
  length: number,
): Promise<Uint8Array> {
  const result = new Uint8Array(length);
  let offset = byteOffset;
  let written = 0;
  while (written < length) {
    const { addr, memAddr } = resolveDeviceAddress(device, offset);
    const chunk = Math.min(length - written, 0x10000 - memAddr);
    const bytes = await bridge.read(addr, memAddr, chunk);
    result.set(bytes, written);
    offset += chunk;
    written += chunk;
  }
  return result;
}

// Writes `data` starting at a flat logical byte offset within the device —
// for a full raw device backup/restore, format-agnostic (doesn't know or
// care about sectors/pages/directories). Chunked at a conservative fixed
// 64 bytes: real EEPROM page sizes vary by chip in this project (64 B for
// the classic 24LC256-class SaveKey chip, up to 256 B for the larger
// AT24CM02-class chip — see computeTinyElfLayout's sector-size-per-capacity
// comment), and a WRITE that's narrower than the chip's real page never
// risks the same-page address wraparound corruption a too-wide one would;
// it's just a few more commands for the larger chips. Also transparently
// splits at 64 KiB address-block boundaries like readDeviceBytes.
const RAW_WRITE_CHUNK_BYTES = 64;

export async function writeDeviceBytes(
  bridge: PicoBridge,
  device: DetectedDevice,
  byteOffset: number,
  data: Uint8Array,
): Promise<void> {
  let offset = byteOffset;
  let written = 0;
  while (written < data.length) {
    const { addr, memAddr } = resolveDeviceAddress(device, offset);
    const chunk = Math.min(data.length - written, RAW_WRITE_CHUNK_BYTES, 0x10000 - memAddr);
    await bridge.write(addr, memAddr, data.subarray(written, written + chunk));
    offset += chunk;
    written += chunk;
  }
}

export async function readTinyElfHeader(bridge: PicoBridge, device: DetectedDevice): Promise<TinyElfLayout | null> {
  const bytes = await readDeviceBytes(bridge, device, 0, TINYELF_FIELDS_OFFSET + FS_MAGIC.length + 2 + 8);
  return parseHeaderSector(bytes);
}

export async function writeSectors(
  bridge: PicoBridge,
  device: DetectedDevice,
  startSector: number,
  data: Uint8Array,
  sectorSize: number,
): Promise<void> {
  const sectorCount = data.length / sectorSize;
  for (let i = 0; i < sectorCount; i++) {
    const sectorBytes = data.subarray(i * sectorSize, (i + 1) * sectorSize);
    const byteOffset = (startSector + i) * sectorSize;
    const { addr, memAddr } = resolveDeviceAddress(device, byteOffset);
    await bridge.write(addr, memAddr, sectorBytes);
  }
}

// Writes ONLY the boot/header sector, VTOC, and directory — the data region
// is left completely untouched (wear-leveling: don't write sectors that
// don't need to change).
export async function formatDevice(
  bridge: PicoBridge,
  device: DetectedDevice,
  totalBytes: number,
  onProgress?: (message: string) => void,
): Promise<TinyElfLayout> {
  const layout = computeTinyElfLayout(totalBytes);

  onProgress?.('Writing boot/header sector…');
  await writeSectors(bridge, device, 0, buildHeaderSector(layout), layout.sectorSize);

  onProgress?.(`Writing VTOC (${layout.vtocSectors} sector${layout.vtocSectors === 1 ? '' : 's'})…`);
  await writeSectors(bridge, device, layout.vtocStart, buildVtocSectors(layout), layout.sectorSize);

  onProgress?.(`Writing directory (${layout.directorySectors} sector${layout.directorySectors === 1 ? '' : 's'})…`);
  await writeSectors(bridge, device, layout.directoryStart, buildDirectorySectors(layout), layout.sectorSize);

  onProgress?.('Format complete.');
  return layout;
}

export { SECTOR_CONTROL_BYTES };
