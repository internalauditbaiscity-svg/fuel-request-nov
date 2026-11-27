import { useMemo, useState } from 'react';
import { Eye, History, Lock, Search, ShieldAlert, X } from 'lucide-react';
import { AuditLog, AuditLogCategory, FleetVehicle, ROLE_LABELS, UserAccount, UserRole } from '../types/fuel';
import {
  canViewAuditLogs,
  classifyAuditLogCategory,
  filterAuditLogs,
  formatAuditTimestamp,
  getDepartmentMnemonic,
  parseAuditDetailsEntries,
} from '../utils/fuelEngine';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface AuditLogsViewProps {
  logs: AuditLog[];
  vehicles?: FleetVehicle[];
  currentUser: UserAccount;
}

const CATEGORY_TABS: Array<{ id: AuditLogCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All Events' },
  { id: 'credential', label: 'Credentials & Auth' },
  { id: 'transaction', label: 'Transactions' },
  { id: 'registry', label: 'Registries' },
  { id: 'system', label: 'System' },
];

const CATEGORY_LABELS: Record<AuditLogCategory, string> = {
  credential: 'Credentials & Auth',
  transaction: 'Transaction',
  registry: 'Master Registry',
  system: 'System',
};

const CATEGORY_ACCENT: Record<AuditLogCategory, string> = {
  credential: 'border-l-[#1B3B6F] text-[#1B3B6F]',
  transaction: 'border-l-emerald-700 text-emerald-800',
  registry: 'border-l-amber-600 text-amber-800',
  system: 'border-l-slate-500 text-slate-700',
};

function formatRoleDisplay(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}

export function AuditLogsView({ logs, vehicles = [], currentUser }: AuditLogsViewProps) {
  const isAdmin = canViewAuditLogs(currentUser.role);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AuditLogCategory | 'all'>('all');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Close floating detail window first on Escape (priority 2 > RecordsPreviewGate priority 1)
  useEscapeClose(Boolean(selectedLog), () => setSelectedLog(null), 2);

  const filtered = useMemo(
    () =>
      filterAuditLogs(logs, {
        search,
        category: categoryFilter,
      }),
    [logs, search, categoryFilter]
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<AuditLogCategory | 'all', number> = {
      all: logs.length,
      credential: 0,
      transaction: 0,
      registry: 0,
      system: 0,
    };
    for (const log of logs) {
      const cat = classifyAuditLogCategory(log);
      counts[cat] += 1;
    }
    return counts;
  }, [logs]);

  if (!isAdmin) {
    return (
      <div
        data-testid="audit-access-denied"
        className="rounded-lg border border-[#D5DCE6] bg-white p-8 text-center space-y-2"
      >
        <ShieldAlert className="mx-auto h-8 w-8 text-[#1B3B6F]" />
        <h2 className="font-display text-base font-bold text-[#0B192C]">
          Administrator Access Required
        </h2>
        <p className="text-xs text-[#5A6F8C]">
          Only the System Administrator is permitted to inspect the immutable Audit Trail.
        </p>
      </div>
    );
  }

  const selectedCategory = selectedLog ? classifyAuditLogCategory(selectedLog) : null;
  const selectedDetailEntries = selectedLog ? parseAuditDetailsEntries(selectedLog.details) : [];

  return (
    <>
      <RecordsPreviewGate
        title="Immutable System Audit Trail"
        description="Complete append-only log of all fuel transactions, credential sign-ins/failures, RBAC changes, registry updates, and system actions. Latest records appear first."
        recordCount={logs.length}
        previewOpen={previewOpen}
        onTogglePreview={(nextOpen) => {
          setPreviewOpen(nextOpen);
          if (!nextOpen) setSelectedLog(null);
        }}
        buttonLabel="Preview Audit Trail"
        maxWidthClass="max-w-[96vw] sm:max-w-5xl lg:max-w-6xl"
      >
        <div className="space-y-3">
          {/* Category Filter + Search Bar */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-[#D5DCE6] bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Audit Event Categories">
              {CATEGORY_TABS.map((tab) => {
                const active = categoryFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`audit-cat-${tab.id}`}
                    onClick={() => setCategoryFilter(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
                      active
                        ? 'bg-[#0B192C] text-white'
                        : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`font-mono text-[10px] ${active ? 'text-white/80' : 'text-[#5A6F8C]'}`}>
                      {categoryCounts[tab.id]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5A6F8C]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search actor, action, entity, details..."
                  aria-label="Filter audit logs"
                  data-testid="audit-search-input"
                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F8FAFC] py-1.5 pl-8 pr-2.5 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
                />
              </div>
              <div className="hidden md:flex items-center gap-1 text-[11px] text-[#5A6F8C] font-mono shrink-0">
                <Lock className="h-3 w-3 text-[#1B3B6F]" />
                <span>Immutable</span>
              </div>
            </div>
          </div>

          {/* Audit Trail Table (Timestamp Leftmost, Latest First, Clickable Rows) */}
          <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6EBF2] bg-[#F8FAFC] px-3 py-1.5 text-[11px] text-[#5A6F8C]">
              <div className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5 text-[#1B3B6F]" />
                <span>
                  Showing <strong className="font-mono text-[#0B192C]">{filtered.length}</strong> of{' '}
                  <strong className="font-mono text-[#0B192C]">{logs.length}</strong> immutable records (newest on top)
                </span>
              </div>
              <span className="text-[10px] font-medium text-[#334E73]">
                Select any row to view full record details
              </span>
            </div>

            <div className="overflow-x-auto">
              <table data-testid="audit-logs-table" className="w-full text-left text-[11px]">
                <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                  <tr>
                    <th className="px-2.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                      Timestamp
                    </th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                      Category
                    </th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                      Action
                    </th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                      Actor
                    </th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                      Entity
                    </th>
                    <th className="px-2.5 py-2 text-left text-[10px] font-bold tracking-wide">
                      Summary
                    </th>
                    <th className="px-2.5 py-2 text-center text-[10px] font-bold tracking-wide whitespace-nowrap">
                      Record
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EBF2]">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-xs text-[#5A6F8C]">
                        No immutable audit records match the active filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((log) => {
                      const cat = classifyAuditLogCategory(log);
                      const isSelected = selectedLog?.id === log.id;
                      return (
                        <tr
                          key={log.id}
                          data-testid={`audit-row-${log.id}`}
                          onClick={() => setSelectedLog(log)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#EEF2F8]' : 'hover:bg-[#F8FAFC]'
                          }`}
                        >
                          {/* Leftmost Column: Timestamp */}
                          <td className="px-2.5 py-2 font-mono text-[11px] font-semibold tabular-nums text-[#0B192C] whitespace-nowrap">
                            {formatAuditTimestamp(log.createdAt)}
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap">
                            <span
                              className={`inline-block border-l-2 pl-2 text-[10px] font-bold ${CATEGORY_ACCENT[cat]}`}
                            >
                              {CATEGORY_LABELS[cat]}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 font-mono text-[10px] font-bold text-[#1B3B6F] whitespace-nowrap">
                            {log.action}
                          </td>
                          <td className="px-2.5 py-2">
                            <div className="font-semibold text-[#0B192C] leading-tight">
                              {log.actorName || log.actorEmail}
                            </div>
                            <div
                              className="text-[10px] text-[#5A6F8C] leading-tight"
                              title={log.department || 'City-Wide'}
                            >
                              {log.actorEmail} · {log.actorRole}
                              {log.department ? ` · ${getDepartmentMnemonic(log.department, vehicles)}` : ''}
                            </div>
                          </td>
                          <td className="px-2.5 py-2 font-mono text-[10px] text-[#334E73] whitespace-nowrap">
                            <span className="font-semibold text-[#0B192C]">{log.entityType}</span>
                            <span className="text-[#5A6F8C]">:{log.entityId.slice(0, 14)}</span>
                          </td>
                          <td className="px-2.5 py-2 text-[#0B192C] max-w-md">
                            <div className="line-clamp-2 leading-snug">{log.summary}</div>
                          </td>
                          <td className="px-2.5 py-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              data-testid={`audit-inspect-btn-${log.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLog(log);
                              }}
                              className="inline-flex items-center gap-1 rounded border border-[#C5D1E3] bg-white px-2 py-1 text-[10px] font-bold text-[#1B3B6F] hover:bg-[#0B192C] hover:text-white transition-colors"
                            >
                              <Eye className="h-3 w-3" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </RecordsPreviewGate>

      {/* Floating Full Record Details Window */}
      {selectedLog && selectedCategory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Full Audit Record Details"
          data-testid="audit-record-detail-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedLog(null);
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B192C]/65 p-3 sm:p-5"
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#CBD5E1] bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#D5DCE6] bg-[#0B192C] px-4 py-3.5 text-white">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/75">
                  <span>{CATEGORY_LABELS[selectedCategory]}</span>
                  <span aria-hidden="true">·</span>
                  <span>Record ID: {selectedLog.id}</span>
                  {selectedLog.environment && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Env: {selectedLog.environment.toUpperCase()}</span>
                    </>
                  )}
                </div>
                <h3 className="font-mono text-sm font-bold text-white break-all">
                  {selectedLog.action}
                </h3>
              </div>
              <button
                type="button"
                data-testid="audit-detail-close-btn"
                onClick={() => setSelectedLog(null)}
                aria-label="Close audit record details"
                className="inline-flex items-center gap-1 rounded-md border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Timestamp & Identity Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
                    Event Timestamp
                  </div>
                  <div
                    data-testid="audit-detail-timestamp"
                    className="mt-1 font-mono text-sm font-bold tabular-nums text-[#0B192C]"
                  >
                    {formatAuditTimestamp(selectedLog.createdAt)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[#5A6F8C] break-all">
                    ISO: {selectedLog.createdAt}
                  </div>
                </div>

                <div className="rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
                    Target Entity
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-[#1B3B6F]">
                    {selectedLog.entityType}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[#334E73] break-all">
                    ID: {selectedLog.entityId}
                  </div>
                </div>
              </div>

              {/* Actor Metadata */}
              <div className="rounded-md border border-[#D5DCE6] bg-white overflow-hidden">
                <div className="border-b border-[#E6EBF2] bg-[#F8FAFC] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F]">
                  Actor &amp; Credential Attribution
                </div>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 p-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Actor Name</dt>
                    <dd className="font-semibold text-[#0B192C]">
                      {selectedLog.actorName || selectedLog.actorEmail}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Email / Identifier</dt>
                    <dd className="font-mono text-[11px] text-[#0B192C] break-all">
                      {selectedLog.actorEmail}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Assigned Role</dt>
                    <dd className="font-semibold text-[#1B3B6F]">
                      {formatRoleDisplay(selectedLog.actorRole)}{' '}
                      <span className="font-mono text-[10px] text-[#5A6F8C]">({selectedLog.actorRole})</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Department / Office</dt>
                    <dd className="font-medium text-[#0B192C]">
                      {selectedLog.department || 'City-Wide / System'}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Actor UID</dt>
                    <dd className="font-mono text-[11px] text-[#334E73] break-all">
                      {selectedLog.actorUid}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Full Event Summary */}
              <div className="rounded-md border border-[#D5DCE6] bg-white p-3 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
                  Full Action Summary
                </div>
                <p data-testid="audit-detail-summary" className="text-xs leading-relaxed text-[#0B192C]">
                  {selectedLog.summary}
                </p>
              </div>

              {/* Structured Event Details */}
              {selectedDetailEntries.length > 0 && (
                <div className="rounded-md border border-[#D5DCE6] bg-white overflow-hidden">
                  <div className="border-b border-[#E6EBF2] bg-[#F8FAFC] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F]">
                    Recorded Transaction &amp; Event Details
                  </div>
                  <div className="divide-y divide-[#E6EBF2]">
                    {selectedDetailEntries.map((entry, idx) => (
                      <div
                        key={`${entry.label}-${idx}`}
                        className="flex flex-col gap-0.5 px-3 py-2 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                      >
                        <span className="text-[11px] font-semibold text-[#5A6F8C] shrink-0">
                          {entry.label}
                        </span>
                        <span className="font-mono text-[11px] font-medium text-[#0B192C] sm:text-right break-words">
                          {entry.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Immutable Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-[#D5DCE6] bg-[#F8FAFC] px-4 py-2.5 text-[11px] text-[#5A6F8C]">
              <div className="flex items-center gap-1.5 font-medium">
                <Lock className="h-3.5 w-3.5 text-[#1B3B6F] shrink-0" />
                <span>Immutable Append-Only Audit Record · Read-Only</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-md bg-[#0B192C] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
