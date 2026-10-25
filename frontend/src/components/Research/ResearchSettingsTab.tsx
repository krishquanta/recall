import React, { useState, useEffect } from 'react';
import { Globe, Shield, Plus, X, Save, Clock, Search, BookOpen } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ResearchSettings } from '../../types';

export const ResearchSettingsTab: React.FC = () => {
  const { addToast } = useAppStore();

  const [settings, setSettings] = useState<ResearchSettings>({
    approvedDomains: ['wikipedia.org', 'arxiv.org', '*.edu', '*.gov'],
    maxQueriesPerTask: 3,
    maxSourcesPerTask: 5,
    maxExecutionTimeMs: 120000,
    enableDuckDuckGo: true,
    enableWikipediaApi: true,
    enableArxivApi: true,
  });

  const [newDomain, setNewDomain] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/settings/research');
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch {
        // use defaults
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleAddDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;

    if (!settings.approvedDomains.includes(domain)) {
      setSettings((prev) => ({
        ...prev,
        approvedDomains: [...prev.approvedDomains, domain],
      }));
    }
    setNewDomain('');
  };

  const handleRemoveDomain = (domainToRemove: string) => {
    setSettings((prev) => ({
      ...prev,
      approvedDomains: prev.approvedDomains.filter((d) => d !== domainToRemove),
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/research', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!res.ok) throw new Error('Failed to update research settings');

      const updated = await res.json();
      setSettings(updated);

      addToast({
        type: 'success',
        title: 'Settings Saved',
        message: 'Research budgets, provider toggles, and approved domains updated.',
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Save Failed',
        message: err?.message || 'Failed to save settings',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-8 text-center text-xs text-slate-400">
        Loading research settings...
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-200">
      {/* Approved Domain Allowlist */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Approved Domain Allowlist (SSRF Protection)
          </h4>
        </div>
        <p className="text-xs text-slate-400">
          The research agent only queries and fetches content from matching domains and wildcards (e.g. *.edu, *.gov). Private network addresses and loopback IPs are blocked unconditionally.
        </p>

        {/* Domain tags */}
        <div className="flex flex-wrap gap-2 p-3 bg-slate-950/60 border border-slate-800 rounded-xl min-h-[48px]">
          {settings.approvedDomains.map((dom) => (
            <span
              key={dom}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-800/80 text-blue-300 border border-slate-700/60"
            >
              <span>{dom}</span>
              <button
                type="button"
                onClick={() => handleRemoveDomain(dom)}
                className="text-slate-400 hover:text-rose-400"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        {/* Add domain form */}
        <form onSubmit={handleAddDomain} className="flex gap-2">
          <input
            type="text"
            placeholder="Add domain or wildcard (e.g. *.edu, nih.gov)..."
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            className="flex-1 px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!newDomain.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-xl border border-slate-700"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </form>
      </div>

      {/* Hard Budget Controls */}
      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Task Execution Budgets
          </h4>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 block">Max Queries / Task</label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.maxQueriesPerTask}
              onChange={(e) =>
                setSettings({ ...settings, maxQueriesPerTask: parseInt(e.target.value, 10) || 1 })
              }
              className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 block">Max Sources / Task</label>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.maxSourcesPerTask}
              onChange={(e) =>
                setSettings({ ...settings, maxSourcesPerTask: parseInt(e.target.value, 10) || 1 })
              }
              className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 block">Timeout (Seconds)</label>
            <input
              type="number"
              min={10}
              max={300}
              value={Math.round(settings.maxExecutionTimeMs / 1000)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxExecutionTimeMs: (parseInt(e.target.value, 10) || 10) * 1000,
                })
              }
              className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Discovery Provider Toggles */}
      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-blue-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Enabled Discovery Providers
          </h4>
        </div>

        <div className="space-y-2.5">
          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableWikipediaApi}
              onChange={(e) => setSettings({ ...settings, enableWikipediaApi: e.target.checked })}
              className="rounded border-slate-700 text-blue-600 focus:ring-0"
            />
            <BookOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Wikipedia REST API (Free structured academic summaries)</span>
          </label>

          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableArxivApi}
              onChange={(e) => setSettings({ ...settings, enableArxivApi: e.target.checked })}
              className="rounded border-slate-700 text-blue-600 focus:ring-0"
            />
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>arXiv API (Scientific preprints and abstracts)</span>
          </label>

          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableDuckDuckGo}
              onChange={(e) => setSettings({ ...settings, enableDuckDuckGo: e.target.checked })}
              className="rounded border-slate-700 text-blue-600 focus:ring-0"
            />
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <span>DuckDuckGo HTML Search (Broad web discovery filtered by allowlist)</span>
          </label>
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-3 border-t border-slate-800/80 flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl transition-all shadow-sm"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSaving ? 'Saving...' : 'Save Research Configuration'}</span>
        </button>
      </div>
    </div>
  );
};
