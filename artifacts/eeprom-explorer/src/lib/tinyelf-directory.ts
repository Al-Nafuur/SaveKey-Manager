// TinyELF Basic filesystem: directory entries.
//
// 16-byte entry format is the real, documented Atari DOS 2.x directory
// entry (user-supplied field list and flag values):
//   Byte 0        Flags
//   Bytes 1-2     Sector count (little-endian — 6502 convention)
//   Bytes 3-4     Start sector number (little-endian)
//   Bytes 5-12    Primary filename, left-justified, space ($20) padded
//   Bytes 13-15   Extension, left-justified, space ($20) padded
//
// Flag byte bits (as supplied):
//   $00 Entry has never been used
//   $80 Entry has been deleted
//   $40 Entry in use
//   $20 Entry locked
//   $02 File created by DOS 2
//   $01 File opened for output

import type { DetectedDevice, PicoBridge } from './pico-bridge';
import { readDeviceBytes, type TinyElfLayout } from './tinyelf-format';

export const DIRECTORY_ENTRY_SIZE = 16;

export const DirEntryFlag = {
  NEVER_USED: 0x00,
  DELETED: 0x80,
  IN_USE: 0x40,
  LOCKED: 0x20,
  CREATED_BY_DOS2: 0x02,
  OPENED_FOR_OUTPUT: 0x01,
} as const;

export type DirectoryEntry = {
  // Directory slot index (= file number, per the classic DOS 2.x convention
  // this format reuses) — needed to patch the right entry back in place when
  // overwriting a file's content in situ (see overwriteFileContent()).
  slot: number;
  flags: number;
  sectorCount: number;
  startSector: number;
  name: string;
  extension: string;
  locked: boolean;
};

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

// Returns null for a slot that's never been used or was deleted — both read
// as "no file here" for listing purposes.
export function parseDirectoryEntry(buf: Uint8Array, offset: number): DirectoryEntry | null {
  const flags = buf[offset];
  if (flags === DirEntryFlag.NEVER_USED || (flags & DirEntryFlag.DELETED) !== 0) return null;

  const sectorCount = readU16LE(buf, offset + 1);
  const startSector = readU16LE(buf, offset + 3);
  const name = new TextDecoder('ascii').decode(buf.subarray(offset + 5, offset + 13)).trimEnd();
  const extension = new TextDecoder('ascii').decode(buf.subarray(offset + 13, offset + 16)).trimEnd();

  return {
    slot: offset / DIRECTORY_ENTRY_SIZE,
    flags,
    sectorCount,
    startSector,
    name,
    extension,
    locked: (flags & DirEntryFlag.LOCKED) !== 0,
  };
}

export function parseDirectorySectors(buf: Uint8Array): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (let offset = 0; offset + DIRECTORY_ENTRY_SIZE <= buf.length; offset += DIRECTORY_ENTRY_SIZE) {
    const entry = parseDirectoryEntry(buf, offset);
    if (entry) entries.push(entry);
  }
  return entries;
}

export async function readDirectoryRaw(
  bridge: PicoBridge,
  device: DetectedDevice,
  layout: TinyElfLayout,
): Promise<Uint8Array> {
  const byteOffset = layout.directoryStart * layout.sectorSize;
  const length = layout.directorySectors * layout.sectorSize;
  return readDeviceBytes(bridge, device, byteOffset, length);
}

export async function readDirectory(
  bridge: PicoBridge,
  device: DetectedDevice,
  layout: TinyElfLayout,
): Promise<DirectoryEntry[]> {
  const bytes = await readDirectoryRaw(bridge, device, layout);
  return parseDirectorySectors(bytes);
}
