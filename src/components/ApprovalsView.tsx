import { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileCheck2,
  FolderCheck,
  ShieldAlert,
} from 'lucide-react';
import { FleetVehicle, ReportUtilitiesConfig, TripTicket, UserAccount, WorkPlan } from '../types/fuel';
import {
  ApprovalFolderKey,
  canPerformTabletopApproval,
  categorizeAndFilterApprovals,
  computeWorkPlanFuelTotals,
  evaluateTabletopApproval,
  formatDepartmentWithMnemonic,
  formatWorkPlanPreparedTimestamp,
  getActiveReportUtilityKeys,
  getDepartmentMnemonic,
  getDynamicProgressiveYearOptions,
  getLocalIsoDate,
  getVehicleClassificationLabel,
  getWorkPlanDisplayLabel,
  getWorkPlanVehicleClassifications,
  shouldDisplayWorkPlanSignOffs,
} from '../utils/fuelEngine';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface ApprovalsViewProps {
  workPlans: WorkPlan[];
  tickets: TripTicket[];
  vehicles: FleetVehicle[];
  currentUser: UserAccount;
  reportUtilities?: ReportUtilitiesConfig;
  onSubmitApproval: (
    workPlan: WorkPlan,
    adjustments: Array<{ ticket: TripTicket; proposedLiters: number; reason: string }>,
    approverNote: string
  ) => Promise<void>;
}

const APPROVALS_PREVIEW_COL_LABELS: Record<string, string> = {
  department: 'Dept',
  workPlanNo: 'WP No',
  datePrepared: 'Prepared',
  vehicleClassification: 'Veh Class',
  ticketCount: 'Tickets',
  totalDiesel: 'Diesel',
  totalGasoline: 'Gas',
};

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
  vehicles,
  currentUser,
  reportUtilities,
  onSubmitApproval,
}: ApprovalsViewProps) {
  const canApprove = canPerformTabletopApproval(currentUser.role);
  const activePreviewCols = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'approvals_preview'),
    [reportUtilities]
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [folderTab, setFolderTab] = useState<ApprovalFolderKey>('for_approval');
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

  const approvalFolders = useMemo(
    () =>
      categorizeAndFilterApprovals(workPlans, tickets, {
        department: departmentFilter,
        month: monthFilter,
        year: yearFilter,
      }),
    [workPlans, tickets, departmentFilter, monthFilter, yearFilter]
  );

  const filteredPlans = useMemo(() => {
    switch (folderTab) {
      case 'for_approval':
        return approvalFolders.forApproval;
      case 'partially_approved':
        return approvalFolders.partiallyApproved;
      case 'fully_approved':
        return approvalFolders.fullyApproved;
      case 'inactive':
        return approvalFolders.inactive;
    }
  }, [approvalFolders, folderTab]);

  const activeFolderLabel =
    folderTab === 'for_approval'
      ? 'For Approval'
      : folderTab === 'partially_approved'
        ? 'Partially Approved'
        : folderTab === 'fully_approved'
          ? 'Fully Approved'
          : 'Inactive Folder (>30d)';

  const selectedPlan = useMemo(
    () => filteredPlans.find((wp) => wp.id === selectedPlanId) ?? null,
    [filteredPlans, selectedPlanId]
  );

  useEscapeClose(Boolean(previewOpen && selectedPlan), () => setSelectedPlanId(null), 2);

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

      {/* Left: Filter Sequence (Department, Month, Year) | Right: 4 Approval Folders */}
      <div className="rounded-lg border border-[#D5DCE6] bg-white p-3">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div
            data-testid="approvals-filters"
            className="flex flex-wrap items-center gap-1.5 text-xs"
          >
            <select
              id="approvals-filter-department"
              aria-label="Filter by Department"
              value={departmentFilter}
              onChange={(e) => {
                setDepartmentFilter(e.target.value);
                setSelectedPlanId(null);
              }}
              className="max-w-[190px] rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1.5 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            >
              <option value="all">All Depts</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {formatDepartmentWithMnemonic(dept, vehicles)}
                </option>
              ))}
            </select>

            <select
              id="approvals-filter-month"
              aria-label="Filter by Month"
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setSelectedPlanId(null);
              }}
              className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1.5 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <select
              id="approvals-filter-year"
              aria-label="Filter by Year"
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setSelectedPlanId(null);
              }}
              className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1.5 font-mono text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            >
              <option value="all">All Years</option>
              {yearOptions.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div
            data-testid="approvals-folders"
            role="tablist"
            aria-label="Approval Status Folders"
            className="flex items-center gap-1 overflow-x-auto xl:justify-end"
          >
            {(
              [
                {
                  id: 'for_approval',
                  label: 'For Appr',
                  count: approvalFolders.forApproval.length,
                  Icon: Clock,
                },
                {
                  id: 'partially_approved',
                  label: 'Partial',
                  count: approvalFolders.partiallyApproved.length,
                  Icon: FileCheck2,
                },
                {
                  id: 'fully_approved',
                  label: 'Approved',
                  count: approvalFolders.fullyApproved.length,
                  Icon: FolderCheck,
                },
                {
                  id: 'inactive',
                  label: 'Inactive',
                  count: approvalFolders.inactive.length,
                  Icon: Archive,
                },
              ] as const
            ).map(({ id, label, count, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={folderTab === id}
                data-testid={`approval-folder-${id}`}
                onClick={() => {
                  setFolderTab(id);
                  setSelectedPlanId(null);
                }}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  folderTab === id
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span>
                  {label} ({count})
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview-Gated Tabular Summary Display */}
      <RecordsPreviewGate
        title={`Tabletop Approval — ${activeFolderLabel}`}
        description="Tap any row to inspect trip tickets, adjust approved liters, and approve."
        recordCount={filteredPlans.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Work Plans"
      >
        {filteredPlans.length === 0 ? (
          <div className="rounded-lg border border-[#D5DCE6] bg-white p-4 text-center space-y-1">
            <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-700" />
            <h2 className="font-display text-xs sm:text-sm font-bold text-[#0B192C]">
              No Work Plans in {activeFolderLabel}
            </h2>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Tabletop Summary Table with Date Prepared Timestamp & Vehicle Classification */}
            <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] sm:text-xs" data-testid="approvals-preview-table">
                  <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                    <tr>
                      {activePreviewCols.map((colKey) => (
                        <th
                          key={colKey}
                          data-col-key={colKey}
                          className="px-2 py-2 sm:px-2.5 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap"
                        >
                          {APPROVALS_PREVIEW_COL_LABELS[colKey] ?? colKey}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF2]">
                    {filteredPlans.map((plan) => {
                      const planTickets = tickets.filter((t) => t.workPlanId === plan.id);
                      const totals = computeWorkPlanFuelTotals(planTickets);
                      const preparedTimestamp = formatWorkPlanPreparedTimestamp(plan);
                      const classifications = getWorkPlanVehicleClassifications(planTickets, vehicles);
                      const planDisplayLabel = getWorkPlanDisplayLabel(plan);
                      const planTestKey = plan.controlNumber || plan.id;
                      const isSelected = selectedPlanId === plan.id;

                      return (
                        <tr
                          key={plan.id}
                          onClick={() => setSelectedPlanId(isSelected ? null : plan.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#EEF2F8]' : 'hover:bg-[#F9FAFC]'
                          }`}
                        >
                          {activePreviewCols.map((colKey) => {
                            switch (colKey) {
                              case 'department':
                                return (
                                  <td
                                    key={colKey}
                                    title={plan.department}
                                    className="px-2 py-2 sm:px-3 font-mono font-bold text-[#0B192C] whitespace-nowrap"
                                  >
                                    {getDepartmentMnemonic(plan.department, vehicles)}
                                  </td>
                                );
                              case 'workPlanNo':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 font-mono font-bold text-[#1B3B6F] whitespace-nowrap"
                                    data-testid={`approvals-row-wp-${planTestKey}`}
                                  >
                                    {planDisplayLabel}
                                  </td>
                                );
                              case 'datePrepared':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 font-mono text-[10px] sm:text-[11px] text-[#334E73] whitespace-nowrap"
                                    data-testid={`approvals-row-prepared-${planTestKey}`}
                                  >
                                    {preparedTimestamp}
                                  </td>
                                );
                              case 'vehicleClassification':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-[#0B192C]"
                                    data-testid={`approvals-row-classification-${planTestKey}`}
                                  >
                                    {classifications.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {classifications.map((cls) => (
                                          <span
                                            key={cls}
                                            className="inline-block rounded border border-[#D5DCE6] bg-[#F3F5F8] px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium text-[#1E3A5F]"
                                          >
                                            {cls}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[#5A6F8C]">Unclassified</span>
                                    )}
                                  </td>
                                );
                              case 'ticketCount':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums text-[#0B192C]"
                                  >
                                    {totals.ticketCount}
                                  </td>
                                );
                              case 'totalDiesel':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums font-semibold text-[#0B192C] whitespace-nowrap"
                                  >
                                    {totals.totalDiesel.toFixed(1)} L
                                  </td>
                                );
                              case 'totalGasoline':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums font-semibold text-[#1B3B6F] whitespace-nowrap"
                                  >
                                    {totals.totalGasoline.toFixed(1)} L
                                  </td>
                                );
                              default:
                                return null;
                            }
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected Work Plan Detailed Tabletop Review & Approval Panel (Mobile-Compact Floating Window) */}
            {selectedPlan && (
              <div
                className="fixed inset-0 z-[45] flex items-center justify-center bg-[#0B192C]/60 p-2 sm:p-4"
                role="dialog"
                aria-modal="true"
                aria-label={`Tabletop Review ${getWorkPlanDisplayLabel(selectedPlan)}`}
              >
                <section className="max-h-[88vh] w-full max-w-[96vw] sm:max-w-xl md:max-w-2xl overflow-y-auto rounded-lg border border-[#1B3B6F] bg-white shadow-2xl">
                {(() => {
                  const planTickets = tickets.filter((t) => t.workPlanId === selectedPlan.id);
                  const isPending = selectedPlan.status === 'pending_approval';
                  const proposedTotal = planTickets.reduce(
                    (s, t) => s + (isPending ? getTicketProposed(t) : t.approvedLiters),
                    0
                  );
                  const reductionTotal = Math.max(0, selectedPlan.totalRequestedLiters - proposedTotal);
                  const selectedDisplayLabel = getWorkPlanDisplayLabel(selectedPlan);

                  return (
                    <>
                      <div className="border-b border-[#D5DCE6] bg-[#F9FAFC] px-3 py-2.5 sm:px-4 sm:py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[#5A6F8C]">
                              <span
                                data-testid="approvals-review-workplan-label"
                                className="font-mono font-bold text-[#1B3B6F]"
                              >
                                {selectedDisplayLabel}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className="font-mono font-bold text-[#0B192C]"
                                title={selectedPlan.department}
                              >
                                {getDepartmentMnemonic(selectedPlan.department, vehicles)}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="uppercase font-bold text-[#0B192C] text-[10px]">
                                {selectedPlan.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <h2 className="mt-0.5 font-display text-xs sm:text-sm font-bold text-[#0B192C] truncate">
                              {selectedPlan.projectTitle}
                            </h2>
                            <div className="text-[10px] sm:text-[11px] text-[#5A6F8C]">
                              Prepared:{' '}
                              <span
                                data-testid="approvals-review-prepared-timestamp"
                                className="font-mono font-semibold text-[#1B3B6F]"
                              >
                                {formatWorkPlanPreparedTimestamp(selectedPlan)}
                              </span>
                              {shouldDisplayWorkPlanSignOffs(selectedPlan) && (
                                <span className="hidden sm:inline">
                                  {' '}· By: {selectedPlan.preparedBy}
                                </span>
                              )}{' '}
                              · Appr Date:{' '}
                              <span className="font-mono font-semibold text-[#1B3B6F]">{getLocalIsoDate()}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setSelectedPlanId(null)}
                            aria-label="Close selected work plan"
                            data-testid="approvals-review-close-btn"
                            className="inline-flex items-center justify-center rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
                          >
                            Close
                          </button>
                        </div>

                        {/* Compact Inline Totals Strip (Visible on Mobile & Desktop) */}
                        <div className="grid grid-cols-3 gap-1.5 rounded border border-[#E6EBF2] bg-white px-2 py-1 text-center">
                          <div>
                            <div className="text-[10px] text-[#5A6F8C]">Req</div>
                            <div className="font-mono text-xs font-semibold tabular-nums text-[#0B192C]">
                              {selectedPlan.totalRequestedLiters.toFixed(1)} L
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[#5A6F8C]">Appr</div>
                            <div className="font-mono text-xs font-bold tabular-nums text-[#1B3B6F]">
                              {proposedTotal.toFixed(1)} L
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[#5A6F8C]">Red</div>
                            <div className="font-mono text-xs font-semibold tabular-nums text-amber-800">
                              -{reductionTotal.toFixed(1)} L
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="divide-y divide-[#E6EBF2]">
                        {planTickets.map((t) => {
                          const proposed = isPending ? getTicketProposed(t) : t.approvedLiters;
                          const evalRes = evaluateTabletopApproval(t.requestedLiters, proposed);
                          const vehicleClassification = getVehicleClassificationLabel(vehicles, t);

                          return (
                            <div key={t.id} className="p-2.5 sm:p-3.5 space-y-2">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-mono font-bold text-[#0B192C]">
                                      {t.ticketNumber}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono font-semibold text-[#1B3B6F]">{t.plateNumber}</span>
                                    <span
                                      data-testid={`approvals-ticket-class-${t.ticketNumber}`}
                                      className="inline-block rounded border border-[#D5DCE6] bg-[#F3F5F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E3A5F]"
                                    >
                                      {vehicleClassification}
                                    </span>
                                    <span className="uppercase font-mono text-[10px] text-[#5A6F8C]">
                                      {t.fuelType === 'gasoline' ? 'GAS' : 'DSL'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-[#334E73] truncate">
                                    <strong className="text-[#0B192C]">{t.driverName}</strong> · {t.destination} ({t.scheduledDate})
                                  </div>
                                  <div className="text-[10px] font-mono text-[#5A6F8C]">
                                    Limit: {t.computedLimitLiters.toFixed(1)} L · Req: {t.requestedLiters.toFixed(1)} L
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                                  <div className="flex items-center gap-1.5">
                                    <label
                                      htmlFor={`slider-${t.id}`}
                                      className="text-[11px] font-semibold text-[#334E73] whitespace-nowrap"
                                    >
                                      Appr (L):
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
                                      className="w-20 sm:w-24 accent-[#1B3B6F]"
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
                                      className="w-16 rounded border border-[#D5DCE6] px-1.5 py-1 text-right font-mono text-xs font-bold text-[#0B192C]"
                                    />
                                  </div>
                                  <span
                                    className={`text-[11px] font-mono font-semibold whitespace-nowrap ${
                                      evalRes.status === 'rejected'
                                        ? 'text-red-700'
                                        : evalRes.status === 'reduced'
                                          ? 'text-amber-800'
                                          : 'text-emerald-800'
                                    }`}
                                  >
                                    {evalRes.status === 'reduced'
                                      ? `-${evalRes.reductionLiters.toFixed(1)} L`
                                      : evalRes.status === 'rejected'
                                        ? '0 L'
                                        : 'Full'}
                                  </span>
                                </div>
                              </div>

                              {isPending && evalRes.reductionLiters > 0 && (
                                <input
                                  type="text"
                                  disabled={!canApprove}
                                  placeholder="Reduction justification..."
                                  value={draftReasons[t.id] ?? ''}
                                  onChange={(e) =>
                                    setDraftReasons((prev) => ({ ...prev, [t.id]: e.target.value }))
                                  }
                                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs text-[#0B192C] placeholder:text-[#5A6F8C] focus:bg-white focus:outline-none"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isPending && (
                        <div className="flex flex-col gap-2 border-t border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                          <input
                            type="text"
                            disabled={!canApprove}
                            placeholder="Optional tabletop remarks..."
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
              </div>
            )}
          </div>
        )}
      </RecordsPreviewGate>
    </div>
  );
}
