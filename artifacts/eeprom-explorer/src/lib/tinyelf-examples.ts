// Fetches the example-program library from the TinyELF Basic project repo:
// https://github.com/Al-Nafuur/TinyELF-Basic/tree/main/examples
//
// Layout (as of 2026-10): examples/<NNcategory>/<Name>.lst — numbered
// category folders (e.g. "14games", "20demos"), one .lst text listing per
// program (TinyELF's ENTER-able format, not the tokenized .bas image — see
// TinyELF-FS-SPEC.md). Folder numbering/contents are expected to grow over
// time; this reads whatever's actually there via the GitHub API rather than
// hardcoding a list.

const EXAMPLES_OWNER = 'Al-Nafuur';
const EXAMPLES_REPO = 'TinyELF-Basic';
const EXAMPLES_BRANCH = 'main';
const EXAMPLES_DIR = 'examples';

export const EXAMPLES_REPO_URL = `https://github.com/${EXAMPLES_OWNER}/${EXAMPLES_REPO}/tree/${EXAMPLES_BRANCH}/${EXAMPLES_DIR}`;

const TREE_API_URL = `https://api.github.com/repos/${EXAMPLES_OWNER}/${EXAMPLES_REPO}/git/trees/${EXAMPLES_BRANCH}?recursive=1`;
const RAW_BASE_URL = `https://raw.githubusercontent.com/${EXAMPLES_OWNER}/${EXAMPLES_REPO}/${EXAMPLES_BRANCH}/`;

export type ExampleFile = { path: string; name: string; size: number };
export type ExampleFolder = { name: string; files: ExampleFile[] };

type RawTreeEntry = { path: string; type: 'blob' | 'tree'; size?: number };
type RawTreeResponse = { tree: RawTreeEntry[]; truncated: boolean };

export async function fetchExampleLibrary(): Promise<ExampleFolder[]> {
  const response = await fetch(TREE_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch the example library: HTTP ${response.status}`);
  }
  const doc = (await response.json()) as RawTreeResponse;

  const folders = new Map<string, ExampleFile[]>();
  const prefix = `${EXAMPLES_DIR}/`;
  for (const entry of doc.tree) {
    if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length); // "14games/TinyAdv1.lst"
    const slash = rest.indexOf('/');
    if (slash === -1) continue; // a file directly under examples/, not in a category folder
    const folderName = rest.slice(0, slash);
    const fileName = rest.slice(slash + 1);
    const list = folders.get(folderName) ?? [];
    list.push({ path: entry.path, name: fileName, size: entry.size ?? 0 });
    folders.set(folderName, list);
  }

  return Array.from(folders.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => ({ name, files: files.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export async function fetchExampleFile(path: string): Promise<Uint8Array> {
  const response = await fetch(`${RAW_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
