import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  Settings,
  X,
  RefreshCw,
  Plus,
  Key,
  Clock,
  Sparkles,
  Database,
  CheckCircle2,
  AlertCircle,
  Activity,
  Layers,
  Globe,
} from 'lucide-react';
import { ResearchSettingsTab } from '../Research/ResearchSettingsTab';

export interface KeyStatusItem {
  keyId: string;
  maskedKey: string;
  status: 'ACTIVE' | 'COOLDOWN';
  cooldownRemainingMs: number;
  totalRequests: number;
  failedRequests: number;
  lastUsedTimestamp: number | null;
}

export interface CacheStatsData {
  embeddingHits: number;
  embeddingMisses: number;
  qaHits: number;
  qaMisses: number;
  totalRequestsSaved: number;
}

export interface SettingsResponse {
  keys: KeyStatusItem[];
  cacheStats: CacheStatsData;
  activeKeyCount: number;
  totalKeyCount: number;
}

export const SettingsModal: React.FC = () => {
  const isOpen = useAppStore((state) => state.isSettingsOpen);
  const closeSettings = useAppStore((state) => state.closeSettings);

  const [keys, setKeys] = useState<KeyStatusItem[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStatsData | null>(null);
  const [activeKeyCount, setActiveKeyCount] = useState<number>(0);
  const [totalKeyCount, setTotalKeyCount] = useState<number>(0);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [newKeyInput, setNewKeyInput] = useState<string>('');
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const [settingsTab, setSettingsTab] = useState<'api' | 'research'>('api');

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/settings/keys');
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch settings (${res.status})`);
      }
      const data: SettingsResponse = await res.json();
      setKeys(data.keys || []);
      setCacheStats(data.cacheStats || null);
      setActiveKeyCount(data.activeKeyCount ?? 0);
      setTotalKeyCount(data.totalKeyCount ?? 0);
    } catch (err: any) {
      setFetchError(err.message || 'Unable to connect to settings service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch telemetry whenever modal opens
  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      setAddError(null);
      setAddSuccess(null);
    }
  }, [isOpen, fetchSettings]);

  // Live cooldown countdown timer
  useEffect(() => {
    if (!isOpen) return;

    const hasCoolingKeys = keys.some((k) => k.status === 'COOLDOWN');
    if (!hasCoolingKeys) return;

    const interval = setInterval(() => {
      setKeys((prevKeys) =>
        prevKeys.map((k) => {
          if (k.status === 'COOLDOWN') {
            const nextRemaining = Math.max(0, k.cooldownRemainingMs - 1000);
            return {
              ...k,
              cooldownRemainingMs: nextRemaining,
              status: nextRemaining <= 0 ? 'ACTIVE' : 'COOLDOWN',
            };
          }
          return k;
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, keys]);

  // Keyboard escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeSettings]);

  if (!isOpen) return null;

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newKeyInput.trim();
    if (!trimmed) {
      setAddError('Field "key" is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);
    setAddSuccess(null);

    try {
      const res = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to add key (${res.status})`);
      }

      setNewKeyInput('');
      setAddSuccess(`Key ${data.keyStatus?.maskedKey || 'added'} successfully registered!`);
      await fetchSettings();
    } catch (err: any) {
      setAddError(err.message || 'Failed to add key');
    } finally {
      setIsAdding(false);
    }
  };

  const totalOps = cacheStats
    ? cacheStats.embeddingHits +
      cacheStats.embeddingMisses +
      cacheStats.qaHits +
      cacheStats.qaMisses
    : 0;
  const totalHits = cacheStats ? cacheStats.embeddingHits + cacheStats.qaHits : 0;
  const hitRate = totalOps > 0 ? Math.round((totalHits / totalOps) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={closeSettings}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 shadow-2xs">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="settings-modal-title"
                className="text-sm font-bold text-slate-900 tracking-tight"
              >
                Gemini API Settings & Optimization
              </h2>
              <p className="text-xs text-slate-500">
                Multi-key pooling, automatic 429 failover, and persistent cache metrics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={fetchSettings}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors disabled:opacity-50"
              title="Refresh telemetry"
              aria-label="Refresh telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
            <button
              onClick={closeSettings}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-5 gap-4">
          <button
            type="button"
            onClick={() => setSettingsTab('api')}
            className={`py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              settingsTab === 'api'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>API Keys & Cache</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsTab('research')}
            className={`py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              settingsTab === 'research'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Research & Sources</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          {settingsTab === 'research' ? (
            <ResearchSettingsTab />
          ) : (
            <>
              {fetchError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
                  <span>{fetchError}</span>
                </div>
              )}

          {/* Section 1: Cache Performance & Savings */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-500" />
                Cache Performance & Savings
              </h3>
              <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                Two-Tier Persistent Store
              </span>
            </div>

            {/* Prominent API Requests Saved Card */}
            <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 rounded-xl flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-emerald-900">
                  Total API Requests Avoided
                </div>
                <div className="text-[11px] text-emerald-700">
                  Zero-latency responses served directly from disk/memory cache
                </div>
              </div>
              <div className="text-right flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600 animate-pulse" />
                <span className="text-2xl font-black text-emerald-700 tracking-tight">
                  {cacheStats ? cacheStats.totalRequestsSaved : 0}
                </span>
              </div>
            </div>

            {/* Metrics Breakdown Grid */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
                <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-slate-400" />
                  Embedding Cache
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  <span className="text-emerald-600 font-bold">
                    {cacheStats ? cacheStats.embeddingHits : 0} hits
                  </span>{' '}
                  <span className="text-slate-400 font-normal">/</span>{' '}
                  <span className="text-slate-600">
                    {cacheStats ? cacheStats.embeddingMisses : 0} misses
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
                <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                  <Activity className="w-3 h-3 text-slate-400" />
                  Exact Q&A Cache
                </div>
                <div className="text-xs font-semibold text-slate-800">
                  <span className="text-emerald-600 font-bold">
                    {cacheStats ? cacheStats.qaHits : 0} hits
                  </span>{' '}
                  <span className="text-slate-400 font-normal">/</span>{' '}
                  <span className="text-slate-600">
                    {cacheStats ? cacheStats.qaMisses : 0} misses
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
                <div className="text-[11px] font-medium text-slate-500">Cache Hit Rate</div>
                <div className="text-xs font-semibold text-slate-800 flex items-baseline gap-1">
                  <span className="text-base font-bold text-indigo-600">{hitRate}%</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({totalHits}/{totalOps})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Key Pool & Health Status */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-indigo-500" />
                Key Pool & Health Status
              </h3>
              <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                {activeKeyCount} / {totalKeyCount} Active ({activeKeyCount * 15} RPM Total Capacity)
              </span>
            </div>

            {keys.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
                No Gemini API keys registered in pool. Add a key below to enable live responses.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                {keys.map((k) => {
                  const isCooling = k.status === 'COOLDOWN';
                  const remainingSec = Math.ceil(k.cooldownRemainingMs / 1000);

                  return (
                    <div
                      key={k.keyId}
                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200/80 select-all">
                          {k.maskedKey}
                        </span>

                        <div className="text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{k.totalRequests}</span>{' '}
                          requests
                          {k.failedRequests > 0 && (
                            <span className="text-red-600 ml-1.5">
                              · {k.failedRequests} failover{k.failedRequests > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isCooling ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs"
                            title={`In cooldown due to 429 rate limit. Resumes in ${remainingSec}s`}
                          >
                            <Clock className="w-3 h-3 text-amber-600 animate-spin" />
                            Cooldown ({remainingSec}s)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 3: Add New API Key */}
          <div className="space-y-2.5 pt-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-indigo-500" />
              Add Gemini API Key
            </h3>

            <form onSubmit={handleAddKey} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder="Enter Gemini API key (AIzaSy...)"
                  disabled={isAdding}
                  className="flex-1 px-3.5 py-2 text-xs bg-white border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isAdding || !newKeyInput.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-xs flex-shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isAdding ? 'Adding...' : 'Add Key'}
                </button>
              </div>

              {addError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700 animate-in fade-in">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <span>{addError}</span>
                </div>
              )}

              {addSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span>{addSuccess}</span>
                </div>
              )}
            </form>
          </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            Keys are load-balanced via round-robin with automatic 60s failover on 429 quota limits.
          </p>
          <button
            onClick={closeSettings}
            className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
