import { useMemo, useState } from 'react';
import {
  Edit3,
  Eye,
  FolderKanban,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  BAIS_DEPARTMENTS,
  EQUIPMENT_CLASS_SPECS,
  FleetVehicle,
  FuelDepot,
  InventoryLog,
  PmcProject,
  TripTicket,
  UserAccount,
  WorkPlan,
} from '../types/fuel';
import {
  canManagePmcProjects,
  canUserDeleteRecords,
  canUserEditRecords,
  computePmcProjectFuelSummary,
  filterAndSummarizePmcProjects,
  getDepartmentMnemonic,
  normalizePmcProject,
  validatePmcProjectInput,
} from '../utils/fuelEngine';
import { useEscapeClose } from '../hooks/useEscapeClose';

interface PmcProjectRegistryViewProps {
  projects: PmcProject[];
  tickets?: TripTicket[];
  workPlans?: WorkPlan[];
  vehicles?: FleetVehicle[];
  inventoryLogs?: InventoryLog[];
  depots?: FuelDepot[];
  currentUser: UserAccount;
  onSaveProject: (
    data: Omit<PmcProject, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onDeleteProject: (project: PmcProject) => Promise<void>;
}

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPhpAmount(amount: number): string {
  return `₱${PHP_FORMATTER.format(Number.isFinite(amount) ? amount : 0)}`;
}

const STATUS_BADGE_STYLES: Record<TripTicket['status'], string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-blue-50 text-blue-800 border-blue-200',
  reduced: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  dispensed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  forfeited: 'bg-slate-100 text-slate-700 border-slate-300',
  rejected: 'bg-red-50 text-red-800 border-red-200',
};

export function PmcProjectRegistryView({
  projects,
  tickets = [],
  workPlans = [],
  vehicles = [],
  inventoryLogs = [],
  depots = [],
  currentUser,
  onSaveProject,
  onDeleteProject,
}: PmcProjectRegistryViewProps) {
  const canAccess = canManagePmcProjects(currentUser.role);
  const canCreate = canManagePmcProjects(currentUser.role);
  const canEdit = canUserEditRecords(currentUser);
  const canDelete = canUserDeleteRecords(currentUser);

  const [search, setSearch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedYear, setSelectedYear] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [reportProjectId, setReportProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [department, setDepartment] = useState<string>(BAIS_DEPARTMENTS[0]);
  const [approvalYear, setApprovalYear] = useState<string>(String(currentYear));
  const [projectName, setProjectName] = useState('');
  const [aipCode, setAipCode] = useState('');
  const [dieselFuelComponentPhp, setDieselFuelComponentPhp] = useState('');
  const [gasolineFuelComponentPhp, setGasolineFuelComponentPhp] = useState('');

  useEscapeClose(
    modalOpen,
    () => {
      setModalOpen(false);
      setFormError(null);
    },
    3
  );
  useEscapeClose(Boolean(reportProjectId), () => setReportProjectId(null), 4);

  const summary = useMemo(
    () =>
      filterAndSummarizePmcProjects(projects, {
        search,
        year: selectedYear,
        department: selectedDepartment,
      }),
    [projects, search, selectedYear, selectedDepartment]
  );

  const departmentFilterOptions = useMemo(() => {
    const merged = new Set<string>([...BAIS_DEPARTMENTS, ...summary.availableDepartments]);
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [summary.availableDepartments]);

  const projectLedgerById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computePmcProjectFuelSummary>>();
    for (const p of summary.items) {
      map.set(
        p.id,
        computePmcProjectFuelSummary({
          project: p,
          tickets,
          workPlans,
          vehicles,
          inventoryLogs,
          depots,
        })
      );
    }
    return map;
  }, [summary.items, tickets, workPlans, vehicles, inventoryLogs, depots]);

  const activeReportSummary = useMemo(() => {
    if (!reportProjectId) return null;
    const found = projects.find((p) => p.id === reportProjectId);
    if (!found) return null;
    return computePmcProjectFuelSummary({
      project: normalizePmcProject(found),
      tickets,
      workPlans,
      vehicles,
      inventoryLogs,
      depots,
    });
  }, [reportProjectId, projects, tickets, workPlans, vehicles, inventoryLogs, depots]);

  const liveFormTotalPhp = useMemo(() => {
    const d = Number(dieselFuelComponentPhp);
    const g = Number(gasolineFuelComponentPhp);
    const safeD = Number.isFinite(d) && d >= 0 ? d : 0;
    const safeG = Number.isFinite(g) && g >= 0 ? g : 0;
    return Math.round((safeD + safeG) * 100) / 100;
  }, [dieselFuelComponentPhp, gasolineFuelComponentPhp]);

  if (!canAccess) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-6 flex items-center gap-3 text-xs text-red-900">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <span>
          Access Denied: PMC Project Registry is restricted to PMC Staff and System Administrators.
        </span>
      </div>
    );
  }

  const openCreateModal = () => {
    setEditingId(undefined);
    setDepartment(selectedDepartment !== 'all' ? selectedDepartment : BAIS_DEPARTMENTS[0]);
    setApprovalYear(selectedYear || String(currentYear));
    setProjectName('');
    setAipCode('');
    setDieselFuelComponentPhp('');
    setGasolineFuelComponentPhp('0');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (project: PmcProject) => {
    const normalized = normalizePmcProject(project);
    setEditingId(normalized.id);
    setDepartment(normalized.department);
    setApprovalYear(String(normalized.approvalYear));
    setProjectName(normalized.projectName);
    setAipCode(normalized.aipCode);
    setDieselFuelComponentPhp(String(normalized.dieselFuelComponentPhp));
    setGasolineFuelComponentPhp(String(normalized.gasolineFuelComponentPhp));
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validatePmcProjectInput(
      {
        department,
        approvalYear: Number(approvalYear),
        projectName,
        aipCode,
        dieselFuelComponentPhp:
          dieselFuelComponentPhp.trim() === '' ? 0 : Number(dieselFuelComponentPhp),
        gasolineFuelComponentPhp:
          gasolineFuelComponentPhp.trim() === '' ? 0 : Number(gasolineFuelComponentPhp),
      },
      projects,
      editingId
    );

    if (!validation.valid || !validation.normalized) {
      setFormError(validation.error || 'Please complete all required project fields.');
      return;
    }

    setSubmitting(true);
    try {
      await onSaveProject(validation.normalized, editingId);
      setActionNotice(
        editingId
          ? `Updated PMC project "${validation.normalized.projectName}" (${validation.normalized.aipCode}).`
          : `Registered PMC project "${validation.normalized.projectName}" (${validation.normalized.aipCode}).`
      );
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save PMC project record.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 sm:gap-2.5">
        <div className="rounded-lg border border-[#D5DCE6] bg-white px-3 py-2 sm:px-4 sm:py-3">
          <div className="text-[11px] font-semibold text-[#5A6F8C]">Registered Projects</div>
          <div
            data-testid="pmc-summary-count"
            className="mt-0.5 font-mono text-base sm:text-lg font-bold tabular-nums text-[#0B192C]"
          >
            {summary.projectCount}
          </div>
        </div>
        <div className="rounded-lg border border-[#D5DCE6] bg-white px-3 py-2 sm:px-4 sm:py-3">
          <div className="text-[11px] font-semibold text-[#5A6F8C]">Diesel POW Cap</div>
          <div
            data-testid="pmc-summary-diesel-total"
            className="mt-0.5 font-mono text-base sm:text-lg font-bold tabular-nums text-[#0B192C]"
          >
            {formatPhpAmount(summary.totalDieselComponentPhp)}
          </div>
        </div>
        <div className="rounded-lg border border-[#D5DCE6] bg-white px-3 py-2 sm:px-4 sm:py-3">
          <div className="text-[11px] font-semibold text-[#5A6F8C]">Gasoline POW Cap</div>
          <div
            data-testid="pmc-summary-gasoline-total"
            className="mt-0.5 font-mono text-base sm:text-lg font-bold tabular-nums text-[#0B192C]"
          >
            {formatPhpAmount(summary.totalGasolineComponentPhp)}
          </div>
        </div>
        <div className="rounded-lg border border-[#D5DCE6] bg-white px-3 py-2 sm:px-4 sm:py-3">
          <div className="text-[11px] font-semibold text-[#5A6F8C]">
            Total Fuel Component (POW)
          </div>
          <div
            data-testid="pmc-summary-fuel-total"
            className="mt-0.5 font-mono text-base sm:text-lg font-bold tabular-nums text-[#1B3B6F]"
          >
            {formatPhpAmount(summary.totalFuelComponentPhp)}
          </div>
        </div>
      </div>

      {/* Filter (Department Office, Year, Search) & Registration Toolbar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between rounded-lg border border-[#D5DCE6] bg-white p-2.5 sm:p-3">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search project name, AIP code, or office..."
              aria-label="Search PMC project registry"
              data-testid="pmc-search-input"
              className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] py-1.5 pl-9 pr-3 text-xs sm:text-sm text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="pmc-department-filter"
                className="text-xs font-semibold text-[#334E73] whitespace-nowrap"
              >
                Office
              </label>
              <select
                id="pmc-department-filter"
                data-testid="pmc-department-filter"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="max-w-[210px] rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs font-medium text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
              >
                <option value="all">All Department Offices</option>
                {departmentFilterOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label
                htmlFor="pmc-year-filter"
                className="text-xs font-semibold text-[#334E73] whitespace-nowrap"
              >
                Year
              </label>
              <select
                id="pmc-year-filter"
                data-testid="pmc-year-filter"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs font-medium text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
              >
                <option value="">All Years</option>
                {summary.availableYears.map((yr) => (
                  <option key={yr} value={String(yr)}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            {canCreate && (
              <button
                type="button"
                onClick={openCreateModal}
                className="lg:hidden inline-flex items-center justify-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Register</span>
              </button>
            )}
          </div>
        </div>

        {canCreate && (
          <button
            type="button"
            data-testid="new-pmc-project-btn"
            onClick={openCreateModal}
            className="hidden lg:inline-flex items-center justify-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Register Project</span>
          </button>
        )}
      </div>

      {actionNotice && (
        <div
          role="status"
          data-testid="pmc-action-notice"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-900"
        >
          {actionNotice}
        </div>
      )}

      {/* PMC Project Registry Table */}
      <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] sm:text-xs" data-testid="pmc-projects-table">
            <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
              <tr>
                <th className="px-2 py-2 sm:px-2.5 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide whitespace-nowrap">
                  <span className="sm:hidden">Yr</span>
                  <span className="hidden sm:inline">Year</span>
                </th>
                <th className="hidden md:table-cell px-2.5 py-2 text-center align-middle text-[11px] font-bold tracking-wide whitespace-nowrap">
                  Office
                </th>
                <th className="px-2 py-2 sm:px-2.5 text-left align-middle text-[10px] sm:text-[11px] font-bold tracking-wide">
                  <span className="sm:hidden">Project / AIP</span>
                  <span className="hidden sm:inline">Name of Project</span>
                </th>
                <th className="hidden sm:table-cell px-2.5 py-2 text-center align-middle text-[11px] font-bold tracking-wide whitespace-nowrap">
                  AIP Code
                </th>
                <th className="hidden lg:table-cell px-2.5 py-2 text-right align-middle text-[11px] font-bold tracking-wide whitespace-nowrap">
                  Diesel Cap / Bal
                </th>
                <th className="hidden lg:table-cell px-2.5 py-2 text-right align-middle text-[11px] font-bold tracking-wide whitespace-nowrap">
                  Gasoline Cap / Bal
                </th>
                <th className="px-2 py-2 sm:px-2.5 text-right align-middle text-[10px] sm:text-[11px] font-bold tracking-wide whitespace-nowrap">
                  <span className="sm:hidden">POW / Bal</span>
                  <span className="hidden sm:inline">Total POW / Bal</span>
                </th>
                <th className="px-2 py-2 sm:px-2.5 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide whitespace-nowrap">
                  <span className="sm:hidden">Act</span>
                  <span className="hidden sm:inline">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6EBF2]">
              {summary.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#5A6F8C]">
                    <FolderKanban className="mx-auto mb-2 h-6 w-6 text-[#94A3B8]" />
                    <div className="font-semibold text-[#0B192C]">
                      No PMC projects match your filter.
                    </div>
                    <p className="mt-0.5 text-[11px]">
                      Register an approved project with its Department Office, AIP Code, and Diesel/Gasoline fuel allocation.
                    </p>
                  </td>
                </tr>
              ) : (
                summary.items.map((project) => {
                  const ledger = projectLedgerById.get(project.id);
                  const deptMnemonic = getDepartmentMnemonic(project.department, vehicles);
                  return (
                    <tr
                      key={project.id}
                      data-testid={`pmc-project-row-${project.aipCode}`}
                      className="hover:bg-[#F9FAFC]"
                    >
                      <td className="px-2 py-2 sm:px-2.5 sm:py-2.5 text-center font-mono font-bold tabular-nums text-[#0B192C] whitespace-nowrap align-top sm:align-middle">
                        {project.approvalYear}
                      </td>
                      <td className="hidden md:table-cell px-2.5 py-2.5 text-center align-middle whitespace-nowrap">
                        <span
                          title={project.department}
                          className="inline-block rounded border border-[#D5DCE6] bg-[#F3F5F8] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#1B3B6F]"
                        >
                          {deptMnemonic}
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-2.5 sm:py-2.5 align-top sm:align-middle">
                        <button
                          type="button"
                          onClick={() => setReportProjectId(project.id)}
                          className="text-left font-semibold text-[#0B192C] hover:text-[#1B3B6F] hover:underline leading-snug"
                        >
                          {project.projectName}
                        </button>
                        <div className="sm:hidden mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                          <span className="font-bold text-[#1B3B6F]">{project.aipCode}</span>
                          <span className="text-[#5A6F8C]">· {deptMnemonic}</span>
                        </div>
                        <div className="lg:hidden mt-0.5 font-mono text-[10px] text-[#5A6F8C]">
                          Dsl: {formatPhpAmount(project.dieselFuelComponentPhp)} · Gas:{' '}
                          {formatPhpAmount(project.gasolineFuelComponentPhp)}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-2.5 py-2.5 text-center font-mono font-bold text-[#1B3B6F] whitespace-nowrap">
                        {project.aipCode}
                      </td>
                      <td className="hidden lg:table-cell px-2.5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-[#0B192C]">
                          {formatPhpAmount(project.dieselFuelComponentPhp)}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-700">
                          Bal: {formatPhpAmount(ledger?.diesel.runningBalancePhp ?? project.dieselFuelComponentPhp)}
                        </div>
                      </td>
                      <td className="hidden lg:table-cell px-2.5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-[#0B192C]">
                          {formatPhpAmount(project.gasolineFuelComponentPhp)}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-700">
                          Bal: {formatPhpAmount(ledger?.gasoline.runningBalancePhp ?? project.gasolineFuelComponentPhp)}
                        </div>
                      </td>
                      <td className="px-2 py-2 sm:px-2.5 sm:py-2.5 text-right font-mono tabular-nums whitespace-nowrap align-top sm:align-middle">
                        <div className="font-bold text-[#0B192C]">
                          {formatPhpAmount(project.fuelComponentAmountPhp)}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-700">
                          Bal: {formatPhpAmount(ledger?.totalRunningBalancePhp ?? project.fuelComponentAmountPhp)}
                        </div>
                      </td>
                      <td className="px-1.5 py-2 sm:px-2.5 sm:py-2.5 text-center whitespace-nowrap align-top sm:align-middle">
                        <button
                          type="button"
                          onClick={() => setReportProjectId(project.id)}
                          aria-label={`Full report for ${project.projectName}`}
                          data-testid={`pmc-report-btn-${project.aipCode}`}
                          title="Full Project Monitoring Report"
                          className="mr-1 inline-flex items-center gap-1 rounded border border-[#1B3B6F] bg-[#EEF2F8] px-1.5 py-1 text-[10px] font-semibold text-[#1B3B6F] hover:bg-[#1B3B6F] hover:text-white transition-colors"
                        >
                          <Eye className="h-3 w-3" />
                          <span className="hidden sm:inline">Report</span>
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEditModal(project)}
                            aria-label={`Edit ${project.projectName}`}
                            data-testid={`pmc-edit-btn-${project.aipCode}`}
                            className="mr-1 rounded border border-[#D5DCE6] p-1 text-[#334E73] hover:bg-[#F3F5F8]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              void onDeleteProject(project);
                              setActionNotice(
                                `Deleted PMC project "${project.projectName}" (${project.aipCode}).`
                              );
                            }}
                            aria-label={`Delete ${project.projectName}`}
                            data-testid={`pmc-delete-btn-${project.aipCode}`}
                            className="rounded border border-[#D5DCE6] p-1 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Project Monitoring Report Preview Modal */}
      {activeReportSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/75 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Full Project Monitoring Report Preview"
          data-testid="pmc-full-report-modal"
        >
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-[#D5DCE6] bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-[#0B192C] px-4 py-3.5 sm:px-5 text-white">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
                  <span className="font-bold text-white">{activeReportSummary.project.aipCode}</span>
                  <span>·</span>
                  <span>FY {activeReportSummary.project.approvalYear}</span>
                  <span>·</span>
                  <span>{activeReportSummary.project.department}</span>
                </div>
                <h2 className="mt-0.5 font-display text-sm sm:text-base font-bold leading-snug">
                  {activeReportSummary.project.projectName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setReportProjectId(null)}
                aria-label="Close full project report"
                data-testid="pmc-report-close-btn"
                className="inline-flex items-center justify-center rounded-md bg-[#334E73] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-5 text-xs">
              {/* Fuel Class Cap & Running Balance Breakdown */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {(['diesel', 'gasoline'] as const).map((fuelClass) => {
                  const ledger =
                    fuelClass === 'diesel'
                      ? activeReportSummary.diesel
                      : activeReportSummary.gasoline;
                  const title = fuelClass === 'diesel' ? 'Diesel Fuel Component' : 'Gasoline Fuel Component';
                  return (
                    <div
                      key={fuelClass}
                      data-testid={`pmc-report-${fuelClass}-card`}
                      className="rounded-lg border border-[#D5DCE6] bg-[#F9FAFC] p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-[#E6EBF2] pb-2">
                        <span className="font-display text-xs font-bold uppercase tracking-wide text-[#0B192C]">
                          {title}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-[#1B3B6F]">
                          Current WAC: ₱{ledger.currentPrevailingWacPhp.toFixed(2)}/L
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <div className="text-[10px] font-semibold text-[#5A6F8C]">POW Fuel Cap</div>
                          <div
                            data-testid={`pmc-report-${fuelClass}-cap`}
                            className="font-mono text-sm font-bold tabular-nums text-[#0B192C]"
                          >
                            {formatPhpAmount(ledger.capPhp)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-[#5A6F8C]">
                            Actual Dispensed (× WAC)
                          </div>
                          <div
                            data-testid={`pmc-report-${fuelClass}-dispensed-cost`}
                            className={`font-mono text-sm font-bold tabular-nums ${
                              ledger.actualDispensedCostPhp > 0 ? 'text-red-700' : 'text-[#5A6F8C]'
                            }`}
                          >
                            {ledger.actualDispensedCostPhp > 0
                              ? `-${formatPhpAmount(ledger.actualDispensedCostPhp)}`
                              : formatPhpAmount(0)}
                          </div>
                        </div>
                        <div className="col-span-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 flex items-center justify-between">
                          <span className="text-[11px] font-bold text-emerald-900">
                            Running Balance (Cap − Actual Dispensed)
                          </span>
                          <span
                            data-testid={`pmc-report-${fuelClass}-running-balance`}
                            className="font-mono text-sm font-bold tabular-nums text-emerald-800"
                          >
                            {formatPhpAmount(ledger.runningBalancePhp)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#E6EBF2] font-mono text-[11px]">
                        <div>
                          <span className="block text-[10px] font-sans text-[#5A6F8C]">Requested</span>
                          <strong className="text-[#0B192C]">{ledger.requestedLiters.toFixed(1)} L</strong>
                        </div>
                        <div>
                          <span className="block text-[10px] font-sans text-[#5A6F8C]">Approved</span>
                          <strong className="text-[#1B3B6F]">{ledger.approvedLiters.toFixed(1)} L</strong>
                        </div>
                        <div>
                          <span className="block text-[10px] font-sans text-[#5A6F8C]">Dispensed</span>
                          <strong className="text-emerald-700">{ledger.dispensedLiters.toFixed(1)} L</strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detailed List of Fuel Requests */}
              <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE6] bg-[#F8FAFC] px-3.5 py-2.5">
                  <div>
                    <h3 className="font-display text-xs font-bold text-[#0B192C]">
                      Detailed Fuel Requests for Project ({activeReportSummary.requestRows.length})
                    </h3>
                    <p className="text-[10px] text-[#5A6F8C]">
                      Running balance per fuel class is reduced by actual dispensed liters multiplied by the prevailing weighted average cost at actual dispensing timestamp.
                    </p>
                  </div>
                  <div className="font-mono text-[11px] font-bold text-[#1B3B6F]">
                    Total Running Balance: {formatPhpAmount(activeReportSummary.totalRunningBalancePhp)}
                  </div>
                </div>

                {activeReportSummary.requestRows.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#5A6F8C]">
                    No trip ticket fuel requests have referenced this project yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table
                      data-testid="pmc-report-requests-table"
                      className="w-full text-left text-[11px]"
                    >
                      <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                        <tr>
                          <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Ticket #</th>
                          <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Work Plan</th>
                          <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Date / Dispensed</th>
                          <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Unit / Equipment Class</th>
                          <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Fuel</th>
                          <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Status</th>
                          <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Req (L)</th>
                          <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Appr (L)</th>
                          <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Disp (L)</th>
                          <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Prevailing WAC</th>
                          <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Dispensed Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EBF2]">
                        {activeReportSummary.requestRows.map((row) => (
                          <tr key={row.ticket.id} className="hover:bg-[#F9FAFC]">
                            <td className="px-2 py-2 text-center font-mono font-bold text-[#0B192C] whitespace-nowrap">
                              {row.ticket.ticketNumber}
                            </td>
                            <td className="px-2 py-2 text-center font-mono text-[#1B3B6F] whitespace-nowrap">
                              {row.workPlanNumber}
                            </td>
                            <td className="px-2 py-2 text-center font-mono text-[10px] text-[#5A6F8C] whitespace-nowrap">
                              <div>{row.ticket.scheduledDate}</div>
                              {row.ticket.dispensedAt && (
                                <div className="text-emerald-700">
                                  Disp: {row.ticket.dispensedAt.slice(0, 10)} {row.ticket.dispensedAt.slice(11, 16)}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <div className="font-mono font-bold text-[#0B192C]">
                                {row.ticket.plateNumber}
                              </div>
                              <div className="text-[10px] text-[#5A6F8C]">
                                {row.equipmentClass
                                  ? EQUIPMENT_CLASS_SPECS[row.equipmentClass].label
                                  : row.ticket.vehicleLabel || '—'}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center font-mono text-[10px] font-bold uppercase text-[#1B3B6F]">
                              {row.ticket.fuelType}
                            </td>
                            <td className="px-2 py-2 text-center whitespace-nowrap">
                              <span
                                className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold capitalize ${STATUS_BADGE_STYLES[row.ticket.status]}`}
                              >
                                {row.ticket.status}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[#0B192C] whitespace-nowrap">
                              {row.ticket.requestedLiters.toFixed(1)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[#1B3B6F] whitespace-nowrap">
                              {row.ticket.approvedLiters.toFixed(1)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-emerald-700 whitespace-nowrap">
                              {row.ticket.dispensedLiters.toFixed(1)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                              ₱{row.prevailingWacPhp.toFixed(2)}/L
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-[#0B192C] whitespace-nowrap">
                              {row.dispensedCostPhp > 0 ? formatPhpAmount(row.dispensedCostPhp) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-[#CBD5E1] bg-[#F8FAFC] font-mono font-bold text-[#0B192C]">
                        <tr>
                          <td colSpan={6} className="px-2 py-2 text-right font-sans text-[11px]">
                            TOTALS
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {(
                              activeReportSummary.diesel.requestedLiters +
                              activeReportSummary.gasoline.requestedLiters
                            ).toFixed(1)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-[#1B3B6F]">
                            {(
                              activeReportSummary.diesel.approvedLiters +
                              activeReportSummary.gasoline.approvedLiters
                            ).toFixed(1)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-emerald-700">
                            {(
                              activeReportSummary.diesel.dispensedLiters +
                              activeReportSummary.gasoline.dispensedLiters
                            ).toFixed(1)}
                          </td>
                          <td className="px-2 py-2 text-right text-[#5A6F8C]">—</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatPhpAmount(activeReportSummary.totalActualDispensedCostPhp)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Register / Edit PMC Project Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="PMC Project Registry Form"
          data-testid="pmc-project-modal"
        >
          <form
            onSubmit={handleSubmit}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[#D5DCE6] bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 bg-[#0B192C] px-5 py-3.5 text-white">
              <div>
                <h2 className="font-display text-base font-bold">
                  {editingId ? 'Edit PMC Project' : 'Register PMC Project'}
                </h2>
                <p className="text-[11px] text-slate-300">
                  Record concerned department, approval year, AIP Code, and Diesel &amp; Gasoline POW fuel caps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setFormError(null);
                }}
                aria-label="Close PMC project dialog"
                data-testid="pmc-project-modal-close-btn"
                className="inline-flex items-center justify-center rounded-md bg-[#334E73] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              {formError && (
                <div
                  role="alert"
                  data-testid="pmc-project-form-error"
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-2 font-medium text-red-900"
                >
                  {formError}
                </div>
              )}

              <div>
                <label
                  htmlFor="pmc-department-select"
                  className="block font-semibold text-[#334E73] mb-1"
                >
                  Department Office *
                </label>
                <select
                  id="pmc-department-select"
                  data-testid="pmc-department-select"
                  required
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] bg-white px-2.5 py-2 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                >
                  {departmentFilterOptions.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="pmc-approval-year-input"
                    className="block font-semibold text-[#334E73] mb-1"
                  >
                    Year of Project Approval *
                  </label>
                  <input
                    id="pmc-approval-year-input"
                    data-testid="pmc-approval-year-input"
                    type="number"
                    required
                    min={2000}
                    max={2100}
                    step={1}
                    value={approvalYear}
                    onChange={(e) => setApprovalYear(e.target.value)}
                    placeholder="e.g. 2026"
                    className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pmc-aip-code-input"
                    className="block font-semibold text-[#334E73] mb-1"
                  >
                    AIP Code *
                  </label>
                  <input
                    id="pmc-aip-code-input"
                    data-testid="pmc-aip-code-input"
                    type="text"
                    required
                    minLength={2}
                    maxLength={64}
                    value={aipCode}
                    onChange={(e) => setAipCode(e.target.value.toUpperCase())}
                    placeholder="e.g. INFRA-2026-045"
                    className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono text-xs uppercase text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="pmc-project-name-input"
                  className="block font-semibold text-[#334E73] mb-1"
                >
                  Name of Project *
                </label>
                <input
                  id="pmc-project-name-input"
                  data-testid="pmc-project-name-input"
                  type="text"
                  required
                  minLength={3}
                  maxLength={200}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter official project title from Program of Work"
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="pmc-diesel-amount-input"
                    className="block font-semibold text-[#334E73] mb-1"
                  >
                    Diesel Fuel Component (PHP) *
                  </label>
                  <input
                    id="pmc-diesel-amount-input"
                    data-testid="pmc-diesel-amount-input"
                    type="number"
                    required
                    min={0}
                    max={1000000000}
                    step="0.01"
                    value={dieselFuelComponentPhp}
                    onChange={(e) => setDieselFuelComponentPhp(e.target.value)}
                    placeholder="e.g. 300000.00"
                    className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pmc-gasoline-amount-input"
                    className="block font-semibold text-[#334E73] mb-1"
                  >
                    Gasoline Fuel Component (PHP) *
                  </label>
                  <input
                    id="pmc-gasoline-amount-input"
                    data-testid="pmc-gasoline-amount-input"
                    type="number"
                    required
                    min={0}
                    max={1000000000}
                    step="0.01"
                    value={gasolineFuelComponentPhp}
                    onChange={(e) => setGasolineFuelComponentPhp(e.target.value)}
                    placeholder="e.g. 50000.00"
                    className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-md border border-[#C5D1E3] bg-[#EEF2F8] px-3 py-2 flex items-center justify-between">
                <span className="font-semibold text-[#334E73]">
                  Total Fuel Component of Program of Work
                </span>
                <span
                  data-testid="pmc-total-fuel-preview"
                  className="font-mono text-sm font-bold tabular-nums text-[#0B192C]"
                >
                  {formatPhpAmount(liveFormTotalPhp)}
                </span>
              </div>

              <div className="flex justify-end gap-2 border-t border-[#E6EBF2] pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalOpen(false);
                    setFormError(null);
                  }}
                  className="rounded-md border border-[#D5DCE6] px-3.5 py-2 text-xs font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="pmc-project-submit-btn"
                  className="rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingId ? 'Update Project' : 'Save Project'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
