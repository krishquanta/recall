import React from 'react';
import { useAppStore } from '../store/appStore';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import clsx from 'clsx';

export const StatusToast: React.FC = () => {
  const toasts = useAppStore((state) => state.toasts);
  const removeToast = useAppStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        let borderClass = 'border-indigo-200 bg-white text-slate-800';
        let Icon = Info;
        let iconColor = 'text-indigo-600';

        if (toast.type === 'success') {
          borderClass = 'border-emerald-200 bg-white text-slate-800';
          Icon = CheckCircle2;
          iconColor = 'text-emerald-600';
        } else if (toast.type === 'warning') {
          borderClass = 'border-amber-200 bg-white text-slate-800';
          Icon = AlertTriangle;
          iconColor = 'text-amber-600';
        } else if (toast.type === 'error') {
          borderClass = 'border-rose-200 bg-white text-slate-800';
          Icon = XCircle;
          iconColor = 'text-rose-600';
        }

        return (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg shadow-slate-200/50 transition-all duration-300 animate-in fade-in slide-in-from-top-2',
              borderClass
            )}
            role="alert"
          >
            <Icon className={clsx('w-5 h-5 flex-shrink-0 mt-0.5', iconColor)} />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold tracking-tight">{toast.title}</h4>
              {toast.message && (
                <p className="text-xs text-slate-600 mt-0.5 line-clamp-3 leading-relaxed">
                  {toast.message}
                </p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
              aria-label="Dismiss toast"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
