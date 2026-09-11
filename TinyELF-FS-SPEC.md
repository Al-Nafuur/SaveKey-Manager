# TinyELF Basic Filesystem — Specification

Status: **hardware-verified** (2026-09-10) — FORMAT, SAVE, and LOAD were confirmed
byte-perfect on a real SaveKey Plus over the PicoBridge USB↔I²C bridge, including a
file whose content splits mid-line across a sector boundary. This document is the
authoritative spec going forward; it supersedes `FileSystem Design ChatGPT.txt` at
the repo root, which was the original draft several details here were resolved from
during implementation (directory sizing cap, exact control-byte bit layout, etc.).

Reference implementation (TypeScript, browser-side — read these for the literal,
tested logic, this document is a human-readable summary of them):
- [artifacts/eeprom-explorer/src/lib/tinyelf-format.ts](artifacts/eeprom-explorer/src/lib/tinyelf-format.ts) — layout math, header sector, VTOC, FORMAT
- [artifacts/eeprom-explorer/src/lib/tinyelf-directory.ts](artifacts/eeprom-explorer/src/lib/tinyelf-directory.ts) — directory entry parsing
- [artifacts/eeprom-explorer/src/lib/tinyelf-save.ts](artifacts/eeprom-explorer/src/lib/tinyelf-save.ts) — SAVE, LOAD, sector-chain walking

## Design goal

A small, variable TinyELF disk format inspired by Atari DOS 2.x (directory, VTOC,
sector chaining), but with layout and sector size adapted to the actual EEPROM
capacity and page size — so a 4 KiB EEPROM and a 256 KiB AT24CM02 both work without
needing separate filesystems. Supported range: 4 KiB – 256 KiB (10-bit sector
numbers cap total sectors at 1024; a larger device would need wider addressing,
not designed).

## Layout, derived from capacity

Computed by `computeTinyElfLayout(totalBytes)`:

| Total capacity | Sector size | Directory sectors | Max files |
|---|---|---|---|
| ≤ 32 KiB  | 64 B  | ≤8 KiB→1, ≤16 KiB→2, else 4 | capped so `dirSectors × entriesPerSector ≤ 64` |
| ≤ 128 KiB | 128 B | 8 | capped the same way |
| > 128 KiB | 256 B | 8 | capped the same way |

- `entriesPerSector = floor(sectorSize / 16)`
- `vtocSectors = max(1, ceil(ceil(totalSectors / 8) / sectorSize))` — for every
  capacity in the 4 KiB–256 KiB range this evaluates to **exactly 1 sector**, so
  VTOC read-modify-write never needs sub-sector handling (verified by the math, not
  separately enforced defensively).
- Region order: **header sector (1)** → **VTOC** → **directory** → **data**.
  `vtocStart = 1`, `directoryStart = vtocStart + vtocSectors`,
  `dataStart = directoryStart + directorySectors`.
- Directory sizing is capped so `directorySectors × entriesPerSector` never
  exceeds 64 — the sector-chain control byte's file-number field is only 6 bits
  wide (max 64 distinct files), so a larger directory would compute slots no
  file could ever validly reference.

## Sector 0: boot + TinyELF header

Classic Atari DOS 2.x boot-sector fields first (so a real DOS 2.x-aware tool
doesn't misread this as garbage), TinyELF's own fields after:

| Offset | Field | Value |
|---|---|---|
| `$00` | BFLAG | `1` — **not** bootable. Deliberately not `0`: there's no real 6502 boot loader after this, so claiming bootable would be actively wrong. |
| `$01` | BRCNT | `0` — no boot-code sectors follow |
| `$02–$03` | BLDADR | `0` — unused |
| `$04–$05` | DOSINI | `0` — unused |
| `$06–$0E` | (boot code area) | `0` — no code |
| `$0F` | DFSFLG | `0` |
| `$10` | DFLINK | `0` |
| `$11` | BLDISP | `sectorSize - 3` (61 / 125 / 253) |
| `$12–$13` | reserved | `0` |
| `$14–$15` | sector size, big-endian | the real sector size (64/128/256) — no separate "size code" |
| `$16–$17` | total sectors, big-endian | |
| `$18–$1B` | magic | `"TELF"` (`54 45 4C 46`) |
| `$1C` | FS version | `1` |
| `$1D` | flags | `0`, reserved |
| `$1E–$1F` | VTOC start sector, big-endian | |
| `$20–$21` | VTOC size in sectors, big-endian | |
| `$22–$23` | directory start sector, big-endian | |
| `$24–$25` | directory size in sectors, big-endian | |

A device is recognized as TinyELF-formatted only if the `"TELF"` magic at `$18`
is present (`parseHeaderSector()`); anything else (blank EEPROM, native TinyELF
BASIC save data without our filesystem, a classic SaveKey allocation-format
device) reads as "not TinyELF" and must be refused for writes, not silently
faked.

## VTOC (allocation bitmap)

One bit per sector, MSB-first within each byte (`byteIndex = sector >> 3`,
`bitMask = 0x80 >> (sector & 7)`). **Atari DOS 2.x convention: `1` = free,
`0` = allocated.** On FORMAT, the header/VTOC/directory sectors themselves are
marked allocated, and any padding bits past the real `totalSectors` (within the
last VTOC byte) are also marked allocated so they never read back as spuriously
free.

## Directory entry (16 bytes, real Atari DOS 2.x format)

| Offset | Field |
|---|---|
| `0` | Flags — see below |
| `1–2` | Sector count, little-endian (6502 convention) |
| `3–4` | Start sector number, little-endian |
| `5–12` | Filename, left-justified, space (`$20`) padded, max 8 chars |
| `13–15` | Extension, left-justified, space-padded, max 3 chars |

Flags byte:

| Value | Meaning |
|---|---|
| `$00` | Never used |
| `$80` | Deleted |
| `$40` | In use |
| `$20` | Locked |
| `$02` | Created by DOS 2 |
| `$01` | Opened for output |

`$00` (never-used) and `$80`-set (deleted) both read as "no file in this slot".
**File number = directory slot index** (matches classic DOS 2.x convention,
avoids a separate allocation scheme) — so slot 0 is file number 0, etc.

## Data sector: trailing control bytes

The **last 3 bytes of every data sector** (`sectorSize - 3`, generalized from
DOS 2.x's fixed 128-byte-sector offsets 125/126/127):

| Byte | Meaning |
|---|---|
| 0 | Number of valid data bytes in this sector (`bytesUsed`) |
| 1 | Bits 0–5: file number (0–63). Bits 6–7: next-sector number, **high** 2 bits |
| 2 | Next-sector number, **low** 8 bits |

10-bit next-sector field → sectors 0–1023. Sector 0 is never a valid data-chain
target (it's the boot/header sector), so `nextSector == 0` doubles as the
**end-of-chain** marker (`SECTOR_LINK_NONE`).

`encodeSectorControl(bytesUsed, fileNumber, nextSector)` /
`decodeSectorControl(byte0, byte1, byte2)` in `tinyelf-format.ts` are the
canonical (de)serializers.

## Reading a file (LOAD)

Walk the sector chain starting at the directory entry's start sector: read the
whole sector, take the first `control.bytesUsed` bytes as content, follow
`control.nextSector` until `SECTOR_LINK_NONE`. Loop-detection via a visited-set
throws rather than hanging on a corrupt chain. See `loadFileContent()`.

Exact file size = sum of each sector's `bytesUsed` (walking the chain) — the
directory itself only ever stores **sector count**, never exact byte size, which
matches real DOS 2.x/SpartaDOS X catalog listing behavior (confirmed against
independent research into classic DOS 2.x directory semantics, not just our own
assumption). A directory listing should show `sectorCount × sectorSize` as an
approximation and only compute the exact size lazily when a file is actually
opened — computing it eagerly for every file in a large directory doesn't scale
(one extra round-trip per sector, × up to 64 files). See `computeExactFileSize()`
for a cheap variant that reads only the 3 control bytes per sector.

## Writing a file (SAVE)

1. Read the VTOC (1 sector) and the whole directory region.
2. Find a free directory slot (first `$00` or deleted entry) — becomes the file
   number.
3. Walk the VTOC from `dataStart` forward to find enough free sectors
   (`ceil(dataLength / (sectorSize - 3))`, minimum 1).
4. Write each newly-allocated sector's content + control bytes (chained to the
   next, last one gets `SECTOR_LINK_NONE`), and mark it allocated in the local
   VTOC copy.
5. Rewrite the VTOC sector (whole — it's always exactly 1 sector).
6. Patch **only the one directory sector** containing the new entry and rewrite
   just that sector — the rest of the directory region is untouched.

## Wear-leveling constraint (hard requirement)

**Every write path must only write sectors that actually changed** — EEPROM
write endurance is finite. FORMAT writes only the boot/header sector, VTOC, and
directory sectors, never the data region. SAVE writes only newly-allocated data
sectors, the VTOC sector, and the one directory sector patched. Never
blanket-write or zero sectors that don't need to change.

## Still open / not yet implemented

- **DELETE**: would need to flip the entry's `$80` deleted flag and free its
  VTOC bits — not implemented yet.
- **CATALOG refresh nuances**: not fully worked out.
- **Multi-VTOC-sector handling**: current code assumes exactly 1 VTOC sector.
  True for the entire 4 KiB–256 KiB range per the layout math, but not enforced
  defensively — a bug elsewhere that produced a >1-sector VTOC would silently
  misbehave rather than error.
- Sector-size cutoffs (32 KiB / 128 KiB) and the directory-sizing curve were
  picked as reasonable defaults during implementation, not derived from an
  external spec — revisit if TinyELF Basic needs different numbers.

## Relationship to the classic SaveKey/AtariVox format

This filesystem is **unrelated to and doesn't touch** the classic SaveKey
allocation-list format (external registry:
[atariage-community/savekey-allocation-list](https://github.com/atariage-community/savekey-allocation-list)).
A SaveKey Plus has two EEPROMs: EEPROM 1 (32 KiB) conventionally holds classic
SaveKey data, EEPROM 2 (up to 256 KiB) can hold this TinyELF filesystem instead
— or this filesystem can be installed on a plain single-EEPROM SaveKey instead
of the classic format. The classic format's own "system block" (page 0: 8-byte
`"ATARIVOX"` signature + 1 TV-mode byte, rest reserved) is a completely separate
thing — see `formatSaveKeyDevice()` in
[savekey-pages.ts](artifacts/eeprom-explorer/src/lib/savekey-pages.ts) if that's
useful for cross-reference, but it has no bearing on this filesystem's layout.
