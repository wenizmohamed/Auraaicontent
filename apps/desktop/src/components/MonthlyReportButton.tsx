import { useState } from 'react';
import { FileDown, Loader2, ChevronDown, Check } from 'lucide-react';
import { reportsApi, jobsApi, type ReportTheme } from '../lib/backend-api';
import { useJobSocket } from '../lib/socket';

interface Props {
  clientId: string;
  month: string;
  postCount: number;
  onStatus?: (msg: string, type: 'ok' | 'error' | 'info') => void;
}

const THEME_LABELS: Record<ReportTheme, { label: string; hint: string }> = {
  aura: { label: 'Aura', hint: 'Warm light deck with amber accent' },
  dark: { label: 'Dark', hint: 'High-contrast dark with violet accent' },
  pitch: { label: 'Pitch', hint: 'Sales-deck dark with electric blue' },
};

export default function MonthlyReportButton({ clientId, month, postCount, onStatus }: Props) {
  const [theme, setTheme] = useState<ReportTheme>('aura');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Hook listens to /socket.io for live progress, with polling fallback so
  // a flaky WS still gets the user a deck.
  const { job, transport } = useJobSocket(jobId, {
    pollFetcher: async (id) => {
      const j = await jobsApi.get(id);
      return {
        id: j.id,
        type: j.type,
        status: j.status,
        progress: j.progress,
        result: j.result,
        error: j.error || undefined,
        updatedAt: j.updatedAt,
      };
    },
    onComplete: (j) => {
      const url = j.result?.fileUrl ? reportsApi.downloadUrl(j.result.fileUrl) : null;
      if (url) {
        setDownloadUrl(url);
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setJobId(null);
      onStatus?.(`Report ready · ${j.result?.postCount ?? '?'} posts`, 'ok');
    },
    onError: (j) => {
      onStatus?.(`Report failed: ${j.error || 'unknown error'}`, 'error');
      setJobId(null);
    },
  });

  const isWorking = !!jobId && job?.status !== 'completed' && job?.status !== 'failed';
  const progress = job?.progress ?? 0;

  const trigger = async () => {
    if (isWorking || postCount === 0) return;
    setDownloadUrl(null);
    try {
      const { jobId: id } = await reportsApi.triggerMonthly(clientId, month, theme);
      setJobId(id);
      onStatus?.(`Report queued · ${THEME_LABELS[theme].label} theme`, 'info');
    } catch (err: any) {
      onStatus?.(`Report failed: ${err?.message || 'request error'}`, 'error');
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1">
      <button
        onClick={trigger}
        disabled={isWorking || postCount === 0}
        title={postCount === 0 ? 'No posts in this month' : `Generate ${THEME_LABELS[theme].label} report`}
        className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 px-4 py-2 rounded-xl text-sm font-medium hover:bg-amber-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
        {isWorking ? `Generating ${progress}%` : 'Monthly Report'}
        {transport === 'socket' && isWorking && (
          <span className="text-[8px] uppercase tracking-wider text-amber-400/70" title="Live via WebSocket">live</span>
        )}
      </button>

      <button
        onClick={() => setPickerOpen((v) => !v)}
        disabled={isWorking}
        className="flex items-center justify-center bg-amber-500/10 border border-amber-500/20 text-amber-300 w-8 h-9 rounded-xl hover:bg-amber-500/20 cursor-pointer disabled:opacity-50"
        title="Choose theme"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {pickerOpen && (
        <div
          className="absolute right-0 top-full mt-1 bg-zinc-900 border border-white/[0.08] rounded-xl shadow-2xl z-50 min-w-[220px] py-1"
          onMouseLeave={() => setPickerOpen(false)}
        >
          {(Object.keys(THEME_LABELS) as ReportTheme[]).map((key) => (
            <button
              key={key}
              onClick={() => {
                setTheme(key);
                setPickerOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.04] flex items-center gap-2"
            >
              <div className="w-4 h-4 flex items-center justify-center">
                {theme === key && <Check className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              <div className="flex-1">
                <div className="text-xs text-zinc-200 font-medium">{THEME_LABELS[key].label}</div>
                <div className="text-[10px] text-zinc-500">{THEME_LABELS[key].hint}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {downloadUrl && !isWorking && (
        <a
          href={downloadUrl}
          download
          className="ml-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg hover:bg-amber-500/20"
        >
          Download again
        </a>
      )}
    </div>
  );
}
