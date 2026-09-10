import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  Activity,
  Archive,
  CircuitBoard,
  Download,
  ExternalLink,
  FileCode2,
  FileCog,
  FileText,
  HardDrive,
  Hexagon,
  LayoutGrid,
  List,
  LockKeyhole,
  MoreHorizontal,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import { usePicoBridge } from '@/hooks/use-pico-bridge';
import type { DetectedDevice, PicoBridge } from '@/lib/pico-bridge';
import { computeTinyElfLayout, formatDevice, readTinyElfHeader, type TinyElfLayout } from '@/lib/tinyelf-format';
import { readDirectory } from '@/lib/tinyelf-directory';
import { loadFileContent, saveFile } from '@/lib/tinyelf-save';
import {
  buildPageOwners,
  fetchSaveKeyRegistry,
  type SaveKeyAllocationEntry,
  type SaveKeyRegistry,
} from '@/lib/savekey-registry';
import { readPageOccupancy } from '@/lib/savekey-pages';

type DriveMode = 'savekey' | 'tinyelf-fs';
type Drive = {
  id: string;
  label: string;
  address: number;
  totalBytes: number;
  mode: DriveMode;
  canChangeMode: boolean;
};
type TinyElfFile = {
  id: string;
  name: string;
  extension: string;
  size: number;
  modified: string;
  attributes: string;
  bytes: number[];
  driveId: string;
  // Real (non-demo) files only: the sector-chain head, so content can be
  // lazily loaded on selection instead of eagerly for every listed file.
  startSector?: number;
};
type ActivityRecord = { id: number; time: string; message: string; detail?: string };
// Shared shape for both the demo allocation entries below and the real
// entries fetched from the community registry — see lib/savekey-registry.ts.
type AllocationEntry = SaveKeyAllocationEntry;
type AllocationStatus = AllocationEntry['status'];

const queryClient = new QueryClient();

const SCRATCHPAD_START = 0x0c0;
const SCRATCHPAD_END = 0x0ff;
const TOTAL_PAGES = 512;
const ALLOCATION_LIST_URL = 'https://github.com/atariage-community/savekey-allocation-list';

// Standard EEPROM capacities from the TinyELF FS design notes. SCAN can only
// tell us "N I2C addresses ACKed", which for a single address (<=64 KiB) is
// ambiguous between e.g. a 4 KiB and a 32 KiB chip that both only occupy one
// address — the user has to pick the real size, we can only guess a default.
const EEPROM_CAPACITY_OPTIONS_KIB = [4, 8, 16, 32, 64, 128, 256];

function guessCapacityKiB(device: DetectedDevice): number {
  if (device.addressCount > 1) return device.addressCount * 64;
  return 32; // matches this project's "standard SaveKey" EEPROM 1 capacity
}

// Atari-style drive numbering: E1 = 0x50 .. E8 = 0x57.
function driveLabelForAddress(address: number): string {
  return `E${address - 0x50 + 1}`;
}

const initialDrives: Drive[] = [
  { id: 'E1', label: 'E1', address: 0x50, totalBytes: 32 * 1024, mode: 'savekey', canChangeMode: true },
  { id: 'E2', label: 'E2', address: 0x51, totalBytes: 64 * 1024, mode: 'tinyelf-fs', canChangeMode: false },
];

// A curated, real subset of https://github.com/atariage-community/savekey-allocation-list/blob/main/allocations.yaml
// — used only while disconnected/demoing; a real connected device fetches
// and uses the live registry instead (see fetchSaveKeyRegistry()).
const allocationEntries: AllocationEntry[] = [
  { id: 'system-settings', title: 'System Settings', kind: 'system', status: 'allocated', pageStart: 0x000, pageEnd: 0x000, notes: 'TV mode' },
  { id: 'man-goes-down', title: 'Man Goes Down', developer: 'Alex Herbert', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x001, pageEnd: 0x001, verified: '2026-08-17', notes: "WIP, never finalized nor published 'officially'. Arguably, should retain its slot due to wide adoption.", urls: ['https://forums.atariage.com/topic/53689-my-1st-atari-2600-game-man-goes-down/page/18/'] },
  { id: 'fall-down', title: 'Fall Down', developer: 'Aaron Curtis', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x002, pageEnd: 0x002, verified: '2026-08-17', urls: ['https://store.atariage.com/products/fall-down-atari-2600'] },
  { id: 'go-fish', title: 'Go Fish!', developer: 'Bob Montgomery', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x003, pageEnd: 0x003, verified: '2026-08-17', urls: ['https://store.atariage.com/products/go-fish-atari-2600'] },
  { id: 'strat-o-gems-deluxe', title: 'Strat-O-Gems Deluxe', developer: 'John Payson', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x004, pageEnd: 0x007, verified: '2026-08-18' },
  { id: 'astar', title: 'AStar', developer: 'Aaron Curtis', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x008, pageEnd: 0x008, verified: '2026-08-18' },
  { id: 'bonq', title: 'bonQ', developer: 'Ken Siders', platform: 'Atari 7800', kind: 'game', status: 'allocated', pageStart: 0x009, pageEnd: 0x00a, verified: '2026-08-18' },
  { id: 'lead-pitch-omicron-palomino', title: "Lead / Pitch'n'Catch / Omicron / Palomino", developer: 'Simone Serra', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x00b, pageEnd: 0x00b, verified: '2026-08-19' },
  { id: 'elevators-amiss', title: 'Elevators Amiss', developer: 'Bob Montgomery', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x00c, pageEnd: 0x00c, verified: '2026-08-17' },
  { id: 'juno-first', title: 'Juno First', developer: 'Chris Walton', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x00d, pageEnd: 0x00d, verified: '2026-08-17' },
  { id: 'karate-master', title: 'Karate Master', developer: 'Greg Kennedy', platform: 'Atari 2600', kind: 'game', status: 'reserved', pageStart: 0x00e, pageEnd: 0x00e, verified: '2026-08-18', notes: 'Never released on cart, last update 2009, abandoned?' },
  { id: 'fate-of-a-bait', title: 'Fate Of A Bait', developer: 'Christian Hammers', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x00f, pageEnd: 0x00f, verified: '2026-08-19', notes: "Has taken the slot of Mark Ball's 'Halloween game TBA', which apparently never was" },
  { id: 'duck-attack', title: 'Duck Attack!', developer: 'Will Nicholes', platform: 'Atari 2600', kind: 'game', status: 'allocated', pageStart: 0x010, pageEnd: 0x011, verified: '2026-08-17' },
  { id: 'monster', title: 'Monster!', developer: 'Mark Ball', platform: 'Atari 7800', kind: 'game', status: 'reserved', pageStart: 0x012, pageEnd: 0x012, verified: '2026-08-17', notes: 'Never released on cart, abandoned?' },
  { id: 'worm', title: 'Worm!', developer: 'Mark Ball', platform: 'Atari 7800', kind: 'game', status: 'allocated', pageStart: 0x013, pageEnd: 0x013, verified: '2026-08-17' },
  { id: 'indenture-dragon-attack', title: 'Indenture / Dragon Attack', developer: 'Will Nicholes', platform: 'Atari 2600', kind: 'game', status: 'abandoned', pageStart: 0x014, pageEnd: 0x015, verified: '2026-08-31' },
];

// Demo-only stand-in for "has this particular (simulated) stick actually had
// bytes written here" — a real device answers this from actual EEPROM
// content instead (see readPageOccupancy()).
const DEMO_PAGES_WITH_DATA = new Set([0x000, 0x002, 0x008, 0x00c, 0x010, 0x011, 0x013]);

const demoPageOwners = buildPageOwners(allocationEntries, TOTAL_PAGES);

// A page can have more than one owner for real registry data (shared pages
// via `addresses`) — status/first-owner-based rendering just uses the first
// one, which covers the overwhelming common case of one owner per page.
function pageStatus(owners: AllocationEntry[][], page: number): AllocationStatus | 'scratch' | 'free' {
  const list = owners[page];
  if (list && list.length > 0) return list[0].status;
  if (page >= SCRATCHPAD_START && page <= SCRATCHPAD_END) return 'scratch';
  return 'free';
}

const initialTinyElfFiles: TinyElfFile[] = [
  {
    id: 'e1-autorun-bas', name: 'AUTORUN.BAS', extension: 'BAS', size: 96, modified: '08 May 1997 14:32', attributes: 'R/O', driveId: 'E1',
    bytes: Array.from(new TextEncoder().encode('10 REM TinyELF Basic\n20 PRINT "SAVEKEY READY"\n30 GOSUB 1000\n40 END\n')),
  },
  {
    id: 'e1-demo-bas', name: 'DEMO.BAS', extension: 'BAS', size: 64, modified: '07 May 1997 09:18', attributes: 'R/W', driveId: 'E1',
    bytes: Array.from(new TextEncoder().encode('10 REM sprite demo\n20 FOR I=1 TO 10\n30 PRINT I\n40 NEXT I\n')),
  },
  {
    id: 'e1-hiscore-dat', name: 'HISCORE.DAT', extension: 'DAT', size: 128, modified: '06 May 1997 18:02', attributes: 'R/W', driveId: 'E1',
    bytes: Array.from({ length: 128 }, (_, index) => (index * 13 + 5) % 256),
  },
  {
    id: 'e1-readme-txt', name: 'README.TXT', extension: 'TXT', size: 132, modified: '21 Apr 1997 11:05', attributes: 'R/O', driveId: 'E1',
    bytes: Array.from(new TextEncoder().encode('TINYELF BASIC DISK\n\nFlat file storage, no directories (Atari DOS 2.x style).\n')),
  },
  {
    id: 'e2-autorun-bas', name: 'AUTORUN.BAS', extension: 'BAS', size: 96, modified: '08 May 1997 14:32', attributes: 'R/O', driveId: 'E2',
    bytes: Array.from(new TextEncoder().encode('10 REM TinyELF Basic\n20 PRINT "SAVEKEY READY"\n30 GOSUB 1000\n40 END\n')),
  },
  {
    id: 'e2-mathlib-bas', name: 'MATHLIB.BAS', extension: 'BAS', size: 48, modified: '19 Apr 1997 16:47', attributes: 'R/O', driveId: 'E2',
    bytes: Array.from(new TextEncoder().encode('10 REM shared math routines\n')),
  },
  {
    id: 'e2-strlib-bas', name: 'STRLIB.BAS', extension: 'BAS', size: 44, modified: '19 Apr 1997 16:49', attributes: 'R/O', driveId: 'E2',
    bytes: Array.from(new TextEncoder().encode('10 REM shared string routines\n')),
  },
  {
    id: 'e2-sprites-dat', name: 'SPRITES.DAT', extension: 'DAT', size: 1536, modified: '21 Apr 1997 10:41', attributes: 'R/O', driveId: 'E2',
    bytes: Array.from({ length: 1536 }, (_, index) => (index * 11 + 7) % 256),
  },
  {
    id: 'e2-font-dat', name: 'FONT.DAT', extension: 'DAT', size: 768, modified: '21 Apr 1997 10:44', attributes: 'R/O', driveId: 'E2',
    bytes: Array.from({ length: 768 }, (_, index) => (index * 17 + 38) % 256),
  },
  {
    id: 'e2-levels-dat', name: 'LEVELS.DAT', extension: 'DAT', size: 2048, modified: '22 Apr 1997 08:03', attributes: 'R/W', driveId: 'E2',
    bytes: Array.from({ length: 2048 }, (_, index) => (index * 23 + 3) % 256),
  },
  {
    id: 'e2-hiscore-dat', name: 'HISCORE.DAT', extension: 'DAT', size: 128, modified: '06 May 1997 18:02', attributes: 'R/W', driveId: 'E2',
    bytes: Array.from({ length: 128 }, (_, index) => (index * 13 + 5) % 256),
  },
  {
    id: 'e2-readme-txt', name: 'README.TXT', extension: 'TXT', size: 132, modified: '21 Apr 1997 11:05', attributes: 'R/O', driveId: 'E2',
    bytes: Array.from(new TextEncoder().encode('TINYELF BASIC DISK\n\nFlat file storage, no directories (Atari DOS 2.x style).\n')),
  },
];

const initialActivity: ActivityRecord[] = [
  { id: 1, time: '14:36:09', message: 'Drive mounted', detail: 'E1 at 0x50' },
  { id: 2, time: '14:35:47', message: 'Integrity check complete', detail: 'No errors found' },
  { id: 3, time: '14:35:42', message: 'Bus scan', detail: '2 devices responded' },
];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function hex(value: number, length = 2) {
  return value.toString(16).toUpperCase().padStart(length, '0');
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function fileIcon(extension: string) {
  if (extension === 'BAS') return FileCode2;
  if (extension === 'INI' || extension === 'DAT') return FileCog;
  if (extension === 'DRV' || extension === 'MAP') return FileCode2;
  return FileText;
}

function chipLabel(drive: Drive) {
  if (drive.id === 'E1') return '24LC256 (32 KB)';
  return `64 KB block · 2nd EEPROM (${hex(drive.address)})`;
}

// Derived from "FileSystem Design ChatGPT.txt" (repo root): sector size tracks
// the EEPROM's physical page size so one FS sector fits one page write.
// Directory sizing and the exact 64B/128B cutoff are explicitly still open in
// that draft — these are today's best-guess numbers, not a finalized spec.
function tinyElfLayout(drive: Drive) {
  const sectorSize = drive.totalBytes <= 32 * 1024 ? 64 : 128; // 24LC256 page = 64B, 24LC512 page = 128B
  const totalSectors = drive.totalBytes / sectorSize;
  const dataPerSector = sectorSize - 3; // DOS 2.x-style: next sector + file # + byte count
  const entriesPerSector = Math.floor(sectorSize / 16); // 16-byte directory entries
  const directorySectors = drive.totalBytes <= 32 * 1024 ? 4 : 8;
  const maxFiles = directorySectors * entriesPerSector;
  const vtocSectors = Math.max(1, Math.ceil(Math.ceil(totalSectors / 8) / sectorSize));
  const headerSectors = 1;
  const overheadBytes = (headerSectors + vtocSectors + directorySectors) * sectorSize;
  return { sectorSize, totalSectors, dataPerSector, directorySectors, maxFiles, overheadBytes, overheadPercent: (overheadBytes / drive.totalBytes) * 100 };
}

// `systemOverheadBytes`: boot/VTOC/directory sectors on a real TinyELF
// device — permanently unavailable to files, but not reflected in any
// TinyElfFile entry, so callers must add it explicitly (see
// systemOverheadBytes() in Home()).
function driveUsedBytes(drive: Drive, files: TinyElfFile[], systemOverheadBytes = 0, realSaveKeyPages?: boolean[]) {
  if (drive.mode === 'savekey') {
    // Only pages that actually have save data written on this device count as
    // "used" — a reserved-but-empty slot isn't occupying real storage yet.
    // Real devices: count actual occupied pages (see readPageOccupancy()).
    // Demo: same idea, using the hand-authored demo page set.
    const writtenPages = realSaveKeyPages ? realSaveKeyPages.filter(Boolean).length : DEMO_PAGES_WITH_DATA.size;
    return writtenPages * 64;
  }
  // A file's size here is always whole sectors (sectorCount x sectorSize,
  // never the exact byte count) — a sector holding even one byte of a file
  // is entirely unavailable to any other file, so free space must be
  // computed in whole sectors too, not fractional bytes.
  const filesBytes = files.filter((file) => file.driveId === drive.id).reduce((total, file) => total + file.size, 0);
  return filesBytes + systemOverheadBytes;
}

function Home() {
  const [drives, setDrives] = useState(initialDrives);
  const [activeDriveId, setActiveDriveId] = useState('E2');
  const [files, setFiles] = useState(initialTinyElfFiles);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedAllocationId, setSelectedAllocationId] = useState<string | null>('duck-attack');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'icons'>('list');
  const [previewMode, setPreviewMode] = useState<'preview' | 'hex'>('preview');
  const [activity, setActivity] = useState(initialActivity);
  const [dialog, setDialog] = useState<'delete' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const picoBridge = usePicoBridge();
  const [formatTarget, setFormatTarget] = useState<DetectedDevice | null>(null);
  const [formatCapacityKiB, setFormatCapacityKiB] = useState(32);
  const [formatStatus, setFormatStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [formatMessage, setFormatMessage] = useState('');
  const [liveDrives, setLiveDrives] = useState<Record<string, { device: DetectedDevice; layout: TinyElfLayout }>>({});
  const [liveSaveKeyPages, setLiveSaveKeyPages] = useState<Record<string, boolean[]>>({});
  const [saveKeyRegistry, setSaveKeyRegistry] = useState<SaveKeyRegistry | null>(null);
  const [saveKeyRegistryStatus, setSaveKeyRegistryStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  const activeDrive = drives.find((drive) => drive.id === activeDriveId) ?? drives[0];
  const isSaveKeyView = activeDrive.mode === 'savekey';
  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;

  // A real connected classic-format drive uses the live community registry
  // (once fetched) instead of the hardcoded demo entries — see the
  // app-start fetch effect below.
  const activeSaveKeyPages = liveSaveKeyPages[activeDriveId];
  const isRealSaveKeyDrive = isSaveKeyView && activeSaveKeyPages !== undefined;
  const activeAllocationEntries = isRealSaveKeyDrive ? (saveKeyRegistry?.entries ?? []) : allocationEntries;
  const activeTotalPages = isRealSaveKeyDrive ? (saveKeyRegistry?.totalPages ?? TOTAL_PAGES) : TOTAL_PAGES;
  const activePageOwners = useMemo(
    () => (isRealSaveKeyDrive ? buildPageOwners(activeAllocationEntries, activeTotalPages) : demoPageOwners),
    [isRealSaveKeyDrive, activeAllocationEntries, activeTotalPages],
  );
  const activePageHasData = (page: number) =>
    activeSaveKeyPages ? activeSaveKeyPages[page] === true : DEMO_PAGES_WITH_DATA.has(page);
  const selectedAllocation = activeAllocationEntries.find((entry) => entry.id === selectedAllocationId) ?? null;

  const driveFiles = useMemo(() => files.filter((file) => file.driveId === activeDriveId), [activeDriveId, files]);
  const visibleFiles = useMemo(
    () => driveFiles.filter((file) => `${file.name} ${file.extension}`.toLowerCase().includes(query.toLowerCase())),
    [driveFiles, query],
  );
  const visibleAllocations = useMemo(
    () =>
      activeAllocationEntries.filter((entry) =>
        `${entry.title} ${entry.developer ?? ''} ${entry.platform ?? ''}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [activeAllocationEntries, query],
  );
  const systemOverheadBytes = (driveId: string) => {
    const live = liveDrives[driveId];
    return live ? live.layout.dataStart * live.layout.sectorSize : 0;
  };
  const usedBytes = driveUsedBytes(activeDrive, files, systemOverheadBytes(activeDrive.id), activeSaveKeyPages);
  const formatLayout = useMemo(() => computeTinyElfLayout(formatCapacityKiB * 1024), [formatCapacityKiB]);

  const pushActivity = (message: string, detail?: string) => {
    setActivity((items) => [{ id: Date.now(), time: nowTime(), message, detail }, ...items].slice(0, 7));
  };

  const openFormatDialog = (device: DetectedDevice) => {
    setFormatTarget(device);
    setFormatCapacityKiB(guessCapacityKiB(device));
    setFormatStatus('idle');
    setFormatMessage('');
  };

  const closeFormatDialog = () => {
    if (formatStatus === 'running') return;
    setFormatTarget(null);
  };

  const runFormat = async () => {
    const bridge = picoBridge.bridge;
    if (!formatTarget || !bridge) return;
    setFormatStatus('running');
    try {
      await formatDevice(bridge, formatTarget, formatCapacityKiB * 1024, setFormatMessage);
      setFormatStatus('done');
      pushActivity('Device formatted', `${hex(formatTarget.startAddress)} · ${formatCapacityKiB} KiB`);
      await picoBridge.rescan();
    } catch (error) {
      setFormatStatus('error');
      setFormatMessage(error instanceof Error ? error.message : String(error));
    }
  };

  // Replaces the demo drives/files with what's actually on the connected
  // hardware — reads each detected device's real header (if TinyELF-
  // formatted) and real directory, instead of showing made-up sample data
  // once real hardware is present. Reverts to the demo data on disconnect.
  // Exposed as a function (not just inline in the effect) so a real SAVE
  // can trigger a re-read of just-changed drives afterwards.
  const loadLiveData = useCallback(async (bridge: PicoBridge, devices: DetectedDevice[], registry: SaveKeyRegistry | null) => {
    const realDrives: Drive[] = [];
    const realFiles: TinyElfFile[] = [];
    const layouts: Record<string, { device: DetectedDevice; layout: TinyElfLayout }> = {};
    const savekeyPages: Record<string, boolean[]> = {};
    for (const device of devices) {
      const id = driveLabelForAddress(device.startAddress);
      const layout = await readTinyElfHeader(bridge, device).catch(() => null);
      if (layout) {
        realDrives.push({
          id,
          label: id,
          address: device.startAddress,
          totalBytes: layout.sectorSize * layout.totalSectors,
          mode: 'tinyelf-fs',
          canChangeMode: false,
        });
        layouts[id] = { device, layout };
        const entries = await readDirectory(bridge, device, layout).catch(() => []);
        for (const entry of entries) {
          realFiles.push({
            id: `${id}-${entry.startSector}`,
            // The file table only ever renders `name` (see the demo data
            // convention: "AUTORUN.BAS", not "AUTORUN" + separate ".BAS") —
            // `extension` alone is just for the icon/search match.
            name: entry.extension ? `${entry.name}.${entry.extension}` : entry.name,
            extension: entry.extension,
            // Approximate (sector count x sector size) — matches how
            // classic DOS 2.x catalog listings work too (directory only
            // ever stores sector count, never exact bytes). Getting the
            // exact size means walking every file's sector chain, which
            // doesn't scale to a large directory if done eagerly for the
            // whole listing — see computeExactFileSize(), used lazily
            // instead when a file is actually opened, below.
            size: entry.sectorCount * layout.sectorSize,
            modified: '',
            attributes: entry.locked ? 'R/O' : 'R/W',
            driveId: id,
            bytes: [],
            startSector: entry.startSector,
          });
        }
      } else {
        // Not TinyELF-formatted — treat as the classic SaveKey allocation
        // format instead. Page size/count come from the registry once
        // loaded (it's the single source of truth per the project docs);
        // fall back to the well-known SaveKey hardware constants (32 KiB /
        // 64 B pages) so occupancy can still be read before/without it.
        const pageSize = registry?.pageSize ?? 64;
        const totalPages = registry?.totalPages ?? TOTAL_PAGES;
        const occupancy = await readPageOccupancy(bridge, device, pageSize, totalPages).catch(() => null);
        realDrives.push({
          id,
          label: id,
          address: device.startAddress,
          totalBytes: pageSize * totalPages,
          mode: 'savekey',
          canChangeMode: false,
        });
        if (occupancy) savekeyPages[id] = occupancy;
      }
    }
    return { realDrives, realFiles, layouts, savekeyPages };
  }, []);

  // Always load the live community allocation registry on app start (not
  // just once a real classic-format device shows up) so it's ready the
  // moment one connects, and stays the single source of truth per the
  // registry's own README.
  useEffect(() => {
    let cancelled = false;
    fetchSaveKeyRegistry()
      .then((registry) => {
        if (cancelled) return;
        setSaveKeyRegistry(registry);
        setSaveKeyRegistryStatus('loaded');
      })
      .catch((error) => {
        if (cancelled) return;
        setSaveKeyRegistryStatus('error');
        pushActivity('Allocation registry load failed', error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const bridge = picoBridge.bridge;
    if (picoBridge.status !== 'connected' || !bridge) {
      if (picoBridge.status === 'idle') {
        setDrives(initialDrives);
        setFiles(initialTinyElfFiles);
        setActiveDriveId('E2');
        setLiveDrives({});
      }
      return;
    }

    let cancelled = false;
    (async () => {
      const { realDrives, realFiles, layouts, savekeyPages } = await loadLiveData(bridge, picoBridge.devices, saveKeyRegistry);
      if (!cancelled && realDrives.length > 0) {
        setDrives(realDrives);
        setFiles(realFiles);
        setActiveDriveId(realDrives[0].id);
        setLiveDrives(layouts);
        setLiveSaveKeyPages(savekeyPages);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [picoBridge.status, picoBridge.devices, picoBridge.bridge, loadLiveData, saveKeyRegistry]);

  // Lazily loads a real file's actual content the moment it's selected,
  // instead of eagerly for every listed file — walks the sector chain via
  // loadFileContent(). Demo files already carry their bytes and are
  // skipped (no startSector).
  useEffect(() => {
    const bridge = picoBridge.bridge;
    if (!selectedFile || !bridge) return;
    const startSector = selectedFile.startSector;
    if (startSector === undefined || selectedFile.bytes.length > 0) return;
    const live = liveDrives[selectedFile.driveId];
    if (!live) return;

    let cancelled = false;
    (async () => {
      try {
        const content = await loadFileContent(bridge, live.device, live.layout, startSector);
        if (cancelled) return;
        const fileId = selectedFile.id;
        setFiles((items) =>
          items.map((item) => (item.id === fileId ? { ...item, bytes: Array.from(content), size: content.length } : item)),
        );
      } catch (error) {
        pushActivity('Load failed', error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFile, liveDrives, picoBridge.bridge]);

  const selectDrive = (driveId: string) => {
    if (driveId === activeDriveId) return;
    setActiveDriveId(driveId);
    setSelectedFileId(null);
    setSelectedAllocationId(null);
    setQuery('');
    const drive = drives.find((item) => item.id === driveId);
    pushActivity('Drive selected', drive ? `${drive.label} at ${hex(drive.address)}` : driveId);
  };

  const setDriveMode = (driveId: string, mode: DriveMode) => {
    setDrives((items) => items.map((item) => (item.id === driveId ? { ...item, mode } : item)));
    setSelectedFileId(null);
    setSelectedAllocationId(mode === 'savekey' ? 'duck-attack' : null);
    const drive = drives.find((item) => item.id === driveId);
    pushActivity('Format changed', `${drive?.label ?? driveId} → ${mode === 'savekey' ? 'SaveKey allocation list' : 'TinyELF Basic filesystem'}`);
  };

  const importFile = async (pickedFile: File) => {
    const bytes = new Uint8Array(await pickedFile.arrayBuffer());
    const live = liveDrives[activeDriveId];

    // A real device is connected, but this specific drive has no valid
    // TinyELF header — refuse rather than silently falling through to the
    // local-only demo behavior below, which would look like a real upload
    // succeeded (and real delete) without ever touching the hardware.
    if (picoBridge.status === 'connected' && !live) {
      pushActivity('Save failed', 'This device is not TinyELF-formatted — use Format first.');
      return;
    }

    if (live && picoBridge.bridge) {
      const bridge = picoBridge.bridge;
      try {
        pushActivity('Uploading file', `${pickedFile.name} · ${formatSize(bytes.length)}`);
        const saved = await saveFile(bridge, live.device, live.layout, pickedFile.name, bytes);
        const { realDrives, realFiles, layouts, savekeyPages } = await loadLiveData(bridge, picoBridge.devices, saveKeyRegistry);
        setDrives(realDrives);
        setFiles(realFiles);
        setLiveDrives(layouts);
        setLiveSaveKeyPages(savekeyPages);
        setSelectedFileId(`${activeDriveId}-${saved.startSector}`);
        pushActivity('File saved', `${saved.name}.${saved.extension} · sector ${saved.startSector} · ${saved.sectorCount} sector${saved.sectorCount === 1 ? '' : 's'}`);
      } catch (error) {
        pushActivity('Save failed', error instanceof Error ? error.message : String(error));
      }
      return;
    }

    // No real hardware connected for this drive — fall back to the local
    // demo-only behavior (works on the sample E1/E2 drives).
    const rawName = pickedFile.name.toUpperCase();
    const extension = rawName.includes('.') ? rawName.split('.').pop() ?? 'BIN' : 'BIN';
    const file: TinyElfFile = {
      id: `file-${Date.now()}`,
      name: rawName,
      extension,
      size: bytes.length,
      modified: '08 May 1997 14:38',
      attributes: 'R/W',
      driveId: activeDriveId,
      bytes: Array.from(bytes),
    };
    setFiles((items) => [...items, file]);
    setSelectedFileId(file.id);
    pushActivity('File imported', `${file.name} · ${formatSize(file.size)}`);
  };

  const exportFile = () => {
    if (!selectedFile) return;
    const blob = new Blob([new Uint8Array(selectedFile.bytes)], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = selectedFile.name;
    link.click();
    URL.revokeObjectURL(link.href);
    pushActivity('File exported', selectedFile.name);
  };

  const removeFile = () => {
    if (!selectedFile) return;
    // Real DELETE (flip the directory entry's flag, free its VTOC bits)
    // isn't implemented yet — refuse rather than silently removing it from
    // the local view only, which would look like a real delete happened.
    if (liveDrives[selectedFile.driveId]) {
      pushActivity('Delete failed', 'Deleting files on real hardware is not implemented yet.');
      setDialog(null);
      return;
    }
    pushActivity('File deleted', selectedFile.name);
    setFiles((items) => items.filter((file) => file.id !== selectedFile.id));
    setSelectedFileId(null);
    setDialog(null);
  };

  const refreshDrive = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const bridge = picoBridge.bridge;
    if (picoBridge.status === 'connected' && bridge) {
      pushActivity(isSaveKeyView ? 'Reloading registry' : 'Refreshing drive', isSaveKeyView ? 'Re-reading EEPROM page occupancy' : 'Reading directory table');
      try {
        const { realDrives, realFiles, layouts, savekeyPages } = await loadLiveData(bridge, picoBridge.devices, saveKeyRegistry);
        setDrives(realDrives);
        setFiles(realFiles);
        setLiveDrives(layouts);
        setLiveSaveKeyPages(savekeyPages);
        pushActivity(isSaveKeyView ? 'Registry reloaded' : 'Drive refreshed', isSaveKeyView ? `${activeTotalPages} pages re-read` : `${realFiles.filter((file) => file.driveId === activeDriveId).length} files indexed`);
      } catch (error) {
        pushActivity('Refresh failed', error instanceof Error ? error.message : String(error));
      }
      setIsRefreshing(false);
      return;
    }

    pushActivity(isSaveKeyView ? 'Reloading registry' : 'Refreshing drive', isSaveKeyView ? 'Re-reading allocation list' : 'Reading directory table');
    window.setTimeout(() => {
      setIsRefreshing(false);
      pushActivity(isSaveKeyView ? 'Registry reloaded' : 'Drive refreshed', isSaveKeyView ? `${allocationEntries.length} entries indexed` : `${driveFiles.length} files indexed`);
    }, 600);
  };

  const selectPage = (page: number) => {
    const owners = activePageOwners[page];
    if (owners && owners.length > 0) setSelectedAllocationId(owners[0].id);
  };

  // An entry can span several pages — "has data" for the whole entry means
  // at least one of its pages actually has something written.
  const entryHasAnyData = (entry: AllocationEntry) => {
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      if (activePageHasData(page)) return true;
    }
    return false;
  };

  const selectedPreview = selectedFile?.bytes.length
    ? new TextDecoder().decode(new Uint8Array(selectedFile.bytes)).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '·')
    : '';
  const hexRows = selectedFile ? Array.from({ length: Math.min(8, Math.ceil(selectedFile.bytes.length / 16)) }, (_, row) => selectedFile.bytes.slice(row * 16, row * 16 + 16)) : [];

  return (
    <div className="console-app">
      <aside className="console-sidebar" data-testid="sidebar-drive">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><CircuitBoard size={22} strokeWidth={1.8} /></div>
          <div>
            <p className="brand-name">SaveKey-Manager</p>
             <p className="brand-sub">i2c utility · rev 0.2</p>
          </div>
        </div>
         <p className="side-label">Manual index</p>
        <nav className="nav-list" aria-label="Utility sections">
           <button className="nav-item active" data-testid="nav-drive"><HardDrive size={16} /><span>Directory</span></button>
           <button className="nav-item" data-testid="nav-activity" onClick={() => document.getElementById('activity-log')?.scrollIntoView({ behavior: 'smooth' })}><Activity size={16} /><span>Activity log</span></button>
           <button className="nav-item" data-testid="nav-hardware" onClick={() => document.getElementById('hardware-status')?.scrollIntoView({ behavior: 'smooth' })}><Network size={16} /><span>Bus diagnostics</span></button>
        </nav>
        <div className="drive-list">
          {drives.map((drive) => {
            const driveUsed = driveUsedBytes(drive, files, systemOverheadBytes(drive.id), liveSaveKeyPages[drive.id]);
            return (
              <div className={`drive-card ${drive.id === activeDriveId ? 'active' : ''}`} key={drive.id} onClick={() => selectDrive(drive.id)} data-testid={`card-drive-${drive.id}`}>
                <div className="drive-mini-head">
                  <strong>{drive.label}</strong>
                  {drive.id === activeDriveId && <button className="eject-btn" title="Refresh drive" onClick={refreshDrive} data-testid={`button-refresh-${drive.id}`}><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /></button>}
                </div>
                <div className="meter-label"><span>used space</span><b>{formatSize(driveUsed)} / {formatSize(drive.totalBytes)}</b></div>
                <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, (driveUsed / drive.totalBytes) * 100)}%` }} /></div>
                <div className="mini-meta">I²C · {hex(drive.address)}</div>
                {drive.canChangeMode ? (
                  <div className="view-switch mode-toggle" role="group" aria-label={`${drive.label} format`}>
                    <button className={drive.mode === 'savekey' ? 'selected' : ''} onClick={() => setDriveMode(drive.id, 'savekey')} data-testid={`button-mode-savekey-${drive.id}`}>SaveKey</button>
                    <button className={drive.mode === 'tinyelf-fs' ? 'selected' : ''} onClick={() => setDriveMode(drive.id, 'tinyelf-fs')} data-testid={`button-mode-tinyelf-${drive.id}`}>TinyELF</button>
                  </div>
                ) : (
                  <div className="mode-static">TinyELF Basic</div>
                )}
              </div>
            );
          })}
        </div>
         <div className="side-footer"><span><i className="online-dot" />ready</span><span>local mode</span></div>
      </aside>

      <main className="console-main">
        <header className="topbar">
          <div>
             <div className="topbar-kicker">chapter 03 / directory control</div>
             <h1 className="topbar-title">{isSaveKeyView ? 'Allocation registry' : 'Disk directory'}</h1>
          </div>
          <div className="topbar-actions">
             <div className="hardware-chip"><i className="online-dot" /> bus online · {hex(activeDrive.address)}</div>
            <button className="action-button" onClick={refreshDrive} data-testid="button-refresh-drive" title={isSaveKeyView ? 'Re-read the allocation list' : 'Read the directory again'}><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /><span>Refresh</span></button>
          </div>
        </header>

        {isSaveKeyView ? (
          <section className="toolbar" aria-label="Allocation actions">
            <a className="action-button" href={ALLOCATION_LIST_URL} target="_blank" rel="noopener noreferrer" data-testid="link-allocation-source"><ExternalLink size={14} /><span>View registry source</span></a>
            <div className="tool-divider" />
            <div className="search-wrap"><Search size={15} /><input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, developer, platform" aria-label="Filter allocation entries" data-testid="input-search-allocations" /></div>
          </section>
        ) : (
          <section className="toolbar" aria-label="File actions">
             <button className="action-button" onClick={() => fileInputRef.current?.click()} data-testid="button-import"><Upload size={14} /><span>Read into disk</span></button>
            <input ref={fileInputRef} type="file" hidden onChange={(event) => { const picked = event.target.files?.[0]; if (picked) void importFile(picked); event.target.value = ''; }} data-testid="input-file-import" />
             <button className="action-button" disabled={!selectedFile} onClick={exportFile} data-testid="button-export"><Download size={14} /><span>Write out</span></button>
             <button className="action-button danger" disabled={!selectedFile} onClick={() => setDialog('delete')} data-testid="button-delete"><Trash2 size={14} /><span>Erase</span></button>
            <div className="tool-divider" />
             <div className="search-wrap"><Search size={15} /><input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search directory entries" aria-label="Filter files" data-testid="input-search-files" /></div>
            <div className="view-switch" aria-label="View mode">
              <button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')} title="List view" data-testid="button-list-view"><List size={15} /></button>
              <button className={view === 'icons' ? 'selected' : ''} onClick={() => setView('icons')} title="Icon view" data-testid="button-icon-view"><MoreHorizontal size={15} /></button>
            </div>
          </section>
        )}

        <div className="breadcrumbs" aria-label="Current drive">
          <span className="crumb current">{activeDrive.label} · {hex(activeDrive.address)} · {isSaveKeyView ? 'SaveKey allocation registry' : 'TinyELF Basic filesystem'}</span>
        </div>

        <div className="workspace">
          {isSaveKeyView ? (
            <section className="file-panel" aria-label="Allocation registry">
              <div className="panel-head">
                <div className="panel-title">
                  <LayoutGrid size={18} className="folder-icon" />
                  <div><h2>{activeDrive.label} · Allocation map</h2><p>{isRealSaveKeyDrive ? `${activeSaveKeyPages!.filter(Boolean).length} of ${activeTotalPages} pages have data on this stick` : `${allocationEntries.filter((entry) => DEMO_PAGES_WITH_DATA.has(entry.pageStart)).length} of ${allocationEntries.length} known slots have data on this stick`}</p></div>
                </div>
                <span className="folder-count">{activeAllocationEntries.length}</span>
              </div>
              <div className="page-map" role="grid" aria-label="EEPROM page map">
                {Array.from({ length: activeTotalPages }, (_, page) => {
                  const status = pageStatus(activePageOwners, page);
                  const owners = activePageOwners[page] ?? [];
                  const owner = owners[0] ?? null;
                  const hasData = activePageHasData(page);
                  const ownerNames = owners.map((o) => o.title).join(' / ');
                  const dataTitle = owner
                    ? `${hex(page, 3)} · ${ownerNames} — ${hasData ? 'has data' : 'reserved, no data on this device'}`
                    : `${hex(page, 3)} · ${hasData ? 'has data' : status}`;
                  return (
                    <button
                      key={page}
                      className={`page-cell status-${status} ${hasData ? 'has-data' : ''} ${owner && owner.id === selectedAllocationId ? 'selected' : ''}`}
                      onClick={() => selectPage(page)}
                      title={dataTitle}
                      data-testid={`page-cell-${page}`}
                    />
                  );
                })}
              </div>
              <div className="page-map-legend">
                <span><i className="page-cell status-allocated has-data" />has data</span>
                <span><i className="page-cell status-allocated" />reserved, no data</span>
                <span><i className="page-cell status-reserved" />reserved (unreleased)</span>
                <span><i className="page-cell status-abandoned" />abandoned</span>
                <span><i className="page-cell status-scratch" />scratchpad</span>
                <span><i className="page-cell status-free" />free</span>
              </div>
              <table className="file-table">
                <thead><tr><th style={{ width: '34%' }}>Title</th><th style={{ width: '18%' }}>Developer</th><th style={{ width: '14%' }}>Platform</th><th style={{ width: '12%' }}>Pages</th><th style={{ width: '12%' }}>Status</th><th>On device</th></tr></thead>
                <tbody>
                  {visibleAllocations.map((entry) => (
                    <tr className={`file-row ${selectedAllocationId === entry.id ? 'selected' : ''}`} key={entry.id} onClick={() => setSelectedAllocationId(entry.id)} data-testid={`row-allocation-${entry.id}`}>
                      <td><div className="name-cell"><span className="file-name">{entry.title}</span></div></td>
                      <td>{entry.developer ?? '—'}</td>
                      <td>{entry.platform ?? '—'}</td>
                      <td>{hex(entry.pageStart, 3)}–{hex(entry.pageEnd, 3)}</td>
                      <td><span className={`tag status-${entry.status}`}>{entry.status}</span></td>
                      <td>{entryHasAnyData(entry) ? <span className="tag has-data-tag">data</span> : <span className="tag no-data-tag">empty</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleAllocations.length && <div className="empty-state"><div className="empty-icon"><Search size={21} /></div><h3>No matching entries</h3><p>Try a different title, developer, or platform.</p></div>}
            </section>
          ) : (
            <section className="file-panel" aria-label="Drive contents">
              <div className="panel-head">
                <div className="panel-title">
                  <HardDrive size={18} className="folder-icon" />
                  <div><h2>{activeDrive.label} · TinyELF FS</h2><p>{visibleFiles.length} file{visibleFiles.length === 1 ? '' : 's'}</p></div>
                </div>
                <span className="folder-count">{visibleFiles.length}</span>
              </div>
              {view === 'list' ? (
                <table className="file-table">
                  <thead><tr><th style={{ width: '42%' }}>Name</th><th style={{ width: '16%' }}>Size</th><th style={{ width: '26%' }}>Modified</th><th>Attr</th></tr></thead>
                  <tbody>
                    {visibleFiles.map((file) => { const Icon = fileIcon(file.extension); return (
                      <tr className={`file-row ${selectedFileId === file.id ? 'selected' : ''}`} key={file.id} onClick={() => setSelectedFileId(file.id)} data-testid={`row-file-${file.id}`}>
                        <td><div className="name-cell"><Icon size={16} className="file-icon" /><span className="file-name">{file.name}</span></div></td><td>{formatSize(file.size)}</td><td>{file.modified}</td><td><span className="tag">{file.attributes}</span></td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              ) : (
                <div className="folder-grid">
                  {visibleFiles.map((file) => { const Icon = fileIcon(file.extension); return <button className={`file-card ${selectedFileId === file.id ? 'selected' : ''}`} key={file.id} onClick={() => setSelectedFileId(file.id)} data-testid={`card-file-${file.id}`}><div className="file-card-top"><Icon size={20} className="file-icon" /><span className="tag">{file.extension}</span></div><div className="file-card-title"><strong>{file.name}</strong></div><div className="file-card-meta"><span>{formatSize(file.size)}</span><span>{file.attributes}</span></div></button>; })}
                </div>
              )}
              {!visibleFiles.length && (() => {
                const notFormatted = picoBridge.status === 'connected' && !liveDrives[activeDriveId];
                return (
                  <div className="empty-state">
                    <div className="empty-icon">{query ? <Search size={21} /> : <Archive size={21} />}</div>
                    <h3>{query ? 'No matching files' : notFormatted ? 'Not TinyELF-formatted' : 'This drive is empty'}</h3>
                    <p>{query ? 'Try a different name or clear the filter.' : notFormatted ? 'Use the Format button in Live hardware to initialize this device first.' : 'Import a file here to begin.'}</p>
                  </div>
                );
              })()}
            </section>
          )}

          <aside className="right-rail">
            <section className="hardware-panel" data-testid="panel-pico-bridge">
              <div className="hardware-heading">
                <div><h2>Live hardware</h2><p>Pico bridge (walking skeleton)</p></div>
                {picoBridge.status === 'connected' && <span className="connected-badge"><i /> connected</span>}
              </div>
              <div className="hardware-list">
                {!picoBridge.isSupported ? (
                  <p className="protect-line">Web Serial is not supported in this browser — use Chrome, Edge, or Firefox 151+.</p>
                ) : picoBridge.status === 'connecting' ? (
                  <p className="protect-line">Connecting…</p>
                ) : picoBridge.status === 'connected' ? (
                  <>
                    {picoBridge.devices.length === 0 ? (
                      <p className="protect-line">No device detected on the bus.</p>
                    ) : (
                      picoBridge.devices.map((device) => (
                        <div className="hardware-stat" key={device.startAddress}>
                          <span>
                            {device.addressCount === 1
                              ? hex(device.startAddress)
                              : `${hex(device.startAddress)}–${hex(device.startAddress + device.addressCount - 1)}`}
                          </span>
                          <strong>{formatSize(device.capacityBytes)}</strong>
                          <button
                            className="action-button"
                            onClick={() => openFormatDialog(device)}
                            data-testid={`button-format-${hex(device.startAddress)}`}
                          >
                            <span>Format</span>
                          </button>
                        </div>
                      ))
                    )}
                    <div className="tool-divider" />
                    <button className="action-button" onClick={() => void picoBridge.rescan()} data-testid="button-rescan-pico">
                      <RefreshCw size={14} /><span>Rescan</span>
                    </button>
                    <button className="action-button" onClick={() => void picoBridge.disconnect()} data-testid="button-disconnect-pico">
                      <span>Disconnect</span>
                    </button>
                  </>
                ) : (
                  <>
                    {picoBridge.status === 'error' && picoBridge.errorMessage && (
                      <p className="protect-line">{picoBridge.errorMessage}</p>
                    )}
                    <button className="action-button" onClick={() => void picoBridge.connect()} data-testid="button-connect-pico">
                      <Network size={14} /><span>Connect to Pico bridge</span>
                    </button>
                  </>
                )}
              </div>
            </section>

            <section className="hardware-panel" id="hardware-status" data-testid="panel-hardware-status">
               <div className="hardware-heading"><div><h2>Bus diagnostics</h2><p>live I²C telemetry</p></div><span className="connected-badge"><i /> online</span></div>
              <div className="hardware-list">
                <div className="hardware-stat"><span>Bus address</span><strong>{hex(activeDrive.address)}</strong></div>
                <div className="hardware-stat"><span>Device type</span><strong>{chipLabel(activeDrive)}</strong></div>
                <div className="hardware-stat"><span>Capacity</span><strong>{formatSize(activeDrive.totalBytes)}</strong></div>
                <div className="hardware-stat"><span>Write protect</span><strong className="good">enabled</strong></div>
                <div className="capacity-block">
                  <div className="capacity-line"><span>used / free</span><strong>{formatSize(usedBytes)} / {formatSize(activeDrive.totalBytes - usedBytes)}</strong></div>
                  <div className="capacity-track"><span style={{ width: `${Math.min(100, (usedBytes / activeDrive.totalBytes) * 100)}%` }} /></div>
                  <div className="capacity-line"><span>{isSaveKeyView ? 'pages with data' : 'directory entries'}</span><strong>{isSaveKeyView ? `${isRealSaveKeyDrive ? activeSaveKeyPages!.filter(Boolean).length : DEMO_PAGES_WITH_DATA.size} of ${activeTotalPages} pages` : `${driveFiles.length} files`}</strong></div>
                </div>
                {!isSaveKeyView && (() => {
                  const layout = tinyElfLayout(activeDrive);
                  return (
                    <div className="capacity-block" title="Derived from the TinyELF FS design draft — sector-size cutoff and directory sizing are still open there">
                      <div className="capacity-line"><span>TinyELF FS sectors</span><strong>{layout.totalSectors} × {layout.sectorSize} B</strong></div>
                      <div className="capacity-line"><span>sector data</span><strong>{layout.dataPerSector} B (3 B chain/ctrl)</strong></div>
                      <div className="capacity-line"><span>directory</span><strong>{layout.directorySectors} sectors · {layout.maxFiles} files max</strong></div>
                      <div className="capacity-line"><span>fs overhead</span><strong>{formatSize(layout.overheadBytes)} ({layout.overheadPercent.toFixed(1)}%)</strong></div>
                    </div>
                  );
                })()}
                <div className="protect-line"><ShieldCheck size={14} /> writes require physical WP switch off</div>
              </div>
            </section>

            {isSaveKeyView ? (
              <section className="preview-panel" data-testid="panel-allocation-inspector">
                <div className="preview-head"><h2>Allocation inspector</h2></div>
                <div className="preview-body">
                  {!selectedAllocation ? (
                    <div className="preview-empty"><div><Hexagon size={25} /><br />Select a page or registry entry to inspect it.</div></div>
                  ) : (
                    <div className="allocation-detail">
                      <div className="preview-file-title"><LayoutGrid size={15} />{selectedAllocation.title}<small className={`status-${selectedAllocation.status}`}>{selectedAllocation.status}</small></div>
                      <div className={`detail-row detail-data-row ${entryHasAnyData(selectedAllocation) ? 'has-data' : 'no-data'}`}><span>On this device</span><span>{entryHasAnyData(selectedAllocation) ? 'Save data present' : 'No data — slot reserved only'}</span></div>
                      <div className="detail-row"><span>Kind</span><span>{selectedAllocation.kind}</span></div>
                      {selectedAllocation.developer && <div className="detail-row"><span>Developer</span><span>{selectedAllocation.developer}</span></div>}
                      {selectedAllocation.platform && <div className="detail-row"><span>Platform</span><span>{selectedAllocation.platform}</span></div>}
                      <div className="detail-row"><span>Pages</span><span>{hex(selectedAllocation.pageStart, 3)}–{hex(selectedAllocation.pageEnd, 3)}</span></div>
                      <div className="detail-row"><span>Byte range</span><span>{hex(selectedAllocation.pageStart * 64, 4)}–{hex(selectedAllocation.pageEnd * 64 + 63, 4)}</span></div>
                      {selectedAllocation.verified && <div className="detail-row"><span>Verified</span><span>{selectedAllocation.verified}</span></div>}
                      {selectedAllocation.notes && <div className="detail-notes">{selectedAllocation.notes}</div>}
                      {selectedAllocation.urls && selectedAllocation.urls.length > 0 && (
                        <div className="detail-links">
                          {selectedAllocation.urls.map((url) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="preview-panel" data-testid="panel-file-inspector">
                <div className="preview-head"><h2>File inspector</h2><div className="preview-tabs"><button className={previewMode === 'preview' ? 'active' : ''} onClick={() => setPreviewMode('preview')} data-testid="button-preview-mode">Preview</button><button className={previewMode === 'hex' ? 'active' : ''} onClick={() => setPreviewMode('hex')} data-testid="button-hex-mode">Hex</button></div></div>
                <div className="preview-body">
                  {!selectedFile ? <div className="preview-empty"><div><Hexagon size={25} /><br />Select a file to inspect its contents.</div></div> : previewMode === 'preview' ? <div className="preview-content"><div className="preview-file-title"><FileText size={15} />{selectedFile.name}<small>{formatSize(selectedFile.size)}</small></div>{selectedPreview || 'Binary data — switch to Hex for a byte-level view.'}</div> : <div className="hex-view"><div className="preview-file-title"><Hexagon size={15} />{selectedFile.name}<small>{selectedFile.bytes.length} bytes</small></div>{hexRows.map((row, index) => <div className="hex-row" key={index}><span className="hex-address">{hex(index * 16, 4)}</span><span className="hex-bytes">{row.map((byte) => hex(byte)).join(' ')}</span><span className="hex-ascii">{row.map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '·').join('')}</span></div>)}</div>}
                </div>
              </section>
            )}

            <section className="activity-panel" id="activity-log" data-testid="panel-activity-log">
               <div className="activity-title"><Activity size={14} /><strong>Operations log</strong></div>
              <div className="activity-list">{activity.map((item) => <div className="activity-item" key={item.id}><span className="activity-time">{item.time}</span><span className="activity-copy"><strong>{item.message}</strong>{item.detail ? ` · ${item.detail}` : ''}</span></div>)}</div>
            </section>
          </aside>
        </div>
      </main>

      {formatTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeFormatDialog(); }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="format-dialog-title">
            <div className="modal-head">
              <div>
                <h2 id="format-dialog-title">Format device {driveLabelForAddress(formatTarget.startAddress)} ({hex(formatTarget.startAddress)})</h2>
                <p>Writes only the boot sector, VTOC, and directory — existing data sectors are left untouched.</p>
              </div>
              <button className="modal-close" onClick={closeFormatDialog} disabled={formatStatus === 'running'} data-testid="button-close-format-dialog">
                <X size={17} />
              </button>
            </div>
            <div className="modal-body">
              <label className="detail-row" htmlFor="format-capacity-select">
                <span>EEPROM capacity</span>
                <select
                  id="format-capacity-select"
                  value={formatCapacityKiB}
                  disabled={formatStatus === 'running'}
                  onChange={(event) => setFormatCapacityKiB(Number(event.target.value))}
                  data-testid="select-format-capacity"
                >
                  {EEPROM_CAPACITY_OPTIONS_KIB.map((kib) => (
                    <option key={kib} value={kib}>{kib} KiB</option>
                  ))}
                </select>
              </label>
              <div className="format-summary" title="Computed from the chosen capacity — see firmware/pico-bridge README / tinyelf-format.ts for the exact layout rules">
                <div className="format-summary-line"><span>Sector size</span><strong>{formatLayout.sectorSize} B</strong></div>
                <div className="format-summary-line"><span>Total sectors</span><strong>{formatLayout.totalSectors}</strong></div>
                <div className="format-summary-line"><span>VTOC</span><strong>sector {formatLayout.vtocStart}, {formatLayout.vtocSectors} sector{formatLayout.vtocSectors === 1 ? '' : 's'}</strong></div>
                <div className="format-summary-line"><span>Directory</span><strong>sector {formatLayout.directoryStart}, {formatLayout.directorySectors} sector{formatLayout.directorySectors === 1 ? '' : 's'} · {formatLayout.maxFiles} files max</strong></div>
                <div className="format-summary-line"><span>Data region</span><strong>from sector {formatLayout.dataStart}</strong></div>
              </div>
              {formatStatus === 'error' && <div className="warning-copy">{formatMessage}</div>}
              {(formatStatus === 'running' || formatStatus === 'done') && <p className="format-status">{formatMessage}</p>}
              <div className="modal-actions">
                <button className="action-button" onClick={closeFormatDialog} disabled={formatStatus === 'running'} data-testid="button-cancel-format">Cancel</button>
                <button className="action-button danger" onClick={() => void runFormat()} disabled={formatStatus === 'running' || formatStatus === 'done'} data-testid="button-confirm-format">
                  <span>{formatStatus === 'running' ? 'Formatting…' : 'Format'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialog === 'delete' && selectedFile && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"><div className="modal-head"><div><h2 id="delete-dialog-title">Delete file?</h2><p>This action removes the entry from the local drive image.</p></div><button className="modal-close" onClick={() => setDialog(null)} data-testid="button-close-delete-dialog"><X size={17} /></button></div><div className="modal-body"><div className="warning-copy"><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{selectedFile.name} is marked {selectedFile.attributes}. The physical write-protect switch is enabled, so this sample operation only changes the local view.</div><div className="modal-actions"><button className="action-button" onClick={() => setDialog(null)} data-testid="button-cancel-delete">Keep file</button><button className="action-button danger" onClick={removeFile} data-testid="button-confirm-delete"><Trash2 size={14} />Delete file</button></div></div></div></div>}
    </div>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
