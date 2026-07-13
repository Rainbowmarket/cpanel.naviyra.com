import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { uploadFileToFolder } from '@/file-manager/client';

export type UploadJob = {
  id: string;
  file: File;
  progress: number;
  loaded: number;
  total: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  startedAt: number;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const shown = u === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : String(Math.round(v));
  return `${shown} ${units[u]}`;
}

function formatEta(loaded: number, total: number, startedAt: number): string {
  if (loaded <= 0 || total <= loaded) return '—';
  const elapsed = Date.now() - startedAt;
  if (elapsed < 150) return '…';
  const rate = loaded / elapsed;
  const remain = total - loaded;
  if (rate <= 0) return '—';
  const ms = remain / rate;
  if (!Number.isFinite(ms) || ms > 600000) return '—';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `~${s}s left`;
  return `~${Math.ceil(s / 60)}m left`;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function UploadPanel(props: {
  targetDir: string;
  disabled?: boolean;
  onAfterUpload?: () => void;
  /** `editor` = large centered drop zone for empty main pane; default = sidebar strip */
  layout?: 'sidebar' | 'editor';
}) {
  const { targetDir, disabled, onAfterUpload, layout = 'sidebar' } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const processFiles = useCallback(
    async (list: File[]) => {
      if (!list.length || disabled) return;
      const dir = targetDir.trim();
      if (!dir) return;

      const batch = list.map((file) => ({
        id: newId(),
        file,
        startedAt: Date.now(),
        total: file.size || 1,
      }));

      setJobs((prev) => [
        ...prev,
        ...batch.map((b) => ({
          id: b.id,
          file: b.file,
          progress: 0,
          loaded: 0,
          total: b.total,
          status: 'uploading' as const,
          startedAt: b.startedAt,
        })),
      ]);

      const outcomes = await Promise.all(
        batch.map(async (b) => {
          const { id, file, total } = b;
          try {
            await uploadFileToFolder(dir, file, (loaded, tot) => {
              const denom = tot > 0 ? tot : total;
              const pct = Math.min(100, Math.round((loaded / denom) * 100));
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === id ? { ...j, loaded, total: denom, progress: pct } : j,
                ),
              );
            });
            setJobs((prev) =>
              prev.map((j) =>
                j.id === id ? { ...j, status: 'done' as const, progress: 100, loaded: j.total } : j,
              ),
            );
            return true;
          } catch (e) {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === id
                  ? {
                      ...j,
                      status: 'error' as const,
                      error: e instanceof Error ? e.message : 'Upload failed',
                    }
                  : j,
              ),
            );
            return false;
          }
        }),
      );

      if (outcomes.some(Boolean)) onAfterUpload?.();
    },
    [disabled, targetDir, onAfterUpload],
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files;
    if (f?.length) void processFiles(Array.from(f));
    e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || !targetDir.trim()) return;
    const dt = e.dataTransfer.files;
    if (dt?.length) void processFiles(Array.from(dt));
  };

  const clearDone = () => setJobs((j) => j.filter((x) => x.status !== 'done'));

  const zoneActive = !disabled && !!targetDir.trim();

  return (
    <div className={`upload-panel ${layout === 'editor' ? 'upload-panel--editor' : ''}`}>
      <p className="upload-panel-path">
        <span className="upload-panel-path-label">To:</span>{' '}
        <span className="upload-panel-path-value">{targetDir || '(no folder)'}</span>
      </p>
      <div
        className={`upload-dropzone ${dragOver && zoneActive ? 'upload-dropzone-active' : ''} ${!zoneActive ? 'upload-dropzone-disabled' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          if (zoneActive) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (zoneActive) e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        onClick={() => {
          if (zoneActive) inputRef.current?.click();
        }}
        role="button"
        tabIndex={zoneActive ? 0 : -1}
        onKeyDown={(e: KeyboardEvent) => {
          if ((e.key === 'Enter' || e.key === ' ') && zoneActive) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="upload-panel-file-input"
          onChange={onPick}
          disabled={!zoneActive}
        />
        <div className="upload-dropzone-text">Drop files here or click to upload</div>
        <div className="upload-dropzone-sub">ZIP files are extracted automatically</div>
      </div>

      {jobs.length > 0 ? (
        <div className="upload-jobs-header">
          <span>Uploads</span>
          {jobs.some((j) => j.status === 'done') ? (
            <button type="button" className="upload-jobs-clear" onClick={clearDone}>
              Clear finished
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="upload-job-list">
        {jobs.map((job) => (
          <li key={job.id} className={`upload-job-card ${job.status}`}>
            <div className="upload-job-name">{job.file.name}</div>
            <div className="upload-job-bar-wrap">
              <div className="upload-job-bar" style={{ width: `${Math.min(100, job.progress)}%` }} />
            </div>
            <div className="upload-job-meta">
              <span>{Math.min(100, job.progress)}%</span>
              <span>{formatBytes(job.total)}</span>
              <span className="upload-job-eta">
                {job.status === 'uploading'
                  ? formatEta(job.loaded, job.total, job.startedAt)
                  : job.status === 'done'
                    ? 'Done'
                    : job.status === 'error'
                      ? job.error || 'Error'
                      : '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
