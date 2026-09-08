import { type ReactNode, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  Activity,
  Archive,
  ChevronRight,
  CircuitBoard,
  Download,
  FileCode2,
  FileCog,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Hexagon,
  List,
  LockKeyhole,
  MoreHorizontal,
  Network,
  Plus,
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

type FolderRecord = { id: string; name: string; parentId: string | null; modified: string };
type EEPROMFile = {
  id: string;
  name: string;
  extension: string;
  size: number;
  modified: string;
  location: string;
  attributes: string;
  bytes: number[];
  folderId: string;
};
type ActivityRecord = { id: number; time: string; message: string; detail?: string };

const queryClient = new QueryClient();

const initialFolders: FolderRecord[] = [
  { id: 'root', name: 'EEPROM_VOL', parentId: null, modified: '08 May 1997' },
  { id: 'configs', name: 'CONFIG', parentId: 'root', modified: '08 May 1997' },
  { id: 'logs', name: 'LOGS', parentId: 'root', modified: '06 May 1997' },
  { id: 'drivers', name: 'DRIVERS', parentId: 'root', modified: '21 Apr 1997' },
];

const initialFiles: EEPROMFile[] = [
  {
    id: 'system-ini',
    name: 'SYSTEM.INI',
    extension: 'INI',
    size: 184,
    modified: '08 May 1997 14:32',
    location: 'EEPROM_VOL / CONFIG',
    attributes: 'R/O',
    folderId: 'configs',
    bytes: Array.from(new TextEncoder().encode('[device]\nname=field-unit-03\nbus=0x50\nspeed=100kHz\n[display]\ncontrast=67\n')),
  },
  {
    id: 'calibration-dat',
    name: 'CALIBRAT.DAT',
    extension: 'DAT',
    size: 768,
    modified: '07 May 1997 09:18',
    location: 'EEPROM_VOL / CONFIG',
    attributes: 'R/W',
    folderId: 'configs',
    bytes: Array.from({ length: 768 }, (_, index) => (index * 17 + 38) % 256),
  },
  {
    id: 'readme-txt',
    name: 'README.TXT',
    extension: 'TXT',
    size: 421,
    modified: '21 Apr 1997 11:05',
    location: 'EEPROM_VOL',
    attributes: 'R/O',
    folderId: 'root',
    bytes: Array.from(new TextEncoder().encode('EEPROM EXPLORER NOTES\n\nKeep write-protect enabled during transport.\nI2C device is addressed at 0x50.\n')),
  },
  {
    id: 'boot-map',
    name: 'BOOT.MAP',
    extension: 'MAP',
    size: 96,
    modified: '19 Apr 1997 16:47',
    location: 'EEPROM_VOL',
    attributes: 'R/O',
    folderId: 'root',
    bytes: [0x45, 0x45, 0x50, 0x52, 0x4f, 0x4d, 0x2d, 0x33, 0x2e, 0x31, 0x00, 0x50, 0x00, 0x20, 0x00, 0x10],
  },
  {
    id: 'session-log',
    name: 'SESSION.LOG',
    extension: 'LOG',
    size: 1296,
    modified: '06 May 1997 18:02',
    location: 'EEPROM_VOL / LOGS',
    attributes: 'R/W',
    folderId: 'logs',
    bytes: Array.from(new TextEncoder().encode('06-05-97 18:02  init ok\n06-05-97 18:02  sensor online\n06-05-97 18:03  sample 001\n')),
  },
  {
    id: 'i2c-driver',
    name: 'I2C_24C.DRV',
    extension: 'DRV',
    size: 1536,
    modified: '21 Apr 1997 10:41',
    location: 'EEPROM_VOL / DRIVERS',
    attributes: 'R/O',
    folderId: 'drivers',
    bytes: Array.from({ length: 1536 }, (_, index) => (index * 11 + 7) % 256),
  },
];

const initialActivity: ActivityRecord[] = [
  { id: 1, time: '14:36:09', message: 'Drive mounted', detail: 'EEPROM_VOL at 0x50' },
  { id: 2, time: '14:35:47', message: 'Integrity check complete', detail: 'No errors found' },
  { id: 3, time: '14:35:42', message: 'Bus scan', detail: '1 device responded' },
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
  if (extension === 'INI' || extension === 'DAT') return FileCog;
  if (extension === 'DRV' || extension === 'MAP') return FileCode2;
  return FileText;
}

function Home() {
  const [folders, setFolders] = useState(initialFolders);
  const [files, setFiles] = useState(initialFiles);
  const [currentFolderId, setCurrentFolderId] = useState('root');
  const [selectedId, setSelectedId] = useState<string | null>('readme-txt');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'icons'>('list');
  const [previewMode, setPreviewMode] = useState<'preview' | 'hex'>('preview');
  const [activity, setActivity] = useState(initialActivity);
  const [dialog, setDialog] = useState<'folder' | 'delete' | null>(null);
  const [folderName, setFolderName] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFolder = folders.find((folder) => folder.id === currentFolderId) ?? folders[0];
  const selectedFile = files.find((file) => file.id === selectedId) ?? null;
  const children = useMemo(() => folders.filter((folder) => folder.parentId === currentFolderId), [currentFolderId, folders]);
  const visibleFiles = useMemo(
    () => files.filter((file) => file.folderId === currentFolderId && `${file.name} ${file.extension}`.toLowerCase().includes(query.toLowerCase())),
    [currentFolderId, files, query],
  );
  const usedBytes = files.reduce((total, file) => total + file.size, 0);
  const breadcrumbs = useMemo(() => {
    const trail: FolderRecord[] = [];
    let folder: FolderRecord | undefined = currentFolder;
    while (folder) {
      trail.unshift(folder);
      folder = folders.find((candidate) => candidate.id === folder?.parentId);
    }
    return trail;
  }, [currentFolder, folders]);

  const pushActivity = (message: string, detail?: string) => {
    setActivity((items) => [{ id: Date.now(), time: nowTime(), message, detail }, ...items].slice(0, 7));
  };

  const navigateFolder = (folderId: string) => {
    setCurrentFolderId(folderId);
    setSelectedId(null);
    setQuery('');
    pushActivity('Opened folder', folders.find((folder) => folder.id === folderId)?.name);
  };

  const createFolder = () => {
    const name = folderName.trim().toUpperCase().replace(/\s+/g, '_');
    if (!name) return;
    const folder: FolderRecord = { id: `folder-${Date.now()}`, name, parentId: currentFolderId, modified: '08 May 1997' };
    setFolders((items) => [...items, folder]);
    setFolderName('');
    setDialog(null);
    pushActivity('Folder created', name);
  };

  const importFile = async (pickedFile: File) => {
    const bytes = Array.from(new Uint8Array(await pickedFile.arrayBuffer()));
    const rawName = pickedFile.name.toUpperCase();
    const extension = rawName.includes('.') ? rawName.split('.').pop() ?? 'BIN' : 'BIN';
    const file: EEPROMFile = {
      id: `file-${Date.now()}`,
      name: rawName,
      extension,
      size: bytes.length,
      modified: '08 May 1997 14:38',
      location: currentFolder.name === 'EEPROM_VOL' ? 'EEPROM_VOL' : `EEPROM_VOL / ${currentFolder.name}`,
      attributes: 'R/W',
      folderId: currentFolderId,
      bytes,
    };
    setFiles((items) => [...items, file]);
    setSelectedId(file.id);
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
    pushActivity('File deleted', selectedFile.name);
    setFiles((items) => items.filter((file) => file.id !== selectedFile.id));
    setSelectedId(null);
    setDialog(null);
  };

  const refreshDrive = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    pushActivity('Refreshing drive', 'Reading directory table');
    window.setTimeout(() => {
      setIsRefreshing(false);
      pushActivity('Drive refreshed', `${files.length} files indexed`);
    }, 600);
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
             <p className="brand-sub">atari style utility · rev 2.4</p>
          </div>
        </div>
         <p className="side-label">Manual index</p>
        <nav className="nav-list" aria-label="Utility sections">
           <button className="nav-item active" data-testid="nav-drive"><HardDrive size={16} /><span>Directory</span></button>
           <button className="nav-item" data-testid="nav-activity" onClick={() => document.getElementById('activity-log')?.scrollIntoView({ behavior: 'smooth' })}><Activity size={16} /><span>Activity log</span></button>
           <button className="nav-item" data-testid="nav-hardware" onClick={() => document.getElementById('hardware-status')?.scrollIntoView({ behavior: 'smooth' })}><Network size={16} /><span>Bus diagnostics</span></button>
        </nav>
        <div className="side-drive" data-testid="card-drive-summary">
          <div className="drive-mini-head"><strong>EEPROM_VOL</strong><button className="eject-btn" title="Refresh drive" onClick={refreshDrive} data-testid="button-refresh-sidebar"><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /></button></div>
          <div className="meter-label"><span>used space</span><b>{formatSize(usedBytes)} / 32 KB</b></div>
          <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, (usedBytes / 32768) * 100)}%` }} /></div>
          <div className="mini-meta">I²C · 0x50 · 24LC256</div>
        </div>
         <div className="side-footer"><span><i className="online-dot" />ready</span><span>local mode</span></div>
      </aside>

      <main className="console-main">
        <header className="topbar">
          <div>
             <div className="topbar-kicker">chapter 03 / directory control</div>
             <h1 className="topbar-title">Disk directory</h1>
          </div>
          <div className="topbar-actions">
             <div className="hardware-chip"><i className="online-dot" /> bus online · 0x50</div>
            <button className="action-button" onClick={refreshDrive} data-testid="button-refresh-drive" title="Read the directory again"><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /><span>Refresh</span></button>
          </div>
        </header>

        <section className="toolbar" aria-label="File actions">
           <button className="action-button primary" onClick={() => setDialog('folder')} data-testid="button-new-folder"><FolderPlus size={14} /><span>Make directory</span></button>
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

        <div className="breadcrumbs" aria-label="Folder path">
          {breadcrumbs.map((folder, index) => (
            <span key={folder.id} style={{ display: 'contents' }}>
              {index > 0 && <ChevronRight size={12} className="crumb-sep" />}
              <button className={`crumb ${index === breadcrumbs.length - 1 ? 'current' : ''}`} onClick={() => navigateFolder(folder.id)} data-testid={`button-breadcrumb-${folder.id}`}>{folder.name}</button>
            </span>
          ))}
        </div>

        <div className="workspace">
          <section className="file-panel" aria-label="Drive contents">
            <div className="panel-head">
              <div className="panel-title">
                <Folder size={18} className="folder-icon" />
                <div><h2>{currentFolder.name}</h2><p>{children.length} folder{children.length === 1 ? '' : 's'} · {visibleFiles.length} file{visibleFiles.length === 1 ? '' : 's'}</p></div>
              </div>
              <span className="folder-count">{children.length + visibleFiles.length}</span>
            </div>
            {view === 'list' ? (
              <table className="file-table">
                <thead><tr><th style={{ width: '42%' }}>Name</th><th style={{ width: '16%' }}>Size</th><th style={{ width: '22%' }}>Modified</th><th style={{ width: '12%' }}>Attr</th><th>Location</th></tr></thead>
                <tbody>
                  {children.map((folder) => (
                    <tr className="folder-row" key={folder.id} onClick={() => navigateFolder(folder.id)} data-testid={`row-folder-${folder.id}`}>
                      <td><div className="name-cell"><Folder size={16} className="folder-icon" /><span className="file-name">{folder.name}</span></div></td><td>—</td><td>{folder.modified}</td><td><span className="tag">DIR</span></td><td>EEPROM_VOL</td>
                    </tr>
                  ))}
                  {visibleFiles.map((file) => { const Icon = fileIcon(file.extension); return (
                    <tr className={`file-row ${selectedId === file.id ? 'selected' : ''}`} key={file.id} onClick={() => setSelectedId(file.id)} data-testid={`row-file-${file.id}`}>
                      <td><div className="name-cell"><Icon size={16} className="file-icon" /><span className="file-name">{file.name}</span></div></td><td>{formatSize(file.size)}</td><td>{file.modified}</td><td><span className="tag">{file.attributes}</span></td><td>{file.location}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            ) : (
              <div className="folder-grid">
                {children.map((folder) => <button className="folder-card" key={folder.id} onClick={() => navigateFolder(folder.id)} data-testid={`card-folder-${folder.id}`}><Folder size={19} className="folder-icon" /><div className="card-copy"><strong>{folder.name}</strong><small>folder · {folder.modified}</small></div></button>)}
                {visibleFiles.map((file) => { const Icon = fileIcon(file.extension); return <button className={`file-card ${selectedId === file.id ? 'selected' : ''}`} key={file.id} onClick={() => setSelectedId(file.id)} data-testid={`card-file-${file.id}`}><div className="file-card-top"><Icon size={20} className="file-icon" /><span className="tag">{file.extension}</span></div><div className="file-card-title"><strong>{file.name}</strong></div><div className="file-card-meta"><span>{formatSize(file.size)}</span><span>{file.attributes}</span></div></button>; })}
              </div>
            )}
            {!children.length && !visibleFiles.length && <div className="empty-state"><div className="empty-icon">{query ? <Search size={21} /> : <Archive size={21} />}</div><h3>{query ? 'No matching files' : 'This folder is empty'}</h3><p>{query ? 'Try a different name or clear the filter.' : 'Import a file here, or create a folder to begin organizing this drive.'}</p></div>}
          </section>

          <aside className="right-rail">
            <section className="hardware-panel" id="hardware-status" data-testid="panel-hardware-status">
               <div className="hardware-heading"><div><h2>Bus diagnostics</h2><p>live I²C telemetry</p></div><span className="connected-badge"><i /> online</span></div>
              <div className="hardware-list">
                <div className="hardware-stat"><span>Bus address</span><strong>0x50</strong></div>
                <div className="hardware-stat"><span>Device type</span><strong>24LC256</strong></div>
                <div className="hardware-stat"><span>Capacity</span><strong>32 KB (256 Kbit)</strong></div>
                <div className="hardware-stat"><span>Write protect</span><strong className="good">enabled</strong></div>
                <div className="capacity-block"><div className="capacity-line"><span>used / free</span><strong>{formatSize(usedBytes)} / {formatSize(32768 - usedBytes)}</strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, (usedBytes / 32768) * 100)}%` }} /></div><div className="capacity-line"><span>directory entries</span><strong>{files.length} files · {folders.length - 1} folders</strong></div></div>
                <div className="protect-line"><ShieldCheck size={14} /> writes require physical WP switch off</div>
              </div>
            </section>

            <section className="preview-panel" data-testid="panel-file-inspector">
              <div className="preview-head"><h2>File inspector</h2><div className="preview-tabs"><button className={previewMode === 'preview' ? 'active' : ''} onClick={() => setPreviewMode('preview')} data-testid="button-preview-mode">Preview</button><button className={previewMode === 'hex' ? 'active' : ''} onClick={() => setPreviewMode('hex')} data-testid="button-hex-mode">Hex</button></div></div>
              <div className="preview-body">
                {!selectedFile ? <div className="preview-empty"><div><Hexagon size={25} /><br />Select a file to inspect its contents.</div></div> : previewMode === 'preview' ? <div className="preview-content"><div className="preview-file-title"><FileText size={15} />{selectedFile.name}<small>{formatSize(selectedFile.size)}</small></div>{selectedPreview || 'Binary data — switch to Hex for a byte-level view.'}</div> : <div className="hex-view"><div className="preview-file-title"><Hexagon size={15} />{selectedFile.name}<small>{selectedFile.bytes.length} bytes</small></div>{hexRows.map((row, index) => <div className="hex-row" key={index}><span className="hex-address">{hex(index * 16, 4)}</span><span className="hex-bytes">{row.map((byte) => hex(byte)).join(' ')}</span><span className="hex-ascii">{row.map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '·').join('')}</span></div>)}</div>}
              </div>
            </section>

            <section className="activity-panel" id="activity-log" data-testid="panel-activity-log">
               <div className="activity-title"><Activity size={14} /><strong>Operations log</strong></div>
              <div className="activity-list">{activity.map((item) => <div className="activity-item" key={item.id}><span className="activity-time">{item.time}</span><span className="activity-copy"><strong>{item.message}</strong>{item.detail ? ` · ${item.detail}` : ''}</span></div>)}</div>
            </section>
          </aside>
        </div>
      </main>

      {dialog === 'folder' && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title"><div className="modal-head"><div><h2 id="folder-dialog-title">New folder</h2><p>Create a directory in {currentFolder.name}</p></div><button className="modal-close" onClick={() => setDialog(null)} data-testid="button-close-folder-dialog"><X size={17} /></button></div><form className="modal-body" onSubmit={(event) => { event.preventDefault(); createFolder(); }}><label htmlFor="folder-name">Folder name</label><input id="folder-name" className="modal-input" autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. ARCHIVE" maxLength={24} data-testid="input-folder-name" /><div className="modal-actions"><button type="button" className="action-button" onClick={() => setDialog(null)} data-testid="button-cancel-folder">Cancel</button><button type="submit" className="action-button primary" disabled={!folderName.trim()} data-testid="button-create-folder"><Plus size={14} />Create folder</button></div></form></div></div>}
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