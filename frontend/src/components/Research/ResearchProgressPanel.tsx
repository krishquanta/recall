import React from 'react';
import { Loader2, Globe, Search, Clock, XCircle, CheckCircle2 } from 'lucide-react';

interface ResearchProgressPanelProps {
  progress: {
    queriesUsed: number;
    sourcesFetched: number;
    elapsedMs: number;
  } | null;
  maxQueries?: number;
  maxSources?: number;
  maxTimeMs?: number;
  currentQuery?: string;
  onCancel?: () => void;
}

export const ResearchProgressPanel: React.FC<ResearchProgressPanelProps> = ({
  progress,
  maxQueries = 3,
  maxSources = 5,
  maxTimeMs = 120000,
  currentQuery,
  onCancel,
}) => {
  const queriesUsed = progress?.queriesUsed ?? 1;
  const sourcesFetched = progress?.sourcesFetched ?? 0;
  const elapsedSec = Math.floor((progress?.elapsedMs ?? 0) / 1000);
  const maxSec = Math.floor(maxTimeMs / 1000);

  // Progress percentage based on queries and sources
  const queryPct = (queriesUsed / maxQueries) * 40;
  const sourcePct = (sourcesFetched / maxSources) * 50;
  const progressPct = Math.min(95, Math.max(15, queryPct + sourcePct));

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-5 space-y-4 text-slate-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          <div>
            <h4 className="text-sm font-semibold text-white">Autonomous Research In Progress</h4>
            <p className="text-xs text-slate-400">
              Querying allowlisted repositories, Wikipedia, and academic pre-prints...
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            onClick={onCancel}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors border border-rose-500/20"
          >
            <XCircle className="w-3.5 h-3.5" />
            Cancel Task
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>Retrieval & Synthesis</span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Budget Counters */}
      <div className="grid grid-cols-3 gap-3 pt-1">
        <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
          <Search className="w-4 h-4 text-blue-400 shrink-0" />
          <div>
            <div className="text-[11px] text-slate-400">Queries Issued</div>
            <div className="text-xs font-semibold text-slate-200">
              {queriesUsed} / {maxQueries}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
          <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <div className="text-[11px] text-slate-400">Sources Fetched</div>
            <div className="text-xs font-semibold text-slate-200">
              {sourcesFetched} / {maxSources}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <div className="text-[11px] text-slate-400">Elapsed Time</div>
            <div className="text-xs font-semibold text-slate-200">
              {elapsedSec}s / {maxSec}s
            </div>
          </div>
        </div>
      </div>

      {/* Discovery Feed / Log snippet */}
      <div className="text-xs space-y-1.5 text-slate-400 bg-slate-950/40 p-3 rounded-lg border border-slate-900">
        <div className="flex items-center gap-2 text-slate-300">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Allowlist verification: Enforcing SSRF & private IP guards</span>
        </div>
        {currentQuery && (
          <div className="flex items-center gap-2 text-slate-400 pl-5 truncate">
            <span className="text-slate-500">Current target:</span>
            <span className="italic text-slate-300 font-mono text-[11px] truncate">{currentQuery}</span>
          </div>
        )}
      </div>
    </div>
  );
};
