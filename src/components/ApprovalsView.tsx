import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, ClipboardCheck, FolderOpen, ShieldAlert, X } from 'lucide-react';
import { TripTicket, UserAccount, WorkPlan } from '../types/fuel';
import {
  canPerformTabletopApproval,
  computeWorkPlanFuelTotals,
  evaluateTabletopApproval,
  getDynamicProgressiveYearOptions,
  isWorkPlanInactive,
} from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface ApprovalsViewProps {
  workPlans: WorkPlan[];
  tickets: TripTicket[];
  currentUser: UserAccount;
  onSubmitApproval: (
    workPlan: WorkPlan,
    adjustments: Array<{ ticket: TripTicket; proposedLiters: number; reason: string }>,
    approverNote: string
  ) => Promise<void>;
}

const MONTH_OPTIONS = [
  { value: 'all', label: 'All Months' },
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function ApprovalsView({
  workPlans,
  tickets,
  currentUser,
  onSubmitApproval,
}: ApprovalsViewProps) {
  const canApprove = canPerformTabletopApproval(currentUser.role);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [folderTab, setFolderTab] = useState<'active' | 'inactive'>('active');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const [draftAmounts, setDraftAmounts] = useState<Record<string, number>>({});
  const [draftReasons, setDraftReasons] = useState<Record<string, string>>({});
  const [planNotes, setPlanNotes] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    workPlans.forEach((wp) => set.add(wp.department));
    return Array.from(set).sort();
  }, [workPlans]);

  const yearOptions = useMemo(() => {
    return getDynamicProgressiveYearOptions({
      workPlans,
      tickets,
      order: 'asc',
    });
  }, [workPlans, tickets]);

  const activeFolderCount = useMemo(
    () => workPlans.filter((wp) => !isWorkPlanInactive(wp)).length,
    [workPlans]
  );
  const inactiveFolderCount = useMemo(
    () => workPlans.filter((wp) => isWorkPlanInactive(wp)).length,
    [workPlans]
  );

  const filteredPlans = useMemo(() => {
    return workPlans.filter((wp) => {
      const inactive = isWorkPlanInactive(wp);
      if (folderTab === 'active' && inactive) return false;
      if (folderTab === 'inactive' && !inactive) return false;

      if (departmentFilter !== 'all' && wp.department !== departmentFilter) return false;
      const dateRef = wp.weekStart || wp.createdAt || '';
      const wpYear = dateRef.slice(0, 4);
      const wpMonth = dateRef.slice(5, 7);
      if (yearFilter !== 'all' && wpYear !== yearFilter) return false;
      if (monthFilter !== 'all' && wpMonth !== monthFilter) return false;
      return true;
    });
  }, [workPlans, folderTab, departmentFilter, monthFilter, yearFilter]);

  const selectedPlan = useMemo(
    () => filteredPlans.find((wp) => wp.id === selectedPlanId) ?? null,
    [filteredPlans, selectedPlanId]
  );

  const getTicketProposed = (ticket: TripTicket) =>
    draftAmounts[ticket.id] !== undefined ? draftAmounts[ticket.id] : ticket.requestedLiters;

  const handleApprovePlan = async (plan: WorkPlan, planTickets: TripTicket[]) => {
    setSubmittingId(plan.id);
    try {
      const adjustments = planTickets.map((t) => ({
        ticket: t,
        proposedLiters: getTicketProposed(t),
        reason: draftReasons[t.id] ?? '',
      }));
      await onSubmitApproval(plan, adjustments, planNotes[plan.id] ?? '');
      setSelectedPlanId(null);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {!canApprove && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Tabletop fuel reduction and approval actions require <strong>Tabletop Approver</strong> or{' '}
            <strong>System Administrator</strong> privileges. You are currently viewing in read-only mode.
          </span>
        </div>
      )}

      {/* Folder Tabs (Active vs >30-Day Untouched Inactive) + Department / Month / Year Filters */}
      <div className="rounded-lg border border-[#D5DCE6] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setFolderTab('active');
                setSelectedPlanId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                folderTab === 'active'
                  ? 'bg-[#0B192C] text-white'
                  : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Active Folder ({activeFolderCount})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFolderTab('inactive');
                setSelectedPlanId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                folderTab === 'inactive'
                  ? 'bg-[#0B192C] text-white'
                  : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
              }`}
            >
              <Archive className="h-3.5 w-3.5" />
              <span>Inactive Folder &gt;30d ({inactiveFolderCount})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Filter by Department"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
            >
              <option value="all">All Departments</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by Month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by Year"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 font-mono text-xs text-[#0B192C]"
            >
              <option value="all">All Years</option>
              {yearOptions.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Preview-Gated Collapsed 5-Column Tabular Display */}
      <RecordsPreviewGate
        title={`Tabletop Approval — ${folderTab === 'active' ? 'Active Folder' : 'Inactive Folder (>1 Month Untouched)'}`}
        description="Click Preview to load the collapsed 5-column work plan summary table. Select any row to inspect trip tickets, reduce fuel requests, and approve."
        recordCount={filteredPlans.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Work Plans"
      >
        {filteredPlans.length === 0 ? (
          <div className="rounded-lg border border-[#D5DCE6] bg-white p-10 text-center space-y-2">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700" />
            <h2 className="font-display text-base font-bold text-[#0B192C]">
              No Work Plans in {folderTab === 'active' ? 'Active' : 'Inactive'} Folder
            </h2>
            <p className="text-xs text-[#5A6F8C]">
              Adjust your Department, Month, or Year filters to inspect other submissions.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Strictly 5-Column Collapsed Tabular Display */}
            <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Department</th>
                      <th className="px-4 py-3 font-semibold">Workplan No</th>
                      <th className="px-4 py-3 font-semibold text-right">No of Trip Tickets</th>
                      <th className="px-4 py-3 font-semibold text-right">Total Diesel</th>
                      <th className="px-4 py-3 font-semibold text-right">Total Gasoline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF2]">
                    {filteredPlans.map((plan) => {
                      const planTickets = tickets.filter((t) => t.workPlanId === plan.id);
                      const totals = computeWorkPlanFuelTotals(planTickets);
                      const isSelected = selectedPlanId === plan.id;

                      return (
                        <tr
                          key={plan.id}
                          onClick={() => setSelectedPlanId(isSelected ? null : plan.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#EEF2F8]' : 'hover:bg-[#F9FAFC]'
                          }`}
                        >
                          <td className="px-4 py-3 font-medium text-[#0B192C]">
                            {plan.department}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-[#1B3B6F] whitespace-nowrap">
                            {plan.controlNumber}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-[#0B192C]">
                            {totals.ticketCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-[#0B192C]">
                            {totals.totalDiesel.toFixed(1)} L
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-[#1B3B6F]">
                            {totals.totalGasoline.toFixed(1)} L
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Work Plan Detailed Tabletop Review & Approval Panel */}
            {selectedPlan && (
              <section className="rounded-lg border border-[#1B3B6F] bg-white overflow-hidden">
                {(() => {
                  const planTickets = tickets.filter((t) => t.workPlanId === selectedPlan.id);
                  const isPending = selectedPlan.status === 'pending_approval';
                  const proposedTotal = planTickets.reduce(
                    (s, t) => s + (isPending ? getTicketProposed(t) : t.approvedLiters),
                    0
                  );
                  const reductionTotal = Math.max(0, selectedPlan.totalRequestedLiters - proposedTotal);

                  return (
                    <>
                      <div className="flex flex-col gap-3 border-b border-[#D5DCE6] bg-[#F9FAFC] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A6F8C]">
                            <span className="font-mono font-bold text-[#1B3B6F]">
                              {selectedPlan.controlNumber}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-[#0B192C]">
                              {selectedPlan.department}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">
                              {selectedPlan.weekStart} to {selectedPlan.weekEnd}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="uppercase font-bold text-[#0B192C]">
                              {selectedPlan.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <h2 className="font-display text-base font-bold text-[#0B192C]">
                            {selectedPlan.projectTitle}
                          </h2>
                          <div className="text-xs text-[#5A6F8C]">
                            Prepared by: {selectedPlan.preparedBy} ({selectedPlan.preparedByDesignation || 'Staff'}) ·
                            Reviewed by: {selectedPlan.reviewedBy} ({selectedPlan.reviewedByDesignation || 'Reviewer'}) ·
                            Division Head: {selectedPlan.divisionHead}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <div className="text-[11px] text-[#5A6F8C]">Requested</div>
                            <div className="font-mono text-sm font-semibold tabular-nums text-[#0B192C]">
                              {selectedPlan.totalRequestedLiters.toFixed(1)} L
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-[#5A6F8C]">Approved</div>
                            <div className="font-mono text-sm font-bold tabular-nums text-[#1B3B6F]">
                              {proposedTotal.toFixed(1)} L
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] text-[#5A6F8C]">Reduction</div>
                            <div className="font-mono text-sm font-semibold tabular-nums text-amber-800">
                              -{reductionTotal.toFixed(1)} L
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedPlanId(null)}
                            aria-label="Collapse selected work plan"
                            className="rounded border border-[#D5DCE6] bg-white p-1.5 text-[#334E73] hover:bg-[#F3F5F8]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="divide-y divide-[#E6EBF2]">
                        {planTickets.map((t) => {
                          const proposed = isPending ? getTicketProposed(t) : t.approvedLiters;
                          const evalRes = evaluateTabletopApproval(t.requestedLiters, proposed);

                          return (
                            <div key={t.id} className="p-4 space-y-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="font-mono font-bold text-[#0B192C]">
                                      {t.ticketNumber}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono text-[#1B3B6F]">{t.plateNumber}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-[#334E73]">{t.vehicleLabel}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="uppercase font-mono text-[#5A6F8C]">
                                      {t.fuelType}
                                    </span>
                                  </div>
                                  <div className="text-xs text-[#334E73]">
                                    Purpose: <strong className="text-[#0B192C]">{t.purposeOrProject || t.projectTitle}</strong>
                                  </div>
                                  <div className="text-xs text-[#5A6F8C]">
                                    Driver: <strong className="text-[#0B192C]">{t.driverName}</strong> ·
                                    Destination: {t.destination} ({t.scheduledDate})
                                  </div>
                                  <div className="text-[11px] font-mono text-[#334E73]">
                                    Auto Limit: {t.computedLimitLiters.toFixed(1)} L · Requested:{' '}
                                    {t.requestedLiters.toFixed(1)} L
                                  </div>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                                  <div className="flex items-center gap-2">
                                    <label
                                      htmlFor={`slider-${t.id}`}
                                      className="text-[11px] font-semibold text-[#334E73] whitespace-nowrap"
                                    >
                                      Approve Liters:
                                    </label>
                                    <input
                                      id={`slider-${t.id}`}
                                      type="range"
                                      min={0}
                                      max={t.requestedLiters}
                                      step={0.5}
                                      disabled={!canApprove || !isPending}
                                      value={proposed}
                                      onChange={(e) =>
                                        setDraftAmounts((prev) => ({
                                          ...prev,
                                          [t.id]: Number(e.target.value),
                                        }))
                                      }
                                      className="w-28 accent-[#1B3B6F]"
                                    />
                                    <input
                                      type="number"
                                      min={0}
                                      max={t.requestedLiters}
                                      step={0.5}
                                      disabled={!canApprove || !isPending}
                                      aria-label={`Approved liters for ${t.ticketNumber}`}
                                      value={proposed}
                                      onChange={(e) =>
                                        setDraftAmounts((prev) => ({
                                          ...prev,
                                          [t.id]: Math.max(
                                            0,
                                            Math.min(t.requestedLiters, Number(e.target.value) || 0)
                                          ),
                                        }))
                                      }
                                      className="w-20 rounded border border-[#D5DCE6] px-2 py-1 text-right font-mono text-xs font-bold text-[#0B192C]"
                                    />
                                  </div>
                                  <span
                                    className={`text-xs font-mono font-semibold whitespace-nowrap ${
                                      evalRes.status === 'rejected'
                                        ? 'text-red-700'
                                        : evalRes.status === 'reduced'
                                          ? 'text-amber-800'
                                          : 'text-emerald-800'
                                    }`}
                                  >
                                    {evalRes.status === 'reduced'
                                      ? `-${evalRes.reductionLiters.toFixed(1)} L (-${evalRes.reductionPct}%)`
                                      : evalRes.status === 'rejected'
                                        ? 'Rejected (0 L)'
                                        : 'Full Approval'}
                                  </span>
                                </div>
                              </div>

                              {isPending && evalRes.reductionLiters > 0 && (
                                <input
                                  type="text"
                                  disabled={!canApprove}
                                  placeholder="Enter tabletop assessment reduction justification..."
                                  value={draftReasons[t.id] ?? ''}
                                  onChange={(e) =>
                                    setDraftReasons((prev) => ({ ...prev, [t.id]: e.target.value }))
                                  }
                                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-1.5 text-xs text-[#0B192C] placeholder:text-[#5A6F8C] focus:bg-white focus:outline-none"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isPending && (
                        <div className="flex flex-col gap-3 border-t border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                          <input
                            type="text"
                            disabled={!canApprove}
                            placeholder="Optional committee tabletop assessment remarks..."
                            value={planNotes[selectedPlan.id] ?? ''}
                            onChange={(e) =>
                              setPlanNotes((prev) => ({ ...prev, [selectedPlan.id]: e.target.value }))
                            }
                            className="flex-1 rounded-md border border-[#D5DCE6] bg-white px-3 py-2 text-xs text-[#0B192C]"
                          />
                          <button
                            type="button"
                            disabled={!canApprove || submittingId === selectedPlan.id}
                            onClick={() => handleApprovePlan(selectedPlan, planTickets)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <ClipboardCheck className="h-4 w-4" />
                            <span>
                              {submittingId === selectedPlan.id
                                ? 'Approving...'
                                : `Approve Work Plan (${proposedTotal.toFixed(1)} L)`}
                            </span>
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>
            )}
          </div>
        )}
      </RecordsPreviewGate>
    </div>
  );
}
