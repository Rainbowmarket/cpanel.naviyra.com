import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { uploadFileToFolder } from '@/file-manager/client';

export type UploadJob = {
  id: string;
  file: File;
  progress: number;
  loaded: number;
  total: number;
  /** Instantaneous / smoothed bytes per second */
  speedBps: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  startedAt: number;
};

type SpeedSample = { t: number; loaded: number };

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

/** Speed with adaptive unit: B/s, KB/s, or MB/s based on magnitude. */
function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  if (bps < 1024) return `${Math.max(1, Math.round(bps))} B/s`;
  if (bps < 1024 * 1024) {
    const kb = bps / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB/s`;
  }
  const mb = bps / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB/s`;
}

function formatEta(remainBytes: number, speedBps: number): string {
  if (!Number.isFinite(remainBytes) || remainBytes <= 0) return 'Done';
  if (!Number.isFinite(speedBps) || speedBps <= 0) return '…';
  const ms = (remainBytes / speedBps) * 1000;
  if (!Number.isFinite(ms) || ms > 24 * 3600 * 1000) return '—';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `~${s}s left`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS > 0 ? `~${m}m ${remS}s left` : `~${m}m left`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `~${h}h ${remM}m left` : `~${h}h left`;
}

/** Rolling-window bytes/sec from recent progress samples. */
function estimateSpeed(samples: SpeedSample[], loaded: number): number {
  const now = Date.now();
  samples.push({ t: now, loaded });
  while (samples.length > 1 && now - samples[0]!.t > 3000) {
    samples.shift();
  }
  if (samples.length < 2) return 0;
  const oldest = samples[0]!;
  const newest = samples[samples.length - 1]!;
  const dt = (newest.t - oldest.t) / 1000;
  const dBytes = newest.loaded - oldest.loaded;
  if (dt < 0.15 || dBytes < 0) return 0;
  return dBytes / dt;
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
  const speedSamples = useRef<Map<string, SpeedSample[]>>(new Map());
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

      for (const b of batch) {
        speedSamples.current.set(b.id, [{ t: b.startedAt, loaded: 0 }]);
      }

      setJobs((prev) => [
        ...prev,
        ...batch.map((b) => ({
          id: b.id,
          file: b.file,
          progress: 0,
          loaded: 0,
          total: b.total,
          speedBps: 0,
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
              const samples = speedSamples.current.get(id) ?? [];
              const speedBps = estimateSpeed(samples, loaded);
              speedSamples.current.set(id, samples);
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === id
                    ? { ...j, loaded, total: denom, progress: pct, speedBps }
                    : j,
                ),
              );
            });
            speedSamples.current.delete(id);
            setJobs((prev) =>
              prev.map((j) =>
                j.id === id
                  ? {
                      ...j,
                      status: 'done' as const,
                      progress: 100,
                      loaded: j.total,
                      speedBps: 0,
                    }
                  : j,
              ),
            );
            return true;
          } catch (e) {
            speedSamples.current.delete(id);
            setJobs((prev) =>
              prev.map((j) =>
                j.id === id
                  ? {
                      ...j,
                      status: 'error' as const,
                      speedBps: 0,
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
        {jobs.map((job) => {
          const remain = Math.max(0, job.total - job.loaded);
          return (
            <li key={job.id} className={`upload-job-card ${job.status}`}>
              <div className="upload-job-name">{job.file.name}</div>
              <div className="upload-job-bar-wrap">
                <div
                  className="upload-job-bar"
                  style={{ width: `${Math.min(100, job.progress)}%` }}
                />
              </div>
              <div className="upload-job-meta">
                <span className="upload-job-pct">{Math.min(100, job.progress)}%</span>
                <span className="upload-job-size">
                  {formatBytes(job.loaded)} / {formatBytes(job.total)}
                </span>
                {job.status === 'uploading' ? (
                  <>
                    <span className="upload-job-speed">{formatSpeed(job.speedBps)}</span>
                    <span className="upload-job-eta">{formatEta(remain, job.speedBps)}</span>
                  </>
                ) : job.status === 'done' ? (
                  <span className="upload-job-eta">Done</span>
                ) : (
                  <span className="upload-job-eta upload-job-eta--error">
                    {job.error || 'Error'}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
