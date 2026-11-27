import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GripVertical,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { ReportUtilitiesConfig, ReportUtilitiesTargetKey } from '../types/fuel';
import {
  createDefaultReportUtilitiesConfig,
  createDefaultTargetItems,
  getReportUtilityTargetSpec,
  normalizeReportUtilitiesConfig,
  reorderReportUtilityItems,
  REPORT_UTILITIES_TARGET_SPECS,
  toggleReportUtilityItem,
} from '../utils/fuelEngine';

interface ReportUtilitiesModalProps {
  isOpen: boolean;
  config: ReportUtilitiesConfig;
  onClose: () => void;
  onSave: (
    nextConfig: ReportUtilitiesConfig
  ) => Promise<{ ok: boolean; error?: string; config?: ReportUtilitiesConfig }>;
}

function formatUpdatedTimestamp(iso?: string): string {
  if (!iso) return 'System Default';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReportUtilitiesModal({
  isOpen,
  config,
  onClose,
  onSave,
}: ReportUtilitiesModalProps) {
  const [activeTarget, setActiveTarget] = useState<ReportUtilitiesTargetKey>('workplans_preview');
  const [draft, setDraft] = useState<ReportUtilitiesConfig>(() =>
    normalizeReportUtilitiesConfig(config)
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(normalizeReportUtilitiesConfig(config));
      setNotice(null);
      setDragIndex(null);
      setDragOverIndex(null);
    }
  }, [isOpen, config]);

  useEscapeClose(isOpen, onClose, 4);

  const previewSpecs = useMemo(
    () => REPORT_UTILITIES_TARGET_SPECS.filter((s) => s.group === 'preview'),
    []
  );
  const forApprovalSpecs = useMemo(
    () => REPORT_UTILITIES_TARGET_SPECS.filter((s) => s.group === 'for_approval'),
    []
  );
  const monitoringSpecs = useMemo(
    () => REPORT_UTILITIES_TARGET_SPECS.filter((s) => s.group === 'post_approval_monitoring'),
    []
  );
  const fullReportSpecs = useMemo(
    () => REPORT_UTILITIES_TARGET_SPECS.filter((s) => s.group === 'full_report'),
    []
  );

  const currentSpec = useMemo(() => getReportUtilityTargetSpec(activeTarget), [activeTarget]);
  const fieldMetaByKey = useMemo(() => {
    const map = new Map<string, { label: string; description: string }>();
    for (const f of currentSpec.fields) {
      map.set(f.key, { label: f.label, description: f.description });
    }
    return map;
  }, [currentSpec]);

  const activeItems = draft[activeTarget];
  const enabledCount = activeItems.filter((i) => i.enabled).length;

  const hasUnsavedChanges = useMemo(() => {
    const base = normalizeReportUtilitiesConfig(config);
    for (const spec of REPORT_UTILITIES_TARGET_SPECS) {
      const a = draft[spec.target];
      const b = base[spec.target];
      if (a.length !== b.length) return true;
      for (let i = 0; i < a.length; i++) {
        if (a[i].key !== b[i].key || a[i].enabled !== b[i].enabled) return true;
      }
    }
    return false;
  }, [draft, config]);

  if (!isOpen) return null;

  const handleToggleItem = (key: string) => {
    const res = toggleReportUtilityItem(draft[activeTarget], key);
    if (res.blockedLastEnabled) {
      setNotice({
        type: 'warn',
        text: 'At least one column or section must remain checked for this layout.',
      });
      return;
    }
    setNotice(null);
    setDraft((prev) => ({ ...prev, [activeTarget]: res.items }));
  };

  const handleMoveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= activeItems.length) return;
    setNotice(null);
    setDraft((prev) => ({
      ...prev,
      [activeTarget]: reorderReportUtilityItems(prev[activeTarget], fromIndex, toIndex),
    }));
  };

  const handleSelectAllScope = () => {
    setNotice(null);
    setDraft((prev) => ({
      ...prev,
      [activeTarget]: prev[activeTarget].map((item) => ({ ...item, enabled: true })),
    }));
  };

  const handleResetScope = () => {
    setNotice(null);
    setDraft((prev) => ({
      ...prev,
      [activeTarget]: createDefaultTargetItems(activeTarget),
    }));
  };

  const handleResetAllDefaults = () => {
    setNotice({
      type: 'warn',
      text: 'All scopes staged to system defaults. Press Save & Apply System-Wide to commit.',
    });
    setDraft(createDefaultReportUtilitiesConfig(draft.updatedBy, draft.updatedAt));
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await onSave(draft);
      if (!res.ok) {
        setNotice({
          type: 'err',
          text: res.error || 'Failed to save Report Utilities configuration.',
        });
      } else {
        setNotice({
          type: 'ok',
          text: 'Saved. Sequence and checkbox selections are now active retroactively across the system until changed.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Report Utilities"
      data-testid="report-utilities-modal"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#1B3B6F] bg-white shadow-2xl">
        {/* Monochrome Top Header with Top-Right Close Button */}
        <div className="flex items-start justify-between gap-3 bg-[#0B192C] px-3.5 py-2.5 sm:px-5 sm:py-3.5 text-white shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="mt-0.5 rounded-md border border-white/15 bg-[#1B3B6F] p-1.5 shrink-0">
              <SlidersHorizontal className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-sm sm:text-base font-bold tracking-tight">
                Report Utilities — Layout
              </h2>
              <p className="hidden sm:block mt-0.5 text-xs text-slate-300">
                Pre-select included fields via checkboxes and arrange display sequence. Saved changes apply retroactively system-wide.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Report Utilities"
            data-testid="report-utilities-close-btn"
            className="inline-flex items-center justify-center rounded-md border border-white/25 bg-[#1B3B6F] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#274E8E] transition-colors whitespace-nowrap shrink-0"
          >
            Close
          </button>
        </div>

        {/* Main Split Layout */}
        <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* Left Navigation Rail: Horizontal scrollable bar on mobile, vertical rail on md+ */}
          <aside className="w-full border-b border-[#D5DCE6] bg-[#F8FAFC] p-2 md:w-72 md:border-b-0 md:border-r md:p-3 md:overflow-y-auto shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto md:block md:space-y-4">
              {(
                [
                  { id: 'preview', heading: 'Preview Windows', specs: previewSpecs },
                  {
                    id: 'for_approval',
                    heading: 'Work Plan — For Approval',
                    specs: forApprovalSpecs,
                  },
                  {
                    id: 'post_approval_monitoring',
                    heading: 'Work Plan — Post-Approval Monitoring',
                    specs: monitoringSpecs,
                  },
                  {
                    id: 'full_report',
                    heading: 'Daily Reconciliation Report',
                    specs: fullReportSpecs,
                  },
                ] as const
              ).map((groupSection) => (
                <div
                  key={groupSection.id}
                  data-testid={`utilities-group-${groupSection.id}`}
                  className="flex items-center gap-1.5 md:block shrink-0"
                >
                  <div className="hidden md:block px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
                    {groupSection.heading}
                  </div>
                  <div className="flex items-center gap-1.5 md:block md:space-y-1">
                    {groupSection.specs.map((spec) => {
                      const list = draft[spec.target];
                      const activeCnt = list.filter((x) => x.enabled).length;
                      const isSelected = activeTarget === spec.target;
                      return (
                        <button
                          key={spec.target}
                          type="button"
                          data-testid={`utilities-tab-${spec.target}`}
                          onClick={() => {
                            setActiveTarget(spec.target);
                            setNotice(null);
                          }}
                          className={`flex items-center justify-between gap-1.5 rounded-md px-2.5 py-1.5 md:w-full md:py-2 text-left text-[11px] md:text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            isSelected
                              ? 'bg-[#0B192C] text-white'
                              : 'border border-[#D5DCE6] md:border-0 bg-white md:bg-transparent text-[#1E3A5F] hover:bg-[#E6EBF2]'
                          }`}
                        >
                          <span className="truncate">{spec.shortLabel}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums shrink-0 ${
                              isSelected
                                ? 'bg-[#1B3B6F] text-white'
                                : 'border border-[#D5DCE6] bg-white text-[#334E73]'
                            }`}
                          >
                            {activeCnt}/{list.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Right Configuration Canvas */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-[#E6EBF2] pb-3.5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-sm font-bold text-[#0B192C]">
                    {currentSpec.title}
                  </h3>
                  {currentSpec.group === 'for_approval' && (
                    <span
                      data-testid="utilities-scope-badge-for-approval"
                      className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900"
                    >
                      For Approval · Includes Dept Sign-Offs
                    </span>
                  )}
                  {currentSpec.group === 'post_approval_monitoring' && (
                    <span
                      data-testid="utilities-scope-badge-monitoring"
                      className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900"
                    >
                      Post-Approval Monitoring · No Sign-Off Section
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[#5A6F8C]">{currentSpec.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span className="rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2 py-1 font-mono text-[11px] font-semibold text-[#1B3B6F]">
                  {enabledCount} of {activeItems.length} Included
                </span>
                <button
                  type="button"
                  onClick={handleSelectAllScope}
                  className="rounded border border-[#D5DCE6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1E3A5F] hover:bg-[#F3F5F8]"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleResetScope}
                  className="inline-flex items-center gap-1 rounded border border-[#D5DCE6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset Scope</span>
                </button>
              </div>
            </div>

            {notice && (
              <div
                role="status"
                data-testid="report-utilities-notice"
                className={`flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-xs font-medium ${
                  notice.type === 'ok'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : notice.type === 'err'
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{notice.text}</span>
              </div>
            )}

            <div className="space-y-2" data-testid={`utilities-list-${activeTarget}`}>
              {activeItems.map((item, idx) => {
                const meta = fieldMetaByKey.get(item.key);
                const isLastEnabled = item.enabled && enabledCount <= 1;
                const isDragging = dragIndex === idx;
                const isDragOver = dragOverIndex === idx && dragIndex !== idx;

                return (
                  <div
                    key={item.key}
                    draggable
                    data-testid={`utilities-item-${activeTarget}-${item.key}`}
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(idx);
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === idx) setDragOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== idx) {
                        handleMoveItem(dragIndex, idx);
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                      isDragOver
                        ? 'border-[#0B192C] bg-[#EEF2F8]'
                        : item.enabled
                          ? 'border-[#D5DCE6] bg-white hover:border-[#8FA0B8]'
                          : 'border-[#E6EBF2] bg-[#F8FAFC] opacity-75'
                    } ${isDragging ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        title="Drag to reorder"
                        className="cursor-grab text-[#8FA0B8] hover:text-[#1B3B6F] shrink-0"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>

                      <span className="w-7 text-center font-mono text-[11px] font-bold text-[#1B3B6F] rounded border border-[#D5DCE6] bg-[#F3F5F8] py-0.5 shrink-0">
                        #{idx + 1}
                      </span>

                      <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          data-testid={`utilities-checkbox-${activeTarget}-${item.key}`}
                          checked={item.enabled}
                          disabled={isLastEnabled}
                          title={
                            isLastEnabled
                              ? 'At least one item must remain included'
                              : `Include ${meta?.label ?? item.key}`
                          }
                          onChange={() => handleToggleItem(item.key)}
                          className="mt-0.5 h-4 w-4 rounded border-[#8FA0B8] accent-[#0B192C] cursor-pointer disabled:cursor-not-allowed"
                        />
                        <div className="min-w-0">
                          <div
                            className={`text-xs font-semibold ${
                              item.enabled ? 'text-[#0B192C]' : 'text-[#5A6F8C] line-through'
                            }`}
                          >
                            {meta?.label ?? item.key}
                          </div>
                          {meta?.description && (
                            <div className="text-[11px] text-[#5A6F8C] truncate">
                              {meta.description}
                            </div>
                          )}
                        </div>
                      </label>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`utilities-up-${activeTarget}-${item.key}`}
                        aria-label={`Move ${meta?.label ?? item.key} up`}
                        disabled={idx === 0}
                        onClick={() => handleMoveItem(idx, idx - 1)}
                        className="rounded border border-[#D5DCE6] bg-white p-1.5 text-[#1E3A5F] hover:bg-[#EEF2F8] disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid={`utilities-down-${activeTarget}-${item.key}`}
                        aria-label={`Move ${meta?.label ?? item.key} down`}
                        disabled={idx === activeItems.length - 1}
                        onClick={() => handleMoveItem(idx, idx + 1)}
                        className="rounded border border-[#D5DCE6] bg-white p-1.5 text-[#1E3A5F] hover:bg-[#EEF2F8] disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Persistence Bar */}
        <div className="flex flex-col gap-3 border-t border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div className="text-[11px] text-[#5A6F8C]">
            <div>
              <strong className="text-[#0B192C]">Last Applied:</strong>{' '}
              {formatUpdatedTimestamp(config.updatedAt)}
              {config.updatedBy && config.updatedBy !== 'system' ? ` by ${config.updatedBy}` : ''}
            </div>
            <div>
              {hasUnsavedChanges
                ? 'You have staged layout changes. Click Save & Apply System-Wide to activate.'
                : 'Current layout is active system-wide across all records until updated.'}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              data-testid="report-utilities-reset-all-btn"
              onClick={handleResetAllDefaults}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D5DCE6] bg-white px-3 py-2 text-xs font-semibold text-[#334E73] hover:bg-[#E6EBF2]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset All Defaults</span>
            </button>
            <button
              type="button"
              data-testid="save-report-utilities-btn"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50 whitespace-nowrap"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Applying...' : 'Save & Apply System-Wide'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
