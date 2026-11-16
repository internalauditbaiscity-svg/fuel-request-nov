import { useMemo, useState } from 'react';
import { History, Search, ShieldAlert } from 'lucide-react';
import { AuditLog, UserAccount } from '../types/fuel';
import { canViewAuditLogs } from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface AuditLogsViewProps {
  logs: AuditLog[];
  currentUser: UserAccount;
}

export function AuditLogsView({ logs, currentUser }: AuditLogsViewProps) {
  const isAdmin = canViewAuditLogs(currentUser.role);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...logs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(
        (l) =>
          !q ||
          l.action.toLowerCase().includes(q) ||
          l.actorEmail.toLowerCase().includes(q) ||
          l.summary.toLowerCase().includes(q) ||
          (l.department ?? '').toLowerCase().includes(q)
      );
  }, [logs, search]);

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-[#D5DCE6] bg-white p-8 text-center space-y-2">
        <ShieldAlert className="mx-auto h-8 w-8 text-[#1B3B6F]" />
        <h2 className="font-display text-base font-bold text-[#0B192C]">
          Administrator Access Required
        </h2>
        <p className="text-xs text-[#5A6F8C]">
          Only the System Administrator is permitted to inspect system Audit Logs.
        </p>
      </div>
    );
  }

  return (
    <RecordsPreviewGate
      title="Immutable System Audit Trail Logs"
      description="All user account mutations, work plan submissions, approvals, and fuel dispensing audit logs remain hidden until Preview is pressed."
      recordCount={logs.length}
      previewOpen={previewOpen}
      onTogglePreview={setPreviewOpen}
      buttonLabel="Preview Audit Logs"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter audit trail by actor, action, office, or summary..."
              aria-label="Filter audit logs"
              className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] py-2 pl-9 pr-3 text-sm text-[#0B192C]"
            />
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#5A6F8C] font-mono">
            <History className="h-4 w-4" />
            <span>{filtered.length} immutable record(s)</span>
          </div>
        </div>

        <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                  <th className="px-4 py-2.5 font-semibold">Actor & Role</th>
                  <th className="px-4 py-2.5 font-semibold">Action</th>
                  <th className="px-4 py-2.5 font-semibold">Entity</th>
                  <th className="px-4 py-2.5 font-semibold">Transaction Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#5A6F8C]">
                      No audit log entries match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F9FAFC]">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#5A6F8C] whitespace-nowrap">
                        {log.createdAt.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[#0B192C]">{log.actorEmail}</div>
                        <div className="text-[11px] text-[#5A6F8C]">
                          {log.actorRole} · {log.department || 'City-Wide'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-[#1B3B6F] whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#334E73] whitespace-nowrap">
                        {log.entityType}:{log.entityId.slice(0, 12)}
                      </td>
                      <td className="px-4 py-2.5 text-[#0B192C]">{log.summary}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RecordsPreviewGate>
  );
}
