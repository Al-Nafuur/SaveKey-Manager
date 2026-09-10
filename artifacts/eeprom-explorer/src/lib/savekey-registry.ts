// Fetches and parses the community-maintained SaveKey/AtariVox allocation
// registry: https://github.com/atariage-community/savekey-allocation-list
//
// Schema per that repo's README.md (fetched and read directly, not
// guessed): allocations.yaml has format_version/page_size/total_pages plus
// an `allocations` list of { title, developer?, platform?, kind, status,
// pages: {start,end}, addresses?, urls?, verified?, notes? }. Hex page
// numbers (e.g. 0x004) parse as plain numbers with the `yaml` package's
// default schema — verified directly against the real file.
//
// `addresses` (optional): a partial-page or discontiguous allocation can
// specify byte ranges instead of/in addition to whole pages, and multiple
// entries can share one page this way — so page ownership is genuinely
// many-to-one, not one-to-one.

import { parse } from 'yaml';

export type SaveKeyAddressRange = { start: number; end: number };
export type SaveKeyAllocationKind = 'system' | 'game' | 'scratchpad' | 'utility';
export type SaveKeyAllocationStatus = 'allocated' | 'reserved' | 'abandoned';

export type SaveKeyAllocationEntry = {
  id: string;
  title: string;
  developer?: string;
  platform?: string;
  kind: SaveKeyAllocationKind;
  status: SaveKeyAllocationStatus;
  pageStart: number;
  pageEnd: number;
  addresses?: SaveKeyAddressRange[];
  urls?: string[];
  verified?: string;
  notes?: string;
};

export type SaveKeyRegistry = {
  pageSize: number;
  totalPages: number;
  entries: SaveKeyAllocationEntry[];
};

const ALLOCATIONS_URL =
  'https://raw.githubusercontent.com/atariage-community/savekey-allocation-list/main/allocations.yaml';

type RawAllocation = {
  title: string;
  developer?: string;
  platform?: string;
  kind: SaveKeyAllocationKind;
  status: SaveKeyAllocationStatus;
  pages: { start: number; end: number };
  addresses?: SaveKeyAddressRange | SaveKeyAddressRange[];
  urls?: string[];
  verified?: string;
  notes?: string;
};

type RawRegistry = {
  page_size: number;
  total_pages: number;
  allocations: RawAllocation[];
};

export async function fetchSaveKeyRegistry(): Promise<SaveKeyRegistry> {
  const response = await fetch(ALLOCATIONS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch the SaveKey allocation registry: HTTP ${response.status}`);
  }
  const text = await response.text();
  const doc = parse(text) as RawRegistry;

  const entries: SaveKeyAllocationEntry[] = doc.allocations.map((raw, index) => ({
    id: `${index}-${raw.title}`,
    title: raw.title,
    developer: raw.developer,
    platform: raw.platform,
    kind: raw.kind,
    status: raw.status,
    pageStart: raw.pages.start,
    pageEnd: raw.pages.end,
    addresses: raw.addresses ? (Array.isArray(raw.addresses) ? raw.addresses : [raw.addresses]) : undefined,
    urls: raw.urls,
    verified: raw.verified,
    notes: raw.notes,
  }));

  return { pageSize: doc.page_size, totalPages: doc.total_pages, entries };
}

// A page can have more than one owner (see `addresses` above, for shared
// pages) — so this is page -> *list* of entries, not page -> one entry.
export function buildPageOwners(entries: SaveKeyAllocationEntry[], totalPages: number): SaveKeyAllocationEntry[][] {
  const owners: SaveKeyAllocationEntry[][] = Array.from({ length: totalPages }, () => []);
  for (const entry of entries) {
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      if (page >= 0 && page < owners.length) owners[page].push(entry);
    }
  }
  return owners;
}
