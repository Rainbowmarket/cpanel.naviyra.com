import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { usePanelSearchParams } from '@/file-manager/use-panel-search-params';
import AceEditor from 'react-ace';
import 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/mode-php';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/mode-html';
import 'ace-builds/src-noconflict/mode-css';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/mode-typescript';
import 'ace-builds/src-noconflict/mode-text';
import 'ace-builds/src-noconflict/theme-monokai';
import {
  apiList,
  type ListItem,
  apiRead,
  apiSession,
  createItem,
  deleteItem,
  downloadFileUrl,
  fileActions,
  isSessionExpiredPayload,
  openFolderDownloadPage,
  saveFile,
  SessionExpiredError,
} from '@/file-manager/client';
import {
  IcArchiveArrowDown,
  IcArrowsRightLeft,
  IcCircleX,
  IcDuplicate,
  IcFilePlus,
  IcFolderPlus,
  IcGridSelect,
  IcOpenExternal,
  IcPencil,
  IcTrash,
  IcDownload,
} from '@/file-manager/components/toolbarIcons';
import { UploadPanel } from '@/file-manager/components/UploadPanel';

function extMode(ext: string): string {
  const m: Record<string, string> = {
    php: 'php',
    html: 'html',
    htm: 'html',
    css: 'css',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    py: 'python',
  };
  return m[ext.toLowerCase()] || 'text';
}

function joinPath(dir: string, name: string): string {
  const d = dir.replace(/[/\\]+$/, '');
  if (dir.includes('\\') && !dir.includes('/')) {
    return `${d}\\${name}`;
  }
  return `${d}/${name}`;
}

function dirnameFs(p: string): string {
  const s = p.replace(/[/\\]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (i <= 0) return s.startsWith('/') ? '/' : s.slice(0, 2);
  return s.slice(0, i);
}

/** mtime from API is Unix seconds. */
function formatListDate(ts?: number): string {
  if (ts == null || ts <= 0) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/** Compare paths for “same folder” after normalizing slashes (Windows/Linux). */
function pathsEqual(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  return n(a).toLowerCase() === n(b).toLowerCase();
}

function normFsPath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return s === '' ? '/' : s;
}

function isPathAllowed(path: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  const target = normFsPath(path);
  return allowedPaths.some((root) => {
    const r = normFsPath(root);
    return target === r || target.startsWith(`${r}/`);
  });
}

function allowedRootFor(path: string, allowedPaths: string[]): string | null {
  if (allowedPaths.length === 0) return null;
  const target = normFsPath(path);
  let best: string | null = null;
  let bestLen = -1;
  for (const root of allowedPaths) {
    const r = normFsPath(root);
    if (target === r || target.startsWith(`${r}/`)) {
      if (r.length > bestLen) {
        best = r;
        bestLen = r.length;
      }
    }
  }
  return best;
}

function pathBasename(p: string): string {
  const parts = normFsPath(p).split('/').filter(Boolean);
  return parts[parts.length - 1] || normFsPath(p);
}

/** Parent directory to list for autocomplete, and basename prefix to filter folder names. */
function parseDestinationPathInput(typed: string, cwdFallback: string): { listDir: string; partial: string } {
  const t = typed.trim();
  if (t === '') {
    return { listDir: cwdFallback, partial: '' };
  }
  if (/[/\\]$/.test(t)) {
    return { listDir: t.replace(/[/\\]+$/, ''), partial: '' };
  }
  const last = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  if (last < 0) {
    return { listDir: cwdFallback, partial: t };
  }
  const dir = t.slice(0, last);
  const partial = t.slice(last + 1);
  if (dir === '' && t.startsWith('/')) {
    return { listDir: '/', partial };
  }
  return { listDir: dir, partial };
}

type DialogKind = 'rename' | 'move' | 'copy' | 'delete' | 'folder' | 'file' | null;

type ToastKind = 'success' | 'error' | 'warning' | 'info';

type WorkspacePageProps = {
  domainOptions?: Array<{ value: string; label: string }>;
  domainId?: string;
  onDomainChange?: (domainId: string) => void;
};

export function WorkspacePage({
  domainOptions,
  domainId,
  onDomainChange,
}: WorkspacePageProps = {}) {
  const { searchParams, setSearchParams } = usePanelSearchParams();
  const dirPath = searchParams.get('p') || '';
  const fileName = searchParams.get('file') || '';
  const [loading, setLoading] = useState(true);
  const [perms, setPerms] = useState<string[]>([]);
  const [home, setHome] = useState('/');
  const [allowedPaths, setAllowedPaths] = useState<string[]>([]);
  const [listPath, setListPath] = useState('');
  const [items, setItems] = useState<ListItem[]>([]);
  const [filter, setFilter] = useState('');
  const [content, setContent] = useState('');
  const [fullPath, setFullPath] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [listVersion, setListVersion] = useState(0);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [dialogInput, setDialogInput] = useState('');
  const [destSuggestions, setDestSuggestions] = useState<string[]>([]);
  const [destSuggestLoading, setDestSuggestLoading] = useState(false);
  const [destSuggestActive, setDestSuggestActive] = useState(-1);
  const destSuggestSeqRef = useRef(0);
  /** Multi-select: plain click = one item; Ctrl/Cmd+click = toggle; Shift+click = range from last anchor. */
  const [selectedEntries, setSelectedEntries] = useState<ListItem[]>([]);
  const rangeAnchorRef = useRef<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; kind: 'row' | 'list' } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  const SIDEBAR_WIDTH_KEY = 'webeditor_sidebar_width';
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 180 && n <= 900) return n;
    } catch {
      /* ignore */
    }
    return 280;
  });
  const canEdit = perms.includes('admin') || perms.includes('edit');
  const canDownload = perms.includes('admin') || perms.includes('download');
  const canUpload = perms.includes('admin') || perms.includes('upload');
  const canDelete = perms.includes('admin') || perms.includes('delete');

  const effectiveDir = useMemo(() => {
    return (listPath || dirPath || home).replace(/[/\\]+$/, '');
  }, [listPath, dirPath, home]);

  /** Single path for rename, or when one sidebar item + no multi. */
  const pathForAction = useMemo(() => {
    if (selectedEntries.length === 1) {
      return joinPath(effectiveDir, selectedEntries[0]!.name);
    }
    if (selectedEntries.length === 0) {
      if (fileName) {
        return joinPath(listPath || dirPath || home, fileName);
      }
      return effectiveDir;
    }
    return '';
  }, [selectedEntries, effectiveDir, fileName, listPath, dirPath, home]);

  const selectedPaths = useMemo(() => {
    return selectedEntries.map((e) => joinPath(effectiveDir, e.name));
  }, [selectedEntries, effectiveDir]);

  const isActionOnFile = useMemo(() => {
    if (selectedEntries.length === 1) {
      return selectedEntries[0]!.type === 'file';
    }
    if (selectedEntries.length === 0) {
      return !!fileName;
    }
    return false;
  }, [selectedEntries, fileName]);

  /** Paths targeted by Move/Copy/Delete (sidebar multi-select, or single path from selection / open file / current folder). */
  const sourcesForDialog = useMemo(() => {
    if (selectedPaths.length > 0) return selectedPaths;
    if (pathForAction) return [pathForAction];
    return [];
  }, [selectedPaths, pathForAction]);

  const showToast = useCallback((msg: string, kind: ToastKind = 'success') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const bumpList = useCallback(() => setListVersion((v) => v + 1), []);

  const redirectToLogin = useCallback(() => {
    window.location.href = '/login';
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await apiSession();
      if (cancelled) return;
      if (!s.success || !s.user) {
        redirectToLogin();
        return;
      }
      setPerms(s.permissions || []);
      const h = s.breadcrumbHome || '/';
      setHome(h);
      setAllowedPaths((s.allowedPaths || []).map(normFsPath));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [redirectToLogin]);

  /** Re-check session periodically (PHP session timeout) and when the tab becomes visible again. */
  useEffect(() => {
    if (loading) return;
    const verifySession = async () => {
      try {
        const s = await apiSession();
        if (!s.success || !s.user) redirectToLogin();
      } catch {
        redirectToLogin();
      }
    };
    const interval = window.setInterval(verifySession, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void verifySession();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loading, redirectToLogin]);

  useEffect(() => {
    if (loading || allowedPaths.length === 0) return;
    const current = dirPath || home;
    if (current && !isPathAllowed(current, allowedPaths)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('p', home);
        next.delete('file');
        return next;
      });
    }
  }, [loading, dirPath, home, allowedPaths, setSearchParams]);

  useEffect(() => {
    setSelectedEntries([]);
    rangeAnchorRef.current = null;
    setCtxMenu(null);
  }, [dirPath]);

  useEffect(() => {
    if (fileName) {
      setSelectedEntries([{ name: fileName, type: 'file' }]);
    }
  }, [fileName]);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      const pathArg = dirPath === '' ? '' : dirPath;
      const res = await apiList(pathArg);
      if (cancelled) return;
      if (isSessionExpiredPayload(res)) {
        redirectToLogin();
        return;
      }
      if (res.success && res.path) {
        setListPath(res.path);
        setItems(res.items || []);
      } else {
        const denied =
          allowedPaths.length > 0 &&
          (res.message === 'Path access denied.' || res.message === 'Invalid path');
        if (denied) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('p', home);
            next.delete('file');
            return next;
          });
          showToast('That folder is outside your allowed directories.', 'warning');
        } else if (allowedPaths.length > 0 && res.message === 'Invalid path') {
          showToast(`Folder not found or not accessible: ${dirPath || home}`, 'error');
        } else {
          showToast(res.message || 'Could not list folder', 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, dirPath, listVersion, showToast, redirectToLogin, allowedPaths, home, setSearchParams]);

  useEffect(() => {
    if (!fileName || !dirPath) {
      setContent('');
      setFullPath(null);
      setTooLarge(null);
      setDirty(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await apiRead(dirPath, fileName);
      if (cancelled) return;
      if (isSessionExpiredPayload(res)) {
        redirectToLogin();
        return;
      }
      if (!res.success) {
        if (res.message === 'file_too_large') {
          setTooLarge(res.sizeFormatted || 'large file');
          setContent('');
          setFullPath(null);
        } else {
          showToast(res.message || 'Could not open file', 'error');
        }
        return;
      }
      if (res.content !== undefined) {
        const fp = res.fullPath || (res.path && res.file ? `${res.path.replace(/\\/g, '/')}/${res.file}` : null);
        if (!fp) {
          showToast('Could not resolve file path', 'error');
          return;
        }
        setContent(res.content);
        setFullPath(fp);
        setTooLarge(null);
        setDirty(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dirPath, fileName, showToast, redirectToLogin]);

  useEffect(() => {
    if (dialog !== 'move' && dialog !== 'copy') {
      setDestSuggestions([]);
      setDestSuggestLoading(false);
      setDestSuggestActive(-1);
    }
  }, [dialog]);

  useEffect(() => {
    if (dialog !== 'move' && dialog !== 'copy') return;
    const seq = ++destSuggestSeqRef.current;
    const { listDir, partial } = parseDestinationPathInput(dialogInput, effectiveDir);
    setDestSuggestLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await apiList(listDir);
          if (seq !== destSuggestSeqRef.current) return;
          if (isSessionExpiredPayload(res)) {
            redirectToLogin();
            return;
          }
          if (!res.success || !res.items?.length || !res.path) {
            setDestSuggestions([]);
            return;
          }
          const base = res.path.replace(/[/\\]+$/, '');
          const dirs = res.items
            .filter(
              (it) =>
                it.type === 'dir' &&
                (partial === '' || it.name.toLowerCase().startsWith(partial.toLowerCase())),
            )
            .map((it) => joinPath(base, it.name))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .slice(0, 50);
          setDestSuggestions(dirs);
          setDestSuggestActive(-1);
        } catch {
          if (seq !== destSuggestSeqRef.current) return;
          setDestSuggestions([]);
        } finally {
          if (seq === destSuggestSeqRef.current) setDestSuggestLoading(false);
        }
      })();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [dialog, dialogInput, effectiveDir, redirectToLogin]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, filter]);

  function openFolder(full: string) {
    if (allowedPaths.length > 0 && !isPathAllowed(full, allowedPaths)) {
      showToast('That folder is outside your allowed directories.', 'warning');
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('p', full);
      next.delete('file');
      return next;
    });
  }

  function openFile(dir: string, name: string) {
    setSearchParams({ p: dir, file: name });
  }

  function goHome() {
    setSearchParams({ p: home });
  }

  const onSave = useCallback(async () => {
    if (!fullPath || !canEdit) return;
    try {
      await saveFile(fullPath, content);
      setDirty(false);
      showToast('Saved');
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        redirectToLogin();
        return;
      }
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  }, [fullPath, canEdit, content, showToast, redirectToLogin]);

  useEffect(() => {
    if (!fileName || !canEdit || tooLarge) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (!dirty || !fullPath) return;
      void onSave();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileName, canEdit, tooLarge, dirty, fullPath, onSave]);

  function startSidebarResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: globalThis.MouseEvent) => {
      const minW = 180;
      const maxW = Math.min(900, Math.max(minW + 120, window.innerWidth - 200));
      setSidebarWidth(Math.min(maxW, Math.max(minW, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth((w) => {
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function openDialog(kind: DialogKind, initial = '') {
    setDialog(kind);
    setDialogInput(initial);
  }

  function sameEntry(a: { name: string; type: 'dir' | 'file' }, b: { name: string; type: 'dir' | 'file' }) {
    return a.name === b.name && a.type === b.type;
  }

  function openSelectedOrNavigate() {
    if (selectedEntries.length !== 1) {
      showToast('Select a single file or folder to open (double-click also works).', 'warning');
      return;
    }
    const one = selectedEntries[0]!;
    const base = effectiveDir;
    if (one.type === 'dir') {
      openFolder(joinPath(base, one.name));
    } else {
      openFile(base, one.name);
    }
  }

  function selectAllInView() {
    setSelectedEntries(filtered.map((it) => ({ name: it.name, type: it.type })));
  }

  function handleRowPointerDown(
    it: { name: string; type: 'dir' | 'file' },
    index: number,
    e: MouseEvent,
  ) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedEntries((prev) => {
        if (prev.some((s) => sameEntry(s, it))) {
          return prev.filter((s) => !sameEntry(s, it));
        }
        return [...prev, it];
      });
      rangeAnchorRef.current = index;
      return;
    }
    if (e.shiftKey && rangeAnchorRef.current !== null) {
      e.preventDefault();
      const a = Math.min(rangeAnchorRef.current, index);
      const b = Math.max(rangeAnchorRef.current, index);
      const slice = filtered.slice(a, b + 1).map((x) => ({ name: x.name, type: x.type }));
      setSelectedEntries(slice);
      return;
    }
    setSelectedEntries([it]);
    rangeAnchorRef.current = index;
  }

  function placeContextMenu(e: MouseEvent, kind: 'row' | 'list') {
    const menuW = 220;
    const menuH = kind === 'list' ? (canUpload ? 200 : 120) : 300;
    const pad = 8;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuW > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - menuW - pad);
    if (y + menuH > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - menuH - pad);
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    setCtxMenu({ x, y, kind });
  }

  function handleFileListBackgroundContextMenu(e: MouseEvent) {
    e.preventDefault();
    placeContextMenu(e, 'list');
  }

  function handleRowContextMenu(
    it: { name: string; type: 'dir' | 'file' },
    index: number,
    e: MouseEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedEntries.some((s) => sameEntry(s, it))) {
      setSelectedEntries([it]);
      rangeAnchorRef.current = index;
    }
    placeContextMenu(e, 'row');
  }

  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') setCtxMenu(null);
    };
    const onDown = (ev: globalThis.MouseEvent) => {
      if (ctxMenuRef.current?.contains(ev.target as Node)) return;
      setCtxMenu(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [ctxMenu]);

  async function submitDialog() {
    const v = dialogInput.trim();
    try {
      if (dialog === 'rename') {
        if (!pathForAction) {
          showToast('Rename works on exactly one selected item.', 'warning');
          return;
        }
        if (!v) {
          showToast('Enter a name', 'warning');
          return;
        }
        const res = await fileActions('rename', { source: pathForAction, name: v });
        if (res.success) {
          showToast(res.message || 'Renamed');
          setDialog(null);
          setSelectedEntries([]);
          if (isActionOnFile) {
            setSearchParams({ p: listPath || dirPath || '', file: v });
          } else {
            const newDirPath = joinPath(dirnameFs(pathForAction), v);
            const renamedOldPath = pathForAction.replace(/[/\\]+$/, '');
            // Only change ?p= when we renamed the folder we are currently inside (URL must match disk).
            // If we renamed a subfolder from the parent listing, stay in the parent — do not navigate into the renamed folder.
            if (pathsEqual(effectiveDir, renamedOldPath)) {
              openFolder(newDirPath);
            }
          }
          bumpList();
        } else {
          showToast(res.message || 'Rename failed', 'error');
        }
      } else if (dialog === 'move') {
        if (!v) {
          showToast('Enter destination folder path', 'warning');
          return;
        }
        const sources = selectedPaths.length > 0 ? selectedPaths : pathForAction ? [pathForAction] : [];
        if (sources.length === 0) {
          showToast('Nothing to move.', 'warning');
          return;
        }
        let lastErr: string | null = null;
        for (const src of sources) {
          const res = await fileActions('move', { source: src, dest: v });
          if (!res.success) lastErr = res.message || 'Move failed';
        }
        if (!lastErr) {
          showToast(sources.length > 1 ? `Moved ${sources.length} items` : 'Moved');
          setDialog(null);
          setSelectedEntries([]);
          setSearchParams({ p: v });
          bumpList();
        } else {
          showToast(lastErr, 'error');
        }
      } else if (dialog === 'copy') {
        if (!v) {
          showToast('Enter destination folder path', 'warning');
          return;
        }
        const sources = selectedPaths.length > 0 ? selectedPaths : pathForAction ? [pathForAction] : [];
        if (sources.length === 0) {
          showToast('Nothing to copy.', 'warning');
          return;
        }
        let lastErr: string | null = null;
        for (const src of sources) {
          const res = await fileActions('copy', { source: src, dest: v });
          if (!res.success) lastErr = res.message || 'Copy failed';
        }
        if (!lastErr) {
          showToast(sources.length > 1 ? `Copied ${sources.length} items` : 'Copied');
          setDialog(null);
          setSelectedEntries([]);
          bumpList();
        } else {
          showToast(lastErr, 'error');
        }
      } else if (dialog === 'delete') {
        const pairs: { path: string; isFile: boolean }[] =
          selectedEntries.length > 0
            ? selectedEntries.map((e, i) => ({
                path: selectedPaths[i]!,
                isFile: e.type === 'file',
              }))
            : pathForAction
              ? [{ path: pathForAction, isFile: isActionOnFile }]
              : [];
        if (pairs.length === 0) {
          showToast('Nothing to delete.', 'warning');
          return;
        }
        let fail: string | null = null;
        for (const { path: src, isFile } of pairs) {
          const resText = await deleteItem(isFile, src);
          if (!resText.toLowerCase().includes('success')) fail = resText;
        }
        if (!fail) {
          showToast(pairs.length > 1 ? `Deleted ${pairs.length} items` : 'Deleted');
          setDialog(null);
          setSelectedEntries([]);
          const openFilePath = fileName ? joinPath(listPath || dirPath || home, fileName) : '';
          if (openFilePath && pairs.some((p) => p.path === openFilePath)) {
            setSearchParams({ p: dirPath || listPath || '' });
          } else if (pairs.length === 1 && !pairs[0]!.isFile) {
            setSearchParams({ p: dirnameFs(pairs[0]!.path) });
          }
          bumpList();
        } else {
          showToast(fail, 'error');
        }
      } else if (dialog === 'folder') {
        if (!v) {
          showToast('Enter folder name', 'warning');
          return;
        }
        const msg = await createItem('createFolder', effectiveDir, v);
        const okFolder = msg.toLowerCase().includes('success') || msg.toLowerCase().includes('created');
        showToast(okFolder ? 'Folder created' : msg, okFolder ? 'success' : 'warning');
        setDialog(null);
        bumpList();
      } else if (dialog === 'file') {
        if (!v) {
          showToast('Enter file name', 'warning');
          return;
        }
        const msg = await createItem('createFile', effectiveDir, v);
        const okFile = msg.toLowerCase().includes('success') || msg.toLowerCase().includes('created');
        showToast(okFile ? 'File created' : msg, okFile ? 'success' : 'warning');
        setDialog(null);
        bumpList();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Request failed', 'error');
    }
  }

  function onDialogInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitDialog();
    }
  }

  function applyDestSuggestion(fullDirPath: string) {
    const useWin = fullDirPath.includes('\\') && !fullDirPath.includes('/');
    const sep = useWin ? '\\' : '/';
    const trimmed = fullDirPath.replace(/[/\\]+$/, '');
    setDialogInput(`${trimmed}${sep}`);
    setDestSuggestActive(-1);
  }

  function onDestinationKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (destSuggestions.length > 0) {
        e.preventDefault();
        setDestSuggestActive((i) => (i < destSuggestions.length - 1 ? i + 1 : i));
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (destSuggestions.length > 0) {
        e.preventDefault();
        setDestSuggestActive((i) => (i > 0 ? i - 1 : -1));
      }
      return;
    }
    if (e.key === 'Enter') {
      if (destSuggestActive >= 0 && destSuggestions[destSuggestActive]) {
        e.preventDefault();
        applyDestSuggestion(destSuggestions[destSuggestActive]!);
        return;
      }
      e.preventDefault();
      void submitDialog();
      return;
    }
    if (e.key === 'Escape') {
      if (destSuggestions.length > 0 || destSuggestLoading) {
        e.preventDefault();
        setDestSuggestions([]);
        setDestSuggestActive(-1);
      }
    }
  }

  const destinationPathField = (
    <>
      <p className="modal-paths-label">To:</p>
      <div className="modal-dest-wrap">
        <input
          value={dialogInput}
          onChange={(e) => setDialogInput(e.target.value)}
          onKeyDown={onDestinationKeyDown}
          placeholder="Destination folder (full path)"
          autoFocus
          autoComplete="off"
          aria-expanded={destSuggestions.length > 0 || destSuggestLoading}
        />
        {(destSuggestLoading || destSuggestions.length > 0) && (
          <ul className="modal-dest-suggest" role="listbox">
            {destSuggestLoading && destSuggestions.length === 0 ? (
              <li className="modal-dest-suggest-placeholder" role="presentation">
                Loading…
              </li>
            ) : (
              destSuggestions.map((path, i) => (
                <li
                  key={path}
                  role="option"
                  aria-selected={i === destSuggestActive}
                  className={i === destSuggestActive ? 'active' : undefined}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyDestSuggestion(path);
                  }}
                >
                  {path}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </>
  );

  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
  const aceMode = extMode(ext);

  const pathForCrumb = listPath || dirPath || home;
  const crumbs = useMemo(() => {
    const p = pathForCrumb.replace(/\\/g, '/');
    const parts = p.split('/').filter(Boolean);
    const out: { label: string; path: string }[] = [];
    if (p.startsWith('/')) {
      let acc = '';
      for (const part of parts) {
        acc += '/' + part;
        out.push({ label: part, path: acc });
      }
    } else if (p.match(/^[A-Za-z]:/)) {
      let acc = '';
      for (const part of parts) {
        acc = acc ? acc + '/' + part : part;
        out.push({ label: part, path: acc });
      }
    } else {
      let acc = '';
      for (const part of parts) {
        acc = acc ? acc + '/' + part : '/' + part;
        out.push({ label: part, path: acc });
      }
    }
    const root = allowedRootFor(pathForCrumb, allowedPaths);
    if (root) {
      const rootNorm = normFsPath(root);
      return out.filter((c) => {
        const cp = normFsPath(c.path);
        return cp === rootNorm || cp.startsWith(`${rootNorm}/`);
      });
    }
    return out;
  }, [pathForCrumb, allowedPaths]);

  const isRestricted = allowedPaths.length > 0;

  const activeAllowedRoot = useMemo(() => {
    if (!isRestricted) return '';
    return allowedRootFor(pathForCrumb, allowedPaths) || normFsPath(home);
  }, [pathForCrumb, allowedPaths, home, isRestricted]);

  const selectedAllowedRoot = useMemo(() => {
    if (!isRestricted) return '';
    const match = allowedPaths.find((p) => pathsEqual(p, activeAllowedRoot));
    return match ?? allowedPaths[0] ?? activeAllowedRoot;
  }, [activeAllowedRoot, allowedPaths, isRestricted]);

  if (loading) {
    return <div className="empty-state">Loading…</div>;
  }

  return (
    <div className="app-root">
      <header className="app-nav">
        <div className="app-nav-path">
          {domainOptions && domainOptions.length > 0 && domainId && onDomainChange ? (
            <select
              className="app-nav-domain-select"
              value={domainId}
              onChange={(e) => onDomainChange(e.target.value)}
              title="Switch domain"
              aria-label="Switch domain"
            >
              {domainOptions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : null}
          <strong>Path:</strong>
          <span className="app-nav-breadcrumb">
            <button
              type="button"
              className="app-nav-crumb"
              onClick={goHome}
              title={isRestricted ? `Home: ${home}` : 'Home'}
            >
              🏠
            </button>
            {crumbs.map((b) => (
              <span key={b.path}>
                {' '}
                /{' '}
                <button type="button" className="app-nav-crumb" onClick={() => openFolder(b.path)}>
                  {b.label}
                </button>
              </span>
            ))}
            {fileName ? (
              <>
                {' '}
                / <strong>{fileName}</strong>
              </>
            ) : null}
          </span>
          {isRestricted && allowedPaths.length > 1 ? (
            <select
              className="app-nav-scope-select"
              value={selectedAllowedRoot}
              onChange={(e) => openFolder(e.target.value)}
              title={`Switch folder (${allowedPaths.length} allowed)`}
              aria-label="Switch allowed folder"
            >
              {allowedPaths.map((p) => (
                <option key={p} value={p} title={p}>
                  {pathBasename(p)}
                </option>
              ))}
            </select>
          ) : isRestricted ? (
            <span className="app-nav-scope" title={allowedPaths[0]}>
              {pathBasename(allowedPaths[0])}
            </span>
          ) : null}
        </div>
        <div className="app-nav-actions">
          {canUpload ? (
            <>
              <button type="button" className="nav-icon-btn" onClick={() => openDialog('folder')} title="New folder" aria-label="New folder">
                <IcFolderPlus />
              </button>
              <button type="button" className="nav-icon-btn" onClick={() => openDialog('file')} title="New file" aria-label="New file">
                <IcFilePlus />
              </button>
            </>
          ) : null}
          {canEdit ? (
            <>
              <button
                type="button"
                className="nav-icon-btn"
                disabled={!pathForAction}
                title={!pathForAction ? 'Select one item (or open one file) to rename' : 'Rename'}
                aria-label="Rename"
                onClick={() => openDialog('rename', pathForAction.split(/[/\\]+/).pop() || '')}
              >
                <IcPencil />
              </button>
              <button type="button" className="nav-icon-btn" onClick={() => openDialog('move', effectiveDir)} title="Move" aria-label="Move">
                <IcArrowsRightLeft />
              </button>
              <button
                type="button"
                className="nav-icon-btn"
                onClick={() => openDialog('copy', effectiveDir)}
                title="Copy"
                aria-label="Copy"
              >
                <IcDuplicate />
              </button>
            </>
          ) : null}
          {canDownload ? (
            <button
              type="button"
              className="nav-icon-btn"
              onClick={() => {
                openFolderDownloadPage(effectiveDir);
              }}
              title="Download folder as ZIP"
              aria-label="Download folder as ZIP"
            >
              <IcArchiveArrowDown />
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="nav-icon-btn nav-icon-danger"
              onClick={() => openDialog('delete')}
              title="Delete"
              aria-label="Delete"
            >
              <IcTrash />
            </button>
          ) : null}
          {fileName && canDownload ? (
            <a
              className="nav-icon-btn"
              href={downloadFileUrl(dirPath, fileName)}
              title="Download file"
              aria-label="Download file"
            >
              <IcDownload />
            </a>
          ) : null}
          <a href="/dashboard" className="nav-icon-btn" title="Back to panel" aria-label="Back to panel">
            <IcOpenExternal />
          </a>
        </div>
      </header>

      <div className="app-main">
        <aside className="sidebar" style={{ width: sidebarWidth, flexShrink: 0 }}>
          {isRestricted && allowedPaths.length > 1 ? (
            <div className="sidebar-allowed-roots">
              <div className="sidebar-allowed-roots-label">Your folders</div>
              {allowedPaths.map((p) => {
                const active = pathsEqual(p, activeAllowedRoot);
                return (
                  <button
                    key={p}
                    type="button"
                    className={`sidebar-allowed-root${active ? ' active' : ''}`}
                    title={p}
                    onClick={() => openFolder(p)}
                  >
                    <span aria-hidden>📁</span>
                    <span className="sidebar-allowed-root-name">{pathBasename(p)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="sidebar-search">
            <input placeholder="Search in this folder…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div
            className="file-list"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                selectAllInView();
              }
            }}
            onContextMenu={(e) => {
              if (e.target === e.currentTarget) {
                handleFileListBackgroundContextMenu(e);
              }
            }}
          >
            {filtered.map((it, index) => {
              const isSel = selectedEntries.some((s) => sameEntry(s, it));
              const isOpenFile = it.type === 'file' && it.name === fileName;
              return (
                <div
                  key={it.name + it.type}
                  className={`file-row ${isSel ? 'selected' : ''} ${isOpenFile ? 'active' : ''}`}
                  onClick={(e) => {
                    if (e.detail > 1) return;
                    handleRowPointerDown(it, index, e);
                  }}
                  onContextMenu={(e) => handleRowContextMenu(it, index, e)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    const base = (listPath || dirPath || home).replace(/[/\\]+$/, '');
                    if (it.type === 'dir') {
                      openFolder(joinPath(base, it.name));
                    } else {
                      openFile(base, it.name);
                    }
                  }}
                >
                  <span className="file-row-icon-label">
                    <span className="file-row-emoji" aria-hidden>
                      {it.type === 'dir' ? '📁' : '📝'}
                    </span>
                    <span className="file-row-name">{it.name}</span>
                  </span>
                  <span
                    className="file-row-size"
                    title={it.type === 'file' && it.size != null ? `${it.size} bytes` : undefined}
                  >
                    {it.type === 'file' ? (it.sizeFormatted ?? '—') : '—'}
                  </span>
                  <span className="file-row-mtime" title={it.mtime ? new Date(it.mtime * 1000).toISOString() : undefined}>
                    {formatListDate(it.mtime)}
                  </span>
                </div>
              );
            })}
          </div>
        </aside>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={startSidebarResize}
        />

        <section className="editor-pane">
          {fileName ? (
            <>
              <div className="editor-toolbar">
                {canEdit ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={onSave}
                    disabled={!dirty || !!tooLarge}
                    title="Save (Ctrl+S)"
                  >
                    Save
                  </button>
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: 14 }}>Read only</span>
                )}
                <button type="button" onClick={() => setSearchParams({ p: dirPath })}>
                  Close file
                </button>
              </div>
              {tooLarge ? (
                <div className="empty-state">
                  File too large for the editor ({tooLarge}). Use Download or the classic UI.
                </div>
              ) : (
                <div className="editor-wrap">
                  <AceEditor
                    mode={aceMode}
                    theme="monokai"
                    width="100%"
                    height="100%"
                    style={{ flex: 1, minHeight: 0 }}
                    value={content}
                    onChange={(v) => {
                      setContent(v);
                      setDirty(true);
                    }}
                    readOnly={!canEdit}
                    setOptions={{ useWorker: false, fontSize: 14 }}
                    name="editor"
                  />
                </div>
              )}
            </>
          ) : (
            <div className="editor-empty">
              {canUpload ? (
                <UploadPanel
                  targetDir={effectiveDir}
                  disabled={!effectiveDir}
                  onAfterUpload={bumpList}
                  layout="editor"
                />
              ) : (
                <div className="empty-state">Select a file in the sidebar or open a folder. Use the toolbar for folder actions.</div>
              )}
            </div>
          )}
        </section>
      </div>

      {dialog ? (
        <div className="modal-overlay" role="presentation" onClick={() => setDialog(null)}>
          <div
            className={dialog === 'move' || dialog === 'copy' ? 'modal-box modal-box--wide' : 'modal-box'}
            onClick={(e) => e.stopPropagation()}
          >
            {dialog === 'rename' ? (
              <>
                <h3>Rename</h3>
                <p>{pathForAction}</p>
                <input
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={onDialogInputKeyDown}
                  placeholder="New name"
                  autoFocus
                />
              </>
            ) : null}
            {dialog === 'move' ? (
              <>
                <h3>Move</h3>
                <p className="modal-paths-label">From:</p>
                <pre className="modal-paths">{sourcesForDialog.join('\n') || '(nothing selected)'}</pre>
                {destinationPathField}
              </>
            ) : null}
            {dialog === 'copy' ? (
              <>
                <h3>Copy</h3>
                <p className="modal-paths-label">From:</p>
                <pre className="modal-paths">{sourcesForDialog.join('\n') || '(nothing selected)'}</pre>
                {destinationPathField}
              </>
            ) : null}
            {dialog === 'delete' ? (
              <>
                <h3>Delete</h3>
                <p>
                  {sourcesForDialog.length > 1
                    ? `Delete ${sourcesForDialog.length} items? This cannot be undone.`
                    : sourcesForDialog.length === 1
                      ? `Delete ${isActionOnFile ? 'file' : 'folder'}? This cannot be undone.`
                      : 'Nothing selected to delete.'}
                </p>
                {sourcesForDialog.length > 0 ? (
                  <pre className="modal-paths">{sourcesForDialog.join('\n')}</pre>
                ) : null}
              </>
            ) : null}
            {dialog === 'folder' ? (
              <>
                <h3>New folder</h3>
                <p>In: {effectiveDir}</p>
                <input
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={onDialogInputKeyDown}
                  placeholder="Folder name"
                  autoFocus
                />
              </>
            ) : null}
            {dialog === 'file' ? (
              <>
                <h3>New file</h3>
                <p>In: {effectiveDir}</p>
                <input
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={onDialogInputKeyDown}
                  placeholder="File name"
                  autoFocus
                />
              </>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              {dialog === 'delete' ? (
                <button type="button" className="primary" onClick={submitDialog}>
                  Delete
                </button>
              ) : (
                <button type="button" className="primary" onClick={submitDialog}>
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {ctxMenu
        ? createPortal(
            <div
              ref={ctxMenuRef}
              className="context-menu"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {ctxMenu.kind === 'list' ? (
                <>
                  <div className="context-menu-meta context-menu-meta-subtle">In: {effectiveDir}</div>
                  {canUpload ? (
                    <>
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCtxMenu(null);
                          openDialog('folder');
                        }}
                      >
                        <IcFolderPlus />
                        <span>New folder…</span>
                      </button>
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCtxMenu(null);
                          openDialog('file');
                        }}
                      >
                        <IcFilePlus />
                        <span>New file…</span>
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setCtxMenu(null);
                      selectAllInView();
                    }}
                  >
                    <IcGridSelect />
                    <span>Select all</span>
                  </button>
                </>
              ) : null}
              {ctxMenu.kind === 'row' ? (
                <>
                  {canUpload ? (
                    <>
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCtxMenu(null);
                          openDialog('folder');
                        }}
                      >
                        <IcFolderPlus />
                        <span>New folder…</span>
                      </button>
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCtxMenu(null);
                          openDialog('file');
                        }}
                      >
                        <IcFilePlus />
                        <span>New file…</span>
                      </button>
                      <div className="context-menu-sep" role="separator" />
                    </>
                  ) : null}
                  <div className="context-menu-meta">{selectedEntries.length} selected</div>
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setCtxMenu(null);
                      setSelectedEntries([]);
                    }}
                  >
                    <IcCircleX />
                    <span>Clear selection</span>
                  </button>
                  <button
                    type="button"
                    className="context-menu-item"
                    role="menuitem"
                    disabled={selectedEntries.length !== 1}
                    title={selectedEntries.length !== 1 ? 'Select a single item' : undefined}
                    onClick={() => {
                      setCtxMenu(null);
                      openSelectedOrNavigate();
                    }}
                  >
                    <IcOpenExternal />
                    <span>Open</span>
                  </button>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCtxMenu(null);
                          openDialog('move', effectiveDir);
                        }}
                      >
                        <IcArrowsRightLeft />
                        <span>Move…</span>
                      </button>
                      <button
                        type="button"
                        className="context-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCtxMenu(null);
                          openDialog('copy', effectiveDir);
                        }}
                      >
                        <IcDuplicate />
                        <span>Copy…</span>
                      </button>
                    </>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      className="context-menu-item danger"
                      role="menuitem"
                      onClick={() => {
                        setCtxMenu(null);
                        openDialog('delete');
                      }}
                    >
                      <IcTrash />
                      <span>Delete…</span>
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {toast ? (
        <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
