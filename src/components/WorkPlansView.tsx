import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileDown,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  BAIS_DEPARTMENTS,
  EQUIPMENT_CLASS_SPECS,
  EquipmentClass,
  FleetVehicle,
  FuelDepot,
  FuelType,
  TripTicket,
  UserAccount,
  WorkPlan,
} from '../types/fuel';
import {
  canPreviewAndDownloadPdf,
  canUserDeleteRecords,
  canUserEditRecords,
  categorizeDepartmentWorkPlans,
  evaluateRequestedLitersAgainstVehicle,
  filterVehiclesForTicket,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getMissingTicketMandatoryFields,
  MAX_TICKETS_PER_WORKPLAN,
} from '../utils/fuelEngine';
import { generateWorkPlanPdf } from '../utils/pdfGenerator';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface WorkPlansViewProps {
  workPlans: WorkPlan[];
  allWorkPlans: WorkPlan[];
  tickets: TripTicket[];
  allTickets: TripTicket[];
  vehicles: FleetVehicle[];
  depots: FuelDepot[];
  currentUser: UserAccount;
  isModalOpen: boolean;
  onOpenModal: () => void;
  onCloseModal: () => void;
  onCreateWorkPlan: (
    plan: Omit<
      WorkPlan,
      | 'id'
      | 'controlNumber'
      | 'status'
      | 'totalRequestedLiters'
      | 'totalApprovedLiters'
      | 'totalDispensedLiters'
      | 'ownerId'
      | 'createdAt'
      | 'updatedAt'
    > & { controlNumber?: string },
    tickets: Array<
      Omit<
        TripTicket,
        | 'id'
        | 'workPlanId'
        | 'ticketNumber'
        | 'department'
        | 'projectTitle'
        | 'approvedLiters'
        | 'dispensedLiters'
        | 'forfeitedLiters'
        | 'servedOnce'
        | 'status'
        | 'ownerId'
        | 'createdAt'
        | 'updatedAt'
      >
    >
  ) => Promise<{ workPlan: WorkPlan; tickets: TripTicket[] }>;
  onPreviewPdf: (workPlan: WorkPlan, planTickets: TripTicket[]) => void;
  onUpdateWorkPlanAdmin: (workPlanId: string, updates: Partial<WorkPlan>) => Promise<void>;
  onDeleteWorkPlan: (workPlan: WorkPlan) => Promise<void>;
}

interface TicketDraftRow {
  key: string;
  vehicleId: string;
  vehicleSearch: string;
  vehicleOfficeFilter: string;
  vehicleClassFilter: EquipmentClass | 'all';
  vehicleFuelFilter: FuelType | 'all';
  driverName: string;
  driverLicense: string;
  purposeOrProject: string;
  depotId: string;
  scheduledDate: string;
  destination: string;
  estimatedUsage: number;
  terrainFactor: number;
  requestedLiters: number;
}

export function WorkPlansView({
  workPlans,
  allWorkPlans,
  tickets,
  allTickets,
  vehicles,
  depots,
  currentUser,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  onCreateWorkPlan,
  onPreviewPdf,
  onUpdateWorkPlanAdmin,
  onDeleteWorkPlan,
}: WorkPlansViewProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved'>('all');
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(
    workPlans[0]?.id ?? null
  );
  const [editingPlan, setEditingPlan] = useState<WorkPlan | null>(null);
  const [editProjectTitle, setEditProjectTitle] = useState('');
  const [editDivisionHead, setEditDivisionHead] = useState('');
  const [editUnitLead, setEditUnitLead] = useState('');
  const [editSectionManager, setEditSectionManager] = useState('');

  // New Work Plan Form State
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);

  const preAssignedControlNumber = useMemo(
    () => generateNextWorkPlanNumber(allWorkPlans),
    [allWorkPlans]
  );

  const [department, setDepartment] = useState<string>(
    currentUser.department || BAIS_DEPARTMENTS[0]
  );
  const [projectTitle, setProjectTitle] = useState('');
  const [projectCode, setProjectCode] = useState('INFRA-2026-');
  const [weekStart, setWeekStart] = useState(today);
  const [weekEnd, setWeekEnd] = useState(nextWeek);

  // Mandatory Hierarchical Sign-offs with Designations
  const [preparedBy, setPreparedBy] = useState(currentUser.displayName);
  const [preparedByDesignation, setPreparedByDesignation] = useState(
    currentUser.positionTitle || 'Focal Person'
  );
  const [reviewedBy, setReviewedBy] = useState('');
  const [reviewedByDesignation, setReviewedByDesignation] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedByDesignation, setApprovedByDesignation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [validatedTicketKeys, setValidatedTicketKeys] = useState<Record<string, boolean>>({});
  const [addTicketWarning, setAddTicketWarning] = useState<string | null>(null);
  const floatingAddBtnRef = useRef<HTMLDivElement>(null);
  const ticketCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const defaultVehicle = vehicles[0];
  const defaultDepot = depots[0];

  const vehicleOfficeOptions = useMemo(() => {
    return Array.from(new Set(vehicles.map((v) => v.office))).sort((a, b) => a.localeCompare(b));
  }, [vehicles]);

  const [ticketDrafts, setTicketDrafts] = useState<TicketDraftRow[]>(() => [
    {
      key: 'row_1',
      vehicleId: defaultVehicle?.id ?? '',
      vehicleSearch: '',
      vehicleOfficeFilter: 'all',
      vehicleClassFilter: 'all',
      vehicleFuelFilter: 'all',
      driverName: '',
      driverLicense: '',
      purposeOrProject: '',
      depotId: defaultDepot?.id ?? '',
      scheduledDate: today,
      destination: '',
      estimatedUsage: 120,
      terrainFactor: 1.0,
      requestedLiters: 30,
    },
  ]);

  // Distinct 7-digit sequential Trip Ticket numbers pre-generated for the draft rows
  const preAssignedTicketNumbers = useMemo(
    () => generateNextTripTicketNumbers(allTickets, ticketDrafts.length),
    [allTickets, ticketDrafts.length]
  );

  const allExistingTicketsComplete = useMemo(
    () => ticketDrafts.every((t) => getMissingTicketMandatoryFields(t).length === 0),
    [ticketDrafts]
  );

  const canEdit = canUserEditRecords(currentUser);
  const canDelete = canUserDeleteRecords(currentUser);
  const canPdf = canPreviewAndDownloadPdf(currentUser.role);

  const searchMatchedPlans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return workPlans.filter((wp) => {
      if (!q) return true;
      return (
        wp.controlNumber.toLowerCase().includes(q) ||
        wp.projectTitle.toLowerCase().includes(q) ||
        wp.department.toLowerCase().includes(q) ||
        wp.projectCode.toLowerCase().includes(q)
      );
    });
  }, [workPlans, searchQuery]);

  const categorizedPlans = useMemo(
    () => categorizeDepartmentWorkPlans(searchMatchedPlans, tickets),
    [searchMatchedPlans, tickets]
  );

  const visibleCategoryCount =
    statusFilter === 'pending'
      ? categorizedPlans.pending.length
      : statusFilter === 'approved'
        ? categorizedPlans.approved.length
        : categorizedPlans.pending.length + categorizedPlans.approved.length;

  const handleVehiclePick = (index: number, vehicleId: string) => {
    const veh = vehicles.find((v) => v.id === vehicleId);
    setTicketDrafts((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        if (!veh) return { ...row, vehicleId };
        const calc = evaluateRequestedLitersAgainstVehicle(
          veh,
          row.estimatedUsage,
          row.requestedLiters,
          row.terrainFactor
        );
        return {
          ...row,
          vehicleId,
          requestedLiters: calc.computedLimitLiters || 20,
        };
      })
    );
  };

  const handleUsageOrTerrainChange = (
    index: number,
    estimatedUsage: number,
    terrainFactor: number
  ) => {
    setTicketDrafts((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        const veh = vehicles.find((v) => v.id === row.vehicleId);
        if (!veh) return { ...row, estimatedUsage, terrainFactor };
        const calc = evaluateRequestedLitersAgainstVehicle(
          veh,
          estimatedUsage,
          row.requestedLiters,
          terrainFactor
        );
        return {
          ...row,
          estimatedUsage,
          terrainFactor,
          requestedLiters: calc.effectiveCapLiters || row.requestedLiters,
        };
      })
    );
  };

  const updateTicketVehicleFilter = (
    index: number,
    patch: Partial<
      Pick<
        TicketDraftRow,
        'vehicleSearch' | 'vehicleOfficeFilter' | 'vehicleClassFilter' | 'vehicleFuelFilter'
      >
    >
  ) => {
    setTicketDrafts((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        const nextRow = { ...row, ...patch };
        const matching = filterVehiclesForTicket(vehicles, {
          search: nextRow.vehicleSearch,
          office: nextRow.vehicleOfficeFilter,
          equipmentClass: nextRow.vehicleClassFilter,
          fuelType: nextRow.vehicleFuelFilter,
        });
        const stillMatches = matching.some((v) => v.id === nextRow.vehicleId);
        if (stillMatches) return nextRow;
        const fallbackVeh = matching[0];
        if (!fallbackVeh) {
          return { ...nextRow, vehicleId: '' };
        }
        const calc = evaluateRequestedLitersAgainstVehicle(
          fallbackVeh,
          nextRow.estimatedUsage,
          nextRow.requestedLiters,
          nextRow.terrainFactor
        );
        return {
          ...nextRow,
          vehicleId: fallbackVeh.id,
          requestedLiters: calc.computedLimitLiters || 20,
        };
      })
    );
  };

  const addTicketRow = () => {
    if (ticketDrafts.length >= MAX_TICKETS_PER_WORKPLAN) return;

    const incompleteKeys: Record<string, boolean> = {};
    let firstIncompleteIdx = -1;
    ticketDrafts.forEach((draft, idx) => {
      if (getMissingTicketMandatoryFields(draft).length > 0) {
        incompleteKeys[draft.key] = true;
        if (firstIncompleteIdx === -1) {
          firstIncompleteIdx = idx;
        }
      }
    });

    if (firstIncompleteIdx !== -1) {
      setValidatedTicketKeys((prev) => ({ ...prev, ...incompleteKeys }));
      setAddTicketWarning(
        `Complete all mandatory (*) fields in Ticket #${firstIncompleteIdx + 1} before adding another trip ticket.`
      );
      const targetKey = ticketDrafts[firstIncompleteIdx].key;
      requestAnimationFrame(() => {
        ticketCardRefs.current[targetKey]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
      return;
    }

    setAddTicketWarning(null);
    setValidatedTicketKeys({});
    const veh = vehicles[0];
    setTicketDrafts((prev) => [
      ...prev,
      {
        key: `row_${Date.now()}_${prev.length + 1}`,
        vehicleId: veh?.id ?? '',
        vehicleSearch: '',
        vehicleOfficeFilter: 'all',
        vehicleClassFilter: 'all',
        vehicleFuelFilter: 'all',
        driverName: '',
        driverLicense: '',
        purposeOrProject: '',
        depotId: depots[0]?.id ?? '',
        scheduledDate: weekStart,
        destination: '',
        estimatedUsage: 80,
        terrainFactor: 1.0,
        requestedLiters: 25,
      },
    ]);
    requestAnimationFrame(() => {
      floatingAddBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const removeTicketRow = (index: number) => {
    const removedKey = ticketDrafts[index]?.key;
    setTicketDrafts((prev) => prev.filter((_, idx) => idx !== index));
    if (removedKey) {
      setValidatedTicketKeys((prev) => {
        const next = { ...prev };
        delete next[removedKey];
        return next;
      });
    }
    setAddTicketWarning(null);
  };

  const handleSubmitNewPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (
      !department.trim() ||
      !projectTitle.trim() ||
      !projectCode.trim() ||
      !preparedBy.trim() ||
      !preparedByDesignation.trim() ||
      !reviewedBy.trim() ||
      !reviewedByDesignation.trim() ||
      !approvedBy.trim() ||
      !approvedByDesignation.trim()
    ) {
      setFormError(
        'All project fields and mandatory sign-offs with designations (Prepared by, Reviewed by, and Approved by) are required.'
      );
      return;
    }

    if (ticketDrafts.length === 0 || ticketDrafts.length > MAX_TICKETS_PER_WORKPLAN) {
      setFormError(`Include between 1 and ${MAX_TICKETS_PER_WORKPLAN} trip tickets in the work plan.`);
      return;
    }

    const incompleteOnSubmit: Record<string, boolean> = {};
    let hasTicketMissing = false;
    for (const draft of ticketDrafts) {
      const missing = getMissingTicketMandatoryFields(draft);
      if (missing.length > 0) {
        incompleteOnSubmit[draft.key] = true;
        hasTicketMissing = true;
      }
    }
    if (hasTicketMissing) {
      setValidatedTicketKeys((prev) => ({ ...prev, ...incompleteOnSubmit }));
      setFormError(
        'Every trip ticket requires a selected vehicle/equipment unit, mandatory Assigned Driver, mandatory Purpose/Related Project, destination, scheduled date, issuing depot, and positive liters.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const preparedTickets = ticketDrafts.map((draft) => {
        const veh = vehicles.find((v) => v.id === draft.vehicleId)!;
        const calc = evaluateRequestedLitersAgainstVehicle(
          veh,
          draft.estimatedUsage,
          draft.requestedLiters,
          draft.terrainFactor
        );
        return {
          vehicleId: veh.id,
          plateNumber: veh.plateNumber,
          vehicleLabel: veh.makeModel,
          driverName: draft.driverName.trim(),
          driverLicense: draft.driverLicense.trim(),
          purposeOrProject: draft.purposeOrProject.trim(),
          fuelType: veh.fuelType,
          depotId: draft.depotId,
          scheduledDate: draft.scheduledDate,
          destination: draft.destination.trim(),
          estimatedUsage: draft.estimatedUsage,
          computedLimitLiters: Math.max(1, calc.computedLimitLiters),
          requestedLiters: Math.round(draft.requestedLiters * 10) / 10,
        };
      });

      const created = await onCreateWorkPlan(
        {
          department: department.trim(),
          projectTitle: projectTitle.trim(),
          projectCode: projectCode.trim(),
          weekStart,
          weekEnd,
          preparedBy: preparedBy.trim(),
          preparedByDesignation: preparedByDesignation.trim(),
          reviewedBy: reviewedBy.trim(),
          reviewedByDesignation: reviewedByDesignation.trim(),
          approvedBy: approvedBy.trim(),
          approvedByDesignation: approvedByDesignation.trim(),
        },
        preparedTickets
      );

      // Save automatically triggers downloadable printable PDF copy of the work plan
      const pdfResult = generateWorkPlanPdf(created.workPlan, created.tickets);
      pdfResult.doc.save(pdfResult.filename);
      URL.revokeObjectURL(pdfResult.blobUrl);

      setProjectTitle('');
      setReviewedBy('');
      setReviewedByDesignation('');
      setApprovedBy('');
      setApprovedByDesignation('');
      setValidatedTicketKeys({});
      setAddTicketWarning(null);
      setTicketDrafts([
        {
          key: `row_${Date.now()}`,
          vehicleId: vehicles[0]?.id ?? '',
          vehicleSearch: '',
          vehicleOfficeFilter: 'all',
          vehicleClassFilter: 'all',
          vehicleFuelFilter: 'all',
          driverName: '',
          driverLicense: '',
          purposeOrProject: '',
          depotId: depots[0]?.id ?? '',
          scheduledDate: today,
          destination: '',
          estimatedUsage: 120,
          terrainFactor: 1.0,
          requestedLiters: 30,
        },
      ]);
      onCloseModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save work plan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#D5DCE6] bg-white p-4">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search work plan no., office, or infrastructure project..."
            aria-label="Search departmental work plans"
            className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] py-2 pl-9 pr-3 text-sm text-[#0B192C] placeholder:text-[#5A6F8C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'all',
                  label: `All (${categorizedPlans.pending.length + categorizedPlans.approved.length})`,
                },
                { id: 'pending', label: `Pending (${categorizedPlans.pending.length})` },
                { id: 'approved', label: `Approved (${categorizedPlans.approved.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>New Work Plan</span>
          </button>
        </div>
      </div>

      {/* Preview-Gated Work Plans List (Categorized: Pending & Approved) */}
      <RecordsPreviewGate
        title="Departmental Weekly Work Plans"
        description="Submitted work plans and embedded 7-digit trip tickets are hidden until Preview is pressed."
        recordCount={visibleCategoryCount}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Work Plans"
      >
        {visibleCategoryCount === 0 ? (
          <div className="rounded-lg border border-[#D5DCE6] bg-white p-10 text-center space-y-3">
            <FileText className="mx-auto h-9 w-9 text-[#5A6F8C]" />
            <h2 className="font-display text-base font-bold text-[#0B192C]">
              No weekly work plans found
            </h2>
            <p className="text-sm text-[#5A6F8C] max-w-md mx-auto">
              Create a departmental weekly work plan (up to 12 trip tickets) with mandatory hierarchical sign-offs and designations.
            </p>
            <button
              type="button"
              onClick={onOpenModal}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
            >
              <Plus className="h-4 w-4" />
              <span>Create Weekly Work Plan</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Category 1: Pending Work Plans */}
            {(statusFilter === 'all' || statusFilter === 'pending') && (
              <section aria-label="Pending Department Requests" className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#D5DCE6] pb-2">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-sm font-bold text-[#0B192C]">
                      Pending Requests
                    </h2>
                    <span className="rounded bg-[#E6EBF2] px-2 py-0.5 font-mono text-xs font-semibold text-[#0B192C]">
                      {categorizedPlans.pending.length}
                    </span>
                  </div>
                  <span className="text-xs text-[#5A6F8C]">
                    Awaiting authorized tabletop assessment
                  </span>
                </div>

                {categorizedPlans.pending.length === 0 ? (
                  <div className="rounded-lg border border-[#D5DCE6] bg-white p-6 text-center text-xs text-[#5A6F8C]">
                    No pending work plans match your current search.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {categorizedPlans.pending.map(({ workPlan: wp, planTickets }) => {
                      const isExpanded = expandedPlanId === wp.id;
                      return (
                        <div
                          key={wp.id}
                          className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
                        >
                          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                              <button
                                type="button"
                                onClick={() => setExpandedPlanId(isExpanded ? null : wp.id)}
                                aria-expanded={isExpanded}
                                aria-label={`Toggle details for ${wp.controlNumber}`}
                                className="mt-0.5 rounded border border-[#D5DCE6] p-1 text-[#334E73] hover:bg-[#F3F5F8] shrink-0"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                  <span className="font-mono font-semibold text-[#1B3B6F] whitespace-nowrap">
                                    {wp.controlNumber}
                                  </span>
                                  <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                                  <span className="font-medium text-[#334E73]">
                                    {wp.department}
                                  </span>
                                  <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                                  <span className="font-mono text-[#5A6F8C] whitespace-nowrap">
                                    {wp.weekStart} to {wp.weekEnd}
                                  </span>
                                </div>
                                <h3 className="font-display text-sm sm:text-base font-bold text-[#0B192C]">
                                  {wp.projectTitle}
                                </h3>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5A6F8C]">
                                  <span className="whitespace-nowrap">Project {wp.projectCode}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="whitespace-nowrap">{planTickets.length} Trip Ticket(s)</span>
                                  <span aria-hidden="true">·</span>
                                  <span>Prepared by {wp.preparedBy}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 shrink-0 pl-8 lg:pl-0">
                              <div className="border-r border-[#D5DCE6] pr-4 text-right">
                                <div className="text-[11px] text-[#5A6F8C]">Requested</div>
                                <div className="font-mono text-sm font-semibold tabular-nums text-[#0B192C]">
                                  {wp.totalRequestedLiters.toFixed(1)} L
                                </div>
                              </div>

                              <span className="text-[11px] font-bold uppercase tracking-wide whitespace-nowrap text-amber-800">
                                Pending Approval
                              </span>

                              {canPdf && (
                                <button
                                  type="button"
                                  onClick={() => onPreviewPdf(wp, planTickets)}
                                  className="inline-flex items-center gap-1 rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#E6EBF2] whitespace-nowrap"
                                >
                                  <FileDown className="h-3.5 w-3.5" />
                                  <span>PDF</span>
                                </button>
                              )}

                              {(canEdit || canDelete) && (
                                <div className="flex items-center gap-1">
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingPlan(wp);
                                        setEditProjectTitle(wp.projectTitle);
                                        setEditDivisionHead(wp.divisionHead ?? '');
                                        setEditUnitLead(wp.unitLead ?? '');
                                        setEditSectionManager(wp.sectionManager ?? '');
                                      }}
                                      aria-label={`Edit work plan ${wp.controlNumber}`}
                                      className="rounded border border-[#D5DCE6] p-1.5 text-[#334E73] hover:bg-[#F3F5F8]"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => onDeleteWorkPlan(wp)}
                                      aria-label={`Delete work plan ${wp.controlNumber}`}
                                      className="rounded border border-[#D5DCE6] p-1.5 text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-[#D5DCE6] bg-[#F9FAFC] p-4 space-y-4">
                              <div className="overflow-x-auto rounded-md border border-[#D5DCE6] bg-white">
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                                    <tr>
                                      <th className="px-3 py-2.5 font-semibold">Ticket #</th>
                                      <th className="px-3 py-2.5 font-semibold">Vehicle / Equipment</th>
                                      <th className="px-3 py-2.5 font-semibold">Assigned Driver</th>
                                      <th className="px-3 py-2.5 font-semibold">Purpose / Project & Destination</th>
                                      <th className="px-3 py-2.5 font-semibold text-right">Auto Limit</th>
                                      <th className="px-3 py-2.5 font-semibold text-right">Requested</th>
                                      <th className="px-3 py-2.5 font-semibold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#E6EBF2]">
                                    {planTickets.map((t) => (
                                      <tr key={t.id} className="hover:bg-[#F9FAFC]">
                                        <td className="px-3 py-2.5 font-mono font-semibold text-[#0B192C] whitespace-nowrap">
                                          {t.ticketNumber}
                                        </td>
                                        <td className="px-3 py-2.5">
                                          <div className="font-mono font-semibold text-[#0B192C]">
                                            {t.plateNumber}
                                          </div>
                                          <div className="text-[11px] text-[#5A6F8C]">
                                            {t.vehicleLabel} · {t.fuelType.toUpperCase()}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2.5">
                                          <div className="font-medium text-[#0B192C]">{t.driverName}</div>
                                          {t.driverLicense && (
                                            <div className="font-mono text-[11px] text-[#5A6F8C]">
                                              Lic: {t.driverLicense}
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                          <div className="font-medium text-[#0B192C]">
                                            {t.purposeOrProject || t.projectTitle}
                                          </div>
                                          <div className="text-[11px] text-[#5A6F8C]">
                                            {t.scheduledDate} · {t.destination}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#5A6F8C]">
                                          {t.computedLimitLiters.toFixed(1)} L
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium text-[#0B192C]">
                                          {t.requestedLiters.toFixed(1)} L
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap font-medium text-amber-800">
                                          Pending Approval
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-md border border-[#D5DCE6] bg-white p-3 text-xs">
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Prepared by</div>
                                  <div className="font-semibold text-[#0B192C]">{wp.preparedBy}</div>
                                  {wp.preparedByDesignation && (
                                    <div className="text-[11px] text-[#5A6F8C]">{wp.preparedByDesignation}</div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Reviewed by</div>
                                  <div className="font-semibold text-[#0B192C]">{wp.reviewedBy}</div>
                                  {wp.reviewedByDesignation && (
                                    <div className="text-[11px] text-[#5A6F8C]">{wp.reviewedByDesignation}</div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Designated Approver</div>
                                  <div className="font-semibold text-[#0B192C]">{wp.approvedBy}</div>
                                  {wp.approvedByDesignation && (
                                    <div className="text-[11px] text-[#5A6F8C]">{wp.approvedByDesignation}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Category 2: Approved Work Plans */}
            {(statusFilter === 'all' || statusFilter === 'approved') && (
              <section aria-label="Approved Department Requests" className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#D5DCE6] pb-2">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-sm font-bold text-[#0B192C]">
                      Approved Requests
                    </h2>
                    <span className="rounded bg-[#E6EBF2] px-2 py-0.5 font-mono text-xs font-semibold text-[#1B3B6F]">
                      {categorizedPlans.approved.length}
                    </span>
                  </div>
                  <span className="text-xs text-[#5A6F8C]">
                    Includes authorized approver allocation and actual GSO fuel dispensed
                  </span>
                </div>

                {categorizedPlans.approved.length === 0 ? (
                  <div className="rounded-lg border border-[#D5DCE6] bg-white p-6 text-center text-xs text-[#5A6F8C]">
                    No approved work plans match your current search.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {categorizedPlans.approved.map((summary) => {
                      const { workPlan: wp, planTickets } = summary;
                      const isExpanded = expandedPlanId === wp.id;

                      return (
                        <div
                          key={wp.id}
                          className={`rounded-lg border bg-white overflow-hidden ${
                            summary.hasUndispensedApproved
                              ? 'border-red-300'
                              : 'border-[#D5DCE6]'
                          }`}
                        >
                          {/* Red Header Note for Undispensed Approved Fuel Requests */}
                          {summary.hasUndispensedApproved && (
                            <div
                              role="status"
                              className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700"
                            >
                              <span className="flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-700" />
                                <span>
                                  UNDISPENSED APPROVED FUEL REQUEST —{' '}
                                  {summary.undispensedApprovedLiters.toFixed(1)} L approved by{' '}
                                  {wp.approvedBy || 'Authorized Approver'} across{' '}
                                  {summary.undispensedTicketCount} ticket(s), awaiting GSO dispensing
                                </span>
                              </span>
                              <span className="font-mono text-[11px] uppercase tracking-wide text-red-800 whitespace-nowrap">
                                Undispensed
                              </span>
                            </div>
                          )}

                          {/* Approved Work Plan Summary Row */}
                          <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                              <button
                                type="button"
                                onClick={() => setExpandedPlanId(isExpanded ? null : wp.id)}
                                aria-expanded={isExpanded}
                                aria-label={`Toggle details for ${wp.controlNumber}`}
                                className="mt-0.5 rounded border border-[#D5DCE6] p-1 text-[#334E73] hover:bg-[#F3F5F8] shrink-0"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                  <span className="font-mono font-semibold text-[#1B3B6F] whitespace-nowrap">
                                    {wp.controlNumber}
                                  </span>
                                  <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                                  <span className="font-medium text-[#334E73]">
                                    {wp.department}
                                  </span>
                                  <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                                  <span className="font-mono text-[#5A6F8C] whitespace-nowrap">
                                    {wp.weekStart} to {wp.weekEnd}
                                  </span>
                                </div>
                                <h3 className="font-display text-sm sm:text-base font-bold text-[#0B192C]">
                                  {wp.projectTitle}
                                </h3>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5A6F8C]">
                                  <span className="whitespace-nowrap">Project {wp.projectCode}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="whitespace-nowrap">{planTickets.length} Trip Ticket(s)</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-medium text-[#1B3B6F]">
                                    Approved by {wp.approvedBy || 'Authorized Approver'}:{' '}
                                    {summary.approvedLiters.toFixed(1)} L
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Right Metrics & Actions */}
                            <div className="flex flex-wrap items-center gap-3 shrink-0 pl-8 lg:pl-0">
                              <div className="grid grid-cols-3 gap-4 border-r border-[#D5DCE6] pr-4 text-right">
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Requested</div>
                                  <div className="font-mono text-sm font-semibold tabular-nums text-[#0B192C]">
                                    {wp.totalRequestedLiters.toFixed(1)} L
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Approved (Approver)</div>
                                  <div className="font-mono text-sm font-semibold tabular-nums text-[#1B3B6F]">
                                    {summary.approvedLiters.toFixed(1)} L
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Actual Dispensed</div>
                                  <div
                                    className={`font-mono text-sm font-semibold tabular-nums ${
                                      summary.dispensedLiters > 0
                                        ? 'text-emerald-800'
                                        : 'text-red-700'
                                    }`}
                                  >
                                    {summary.dispensedLiters.toFixed(1)} L
                                  </div>
                                </div>
                              </div>

                              <span
                                className={`text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${
                                  wp.status === 'partially_approved'
                                    ? 'text-[#1B3B6F]'
                                    : 'text-emerald-800'
                                }`}
                              >
                                {wp.status.replace(/_/g, ' ')}
                              </span>

                              {canPdf && (
                                <button
                                  type="button"
                                  onClick={() => onPreviewPdf(wp, planTickets)}
                                  className="inline-flex items-center gap-1 rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#E6EBF2] whitespace-nowrap"
                                >
                                  <FileDown className="h-3.5 w-3.5" />
                                  <span>PDF</span>
                                </button>
                              )}

                              {(canEdit || canDelete) && (
                                <div className="flex items-center gap-1">
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingPlan(wp);
                                        setEditProjectTitle(wp.projectTitle);
                                        setEditDivisionHead(wp.divisionHead ?? '');
                                        setEditUnitLead(wp.unitLead ?? '');
                                        setEditSectionManager(wp.sectionManager ?? '');
                                      }}
                                      aria-label={`Edit work plan ${wp.controlNumber}`}
                                      className="rounded border border-[#D5DCE6] p-1.5 text-[#334E73] hover:bg-[#F3F5F8]"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => onDeleteWorkPlan(wp)}
                                      aria-label={`Delete work plan ${wp.controlNumber}`}
                                      className="rounded border border-[#D5DCE6] p-1.5 text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expanded Approved Trip Tickets Matrix */}
                          {isExpanded && (
                            <div className="border-t border-[#D5DCE6] bg-[#F9FAFC] p-4 space-y-4">
                              <div className="overflow-x-auto rounded-md border border-[#D5DCE6] bg-white">
                                <table className="w-full text-left text-xs">
                                  <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                                    <tr>
                                      <th className="px-3 py-2.5 font-semibold">Ticket #</th>
                                      <th className="px-3 py-2.5 font-semibold">Vehicle / Equipment</th>
                                      <th className="px-3 py-2.5 font-semibold">Assigned Driver</th>
                                      <th className="px-3 py-2.5 font-semibold">Purpose / Project & Destination</th>
                                      <th className="px-3 py-2.5 font-semibold text-right">Requested</th>
                                      <th className="px-3 py-2.5 font-semibold text-right">Approved (Approver)</th>
                                      <th className="px-3 py-2.5 font-semibold text-right">Actual Fuel Dispensed</th>
                                      <th className="px-3 py-2.5 font-semibold">Ticket State</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#E6EBF2]">
                                    {planTickets.map((t) => {
                                      const isUndispensedApproved =
                                        !t.servedOnce &&
                                        (t.status === 'approved' || t.status === 'reduced') &&
                                        t.approvedLiters > 0;
                                      return (
                                        <tr
                                          key={t.id}
                                          className={
                                            isUndispensedApproved
                                              ? 'bg-red-50/40 hover:bg-red-50/70'
                                              : 'hover:bg-[#F9FAFC]'
                                          }
                                        >
                                          <td className="px-3 py-2.5 font-mono font-semibold text-[#0B192C] whitespace-nowrap">
                                            {t.ticketNumber}
                                          </td>
                                          <td className="px-3 py-2.5">
                                            <div className="font-mono font-semibold text-[#0B192C]">
                                              {t.plateNumber}
                                            </div>
                                            <div className="text-[11px] text-[#5A6F8C]">
                                              {t.vehicleLabel} · {t.fuelType.toUpperCase()}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2.5">
                                            <div className="font-medium text-[#0B192C]">{t.driverName}</div>
                                            {t.driverLicense && (
                                              <div className="font-mono text-[11px] text-[#5A6F8C]">
                                                Lic: {t.driverLicense}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-2.5">
                                            <div className="font-medium text-[#0B192C]">
                                              {t.purposeOrProject || t.projectTitle}
                                            </div>
                                            <div className="text-[11px] text-[#5A6F8C]">
                                              {t.scheduledDate} · {t.destination}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium text-[#0B192C]">
                                            {t.requestedLiters.toFixed(1)} L
                                          </td>
                                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-[#1B3B6F]">
                                            <div>{t.approvedLiters.toFixed(1)} L</div>
                                            {t.status === 'reduced' && (
                                              <div className="text-[10px] font-normal text-[#5A6F8C]">
                                                Tabletop reduced
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">
                                            {t.servedOnce ? (
                                              <div className="text-emerald-800">
                                                <div>{t.dispensedLiters.toFixed(1)} L</div>
                                                {t.dispensedBy && (
                                                  <div className="text-[10px] font-sans font-normal text-[#5A6F8C]">
                                                    By {t.dispensedBy}
                                                  </div>
                                                )}
                                                {t.forfeitedLiters > 0 && (
                                                  <div className="text-[10px] text-red-700">
                                                    -{t.forfeitedLiters.toFixed(1)} L void
                                                  </div>
                                                )}
                                              </div>
                                            ) : isUndispensedApproved ? (
                                              <span className="text-red-700">
                                                0.0 L (Undispensed)
                                              </span>
                                            ) : (
                                              <span className="text-[#5A6F8C]">
                                                {t.dispensedLiters.toFixed(1)} L
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2.5 whitespace-nowrap">
                                            {isUndispensedApproved ? (
                                              <span className="font-semibold text-red-700">
                                                Undispensed · Approved
                                              </span>
                                            ) : (
                                              <span className="font-medium text-emerald-800 capitalize">
                                                {t.status}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-md border border-[#D5DCE6] bg-white p-3 text-xs">
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Prepared by</div>
                                  <div className="font-semibold text-[#0B192C]">{wp.preparedBy}</div>
                                  {wp.preparedByDesignation && (
                                    <div className="text-[11px] text-[#5A6F8C]">{wp.preparedByDesignation}</div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Reviewed by</div>
                                  <div className="font-semibold text-[#0B192C]">{wp.reviewedBy}</div>
                                  {wp.reviewedByDesignation && (
                                    <div className="text-[11px] text-[#5A6F8C]">{wp.reviewedByDesignation}</div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[11px] text-[#5A6F8C]">Approved by (Authorized Approver)</div>
                                  <div className="font-semibold text-[#0B192C]">{wp.approvedBy}</div>
                                  {wp.approvedByDesignation && (
                                    <div className="text-[11px] text-[#5A6F8C]">{wp.approvedByDesignation}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </RecordsPreviewGate>

      {/* Edit Modal (Permission Gated) */}
      {editingPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Work Plan"
        >
          <div className="w-full max-w-lg rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#D5DCE6] pb-3">
              <h2 className="font-display text-base font-bold text-[#0B192C]">
                Edit Work Plan ({editingPlan.controlNumber})
              </h2>
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                aria-label="Close edit dialog"
                className="rounded p-1 text-[#5A6F8C] hover:bg-[#F3F5F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-[#334E73] mb-1">
                  Infrastructure / Operational Project Title
                </label>
                <input
                  type="text"
                  value={editProjectTitle}
                  onChange={(e) => setEditProjectTitle(e.target.value)}
                  className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-sm text-[#0B192C]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#334E73] mb-1">
                  Division Head
                </label>
                <input
                  type="text"
                  value={editDivisionHead}
                  onChange={(e) => setEditDivisionHead(e.target.value)}
                  className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-sm text-[#0B192C]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#334E73] mb-1">
                    Unit Lead
                  </label>
                  <input
                    type="text"
                    value={editUnitLead}
                    onChange={(e) => setEditUnitLead(e.target.value)}
                    className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-sm text-[#0B192C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334E73] mb-1">
                    Section Manager
                  </label>
                  <input
                    type="text"
                    value={editSectionManager}
                    onChange={(e) => setEditSectionManager(e.target.value)}
                    className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-sm text-[#0B192C]"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#D5DCE6] pt-3">
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                className="rounded-md border border-[#D5DCE6] px-4 py-2 text-xs font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onUpdateWorkPlanAdmin(editingPlan.id, {
                    projectTitle: editProjectTitle.trim(),
                    divisionHead: editDivisionHead.trim(),
                    unitLead: editUnitLead.trim(),
                    sectionManager: editSectionManager.trim(),
                  });
                  setEditingPlan(null);
                }}
                className="rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Weekly Work Plan Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-3 sm:p-6 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="New Weekly Work Plan"
        >
          <form
            onSubmit={handleSubmitNewPlan}
            className="my-auto w-full max-w-4xl rounded-lg border border-[#D5DCE6] bg-white overflow-hidden max-h-[92vh] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-[#D5DCE6] bg-[#0B192C] px-5 py-3.5 text-white">
              <div>
                <h2 className="font-display text-base font-bold">
                  New Departmental Weekly Work Plan & Fuel Requisition
                </h2>
                <p className="text-xs text-slate-300">
                  Sequential Work Plan & 7-digit Trip Tickets (max 12 per request). Saving automatically downloads a printable PDF.
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseModal}
                aria-label="Close new work plan modal"
                className="rounded p-1.5 text-slate-300 hover:bg-[#13294B] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {formError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
                  {formError}
                </div>
              )}

              {/* Section 1: Work Plan & Infrastructure Project Details */}
              <div className="space-y-3">
                <h3 className="font-display text-sm font-bold text-[#0B192C] border-b border-[#E6EBF2] pb-1.5">
                  01. Department & Infrastructure Project Coverage
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="wp-dept" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Concerned Office / Department *
                    </label>
                    <input
                      id="wp-dept"
                      type="text"
                      list="wp-dept-list"
                      required
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] bg-white px-3 py-2 text-xs text-[#0B192C]"
                    />
                    <datalist id="wp-dept-list">
                      {BAIS_DEPARTMENTS.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label htmlFor="wp-ctrl" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Pre-Assigned Sequential Work Plan No.
                    </label>
                    <input
                      id="wp-ctrl"
                      type="text"
                      readOnly
                      value={preAssignedControlNumber}
                      className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2 font-mono text-xs font-bold text-[#1B3B6F]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-proj-code" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Project / Program Code *
                    </label>
                    <input
                      id="wp-proj-code"
                      type="text"
                      required
                      placeholder="e.g. INFRA-2026-022"
                      value={projectCode}
                      onChange={(e) => setProjectCode(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="wp-week-start" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Week Start Date *
                    </label>
                    <input
                      id="wp-week-start"
                      type="date"
                      required
                      value={weekStart}
                      onChange={(e) => setWeekStart(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-week-end" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Week End Date *
                    </label>
                    <input
                      id="wp-week-end"
                      type="date"
                      required
                      value={weekEnd}
                      onChange={(e) => setWeekEnd(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-proj-title" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Work Plan Project / Activity Title *
                    </label>
                    <input
                      id="wp-proj-title"
                      type="text"
                      required
                      placeholder="e.g. Barangay Road Concrete Paving"
                      value={projectTitle}
                      onChange={(e) => setProjectTitle(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Embedded Trip Tickets (Max 12, Distinct 7-Digit Sequence) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#E6EBF2] pb-1.5">
                  <h3 className="font-display text-sm font-bold text-[#0B192C]">
                    02. Embedded Trip Tickets ({ticketDrafts.length} / {MAX_TICKETS_PER_WORKPLAN} max)
                  </h3>
                  <span className="text-[11px] font-medium text-[#5A6F8C]">
                    Max {MAX_TICKETS_PER_WORKPLAN} trip tickets per work plan
                  </span>
                </div>

                {vehicles.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    No vehicles registered in this environment yet. Register fleet units in Fleet Registry first.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ticketDrafts.map((row, idx) => {
                      const filteredVehicles = filterVehiclesForTicket(vehicles, {
                        search: row.vehicleSearch,
                        office: row.vehicleOfficeFilter,
                        equipmentClass: row.vehicleClassFilter,
                        fuelType: row.vehicleFuelFilter,
                      });
                      const hasActiveVehicleFilter =
                        Boolean(row.vehicleSearch.trim()) ||
                        row.vehicleOfficeFilter !== 'all' ||
                        row.vehicleClassFilter !== 'all' ||
                        row.vehicleFuelFilter !== 'all';

                      const veh = vehicles.find((v) => v.id === row.vehicleId);
                      const calc = veh
                        ? evaluateRequestedLitersAgainstVehicle(
                            veh,
                            row.estimatedUsage,
                            row.requestedLiters,
                            row.terrainFactor
                          )
                        : null;
                      const assignedTicketNo = preAssignedTicketNumbers[idx] ?? '0000001';
                      const missingFields = getMissingTicketMandatoryFields(row);
                      const showRed = Boolean(validatedTicketKeys[row.key]);
                      const isMissing = (field: ReturnType<typeof getMissingTicketMandatoryFields>[number]) =>
                        showRed && missingFields.includes(field);

                      return (
                        <div
                          key={row.key}
                          ref={(el) => {
                            ticketCardRefs.current[row.key] = el;
                          }}
                          className={`rounded-md border p-3 space-y-3 transition-colors ${
                            showRed && missingFields.length > 0
                              ? 'border-red-400 bg-red-50/20'
                              : 'border-[#D5DCE6] bg-[#F9FAFC]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[#0B192C]">
                                Ticket #{idx + 1}
                              </span>
                              <span className="font-mono text-xs font-semibold text-[#1B3B6F]">
                                Pre-Seq: {assignedTicketNo}
                              </span>
                            </div>
                            {ticketDrafts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeTicketRow(idx)}
                                className="text-xs font-medium text-red-700 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          {/* Vehicle Selection Criteria Filters */}
                          <div className="rounded border border-[#E6EBF2] bg-white p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-[#334E73]">
                                Vehicle Selection Filter Criteria ({filteredVehicles.length} of{' '}
                                {vehicles.length} units)
                              </span>
                              {hasActiveVehicleFilter && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateTicketVehicleFilter(idx, {
                                      vehicleSearch: '',
                                      vehicleOfficeFilter: 'all',
                                      vehicleClassFilter: 'all',
                                      vehicleFuelFilter: 'all',
                                    })
                                  }
                                  className="text-[11px] font-semibold text-[#1B3B6F] hover:underline"
                                >
                                  Reset Filters
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              <input
                                type="text"
                                aria-label={`Filter ticket ${idx + 1} vehicle by plate or model`}
                                placeholder="Search plate or model..."
                                value={row.vehicleSearch}
                                onChange={(e) =>
                                  updateTicketVehicleFilter(idx, { vehicleSearch: e.target.value })
                                }
                                className="w-full rounded border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C] placeholder:text-[#5A6F8C]"
                              />
                              <select
                                aria-label={`Filter ticket ${idx + 1} vehicle by office`}
                                value={row.vehicleOfficeFilter}
                                onChange={(e) =>
                                  updateTicketVehicleFilter(idx, {
                                    vehicleOfficeFilter: e.target.value,
                                  })
                                }
                                className="w-full rounded border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
                              >
                                <option value="all">All Offices</option>
                                {vehicleOfficeOptions.map((off) => (
                                  <option key={off} value={off}>
                                    {off}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={`Filter ticket ${idx + 1} vehicle by class`}
                                value={row.vehicleClassFilter}
                                onChange={(e) =>
                                  updateTicketVehicleFilter(idx, {
                                    vehicleClassFilter: e.target.value as EquipmentClass | 'all',
                                  })
                                }
                                className="w-full rounded border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
                              >
                                <option value="all">All Vehicle / Equipment Classes</option>
                                {(Object.keys(EQUIPMENT_CLASS_SPECS) as EquipmentClass[]).map((cls) => (
                                  <option key={cls} value={cls}>
                                    {EQUIPMENT_CLASS_SPECS[cls].label}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={`Filter ticket ${idx + 1} vehicle by fuel grade`}
                                value={row.vehicleFuelFilter}
                                onChange={(e) =>
                                  updateTicketVehicleFilter(idx, {
                                    vehicleFuelFilter: e.target.value as FuelType | 'all',
                                  })
                                }
                                className="w-full rounded border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
                              >
                                <option value="all">All Fuel Grades</option>
                                <option value="diesel">Diesel Only</option>
                                <option value="gasoline">Gasoline Only</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('vehicleId') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Vehicle / Equipment Unit ({filteredVehicles.length}) *
                                {isMissing('vehicleId') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <select
                                aria-invalid={isMissing('vehicleId')}
                                value={row.vehicleId}
                                onChange={(e) => handleVehiclePick(idx, e.target.value)}
                                className={`w-full rounded border px-2.5 py-1.5 text-xs ${
                                  isMissing('vehicleId')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              >
                                <option value="">
                                  {filteredVehicles.length === 0
                                    ? 'No units match filter...'
                                    : 'Select unit...'}
                                </option>
                                {filteredVehicles.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.plateNumber} — {v.makeModel} ({v.fuelType.toUpperCase()})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('driverName') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Assigned Driver (Mandatory) *
                                {isMissing('driverName') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <input
                                type="text"
                                required
                                aria-invalid={isMissing('driverName')}
                                placeholder="Full name of driver/operator"
                                value={row.driverName}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, driverName: e.target.value } : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 text-xs ${
                                  isMissing('driverName')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900 placeholder:text-red-400'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              />
                            </div>
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('depotId') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Issuing Fuel Depot *
                                {isMissing('depotId') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <select
                                aria-invalid={isMissing('depotId')}
                                value={row.depotId}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, depotId: e.target.value } : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 text-xs ${
                                  isMissing('depotId')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              >
                                {depots.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('purposeOrProject') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Purpose / Related Project (Mandatory) *
                                {isMissing('purposeOrProject') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <input
                                type="text"
                                required
                                aria-invalid={isMissing('purposeOrProject')}
                                placeholder="e.g. Hauling gravel for Coastal Road Drainage"
                                value={row.purposeOrProject}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, purposeOrProject: e.target.value } : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 text-xs ${
                                  isMissing('purposeOrProject')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900 placeholder:text-red-400'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              />
                            </div>
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('destination') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Route / Project Site Destination *
                                {isMissing('destination') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <input
                                type="text"
                                required
                                aria-invalid={isMissing('destination')}
                                placeholder="e.g. Brgy. Mabunao Quarry to City Hall"
                                value={row.destination}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, destination: e.target.value } : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 text-xs ${
                                  isMissing('destination')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900 placeholder:text-red-400'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('scheduledDate') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Scheduled Date *
                                {isMissing('scheduledDate') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <input
                                type="date"
                                required
                                aria-invalid={isMissing('scheduledDate')}
                                value={row.scheduledDate}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, scheduledDate: e.target.value } : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 font-mono text-xs ${
                                  isMissing('scheduledDate')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-[#334E73] mb-1">
                                {veh?.efficiencyUnit === 'liters_per_hour'
                                  ? 'Est. Operating Hrs'
                                  : 'Est. Distance (km)'}
                              </label>
                              <input
                                type="number"
                                min={1}
                                step="0.5"
                                value={row.estimatedUsage}
                                onChange={(e) =>
                                  handleUsageOrTerrainChange(
                                    idx,
                                    Number(e.target.value) || 0,
                                    row.terrainFactor
                                  )
                                }
                                className="w-full rounded border border-[#D5DCE6] bg-white px-2.5 py-1.5 font-mono text-xs text-[#0B192C]"
                              />
                            </div>
                            <div>
                              <label
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('requestedLiters') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                Requested Liters *
                                {isMissing('requestedLiters') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <input
                                type="number"
                                min={1}
                                step="0.5"
                                required
                                aria-invalid={isMissing('requestedLiters')}
                                value={row.requestedLiters}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx
                                        ? { ...r, requestedLiters: Number(e.target.value) || 0 }
                                        : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 font-mono text-xs font-semibold ${
                                  isMissing('requestedLiters')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900'
                                    : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              />
                            </div>
                          </div>

                          {veh && calc && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6EBF2] pt-2 text-[11px]">
                              <span className="text-[#5A6F8C]">
                                Class: {EQUIPMENT_CLASS_SPECS[veh.equipmentClass].label} · Formula:{' '}
                                <span className="font-mono text-[#0B192C]">{calc.basisDescription}</span>
                              </span>
                              <span
                                className={`font-mono font-semibold ${
                                  calc.exceedsComputedLimit ? 'text-amber-800' : 'text-[#1B3B6F]'
                                }`}
                              >
                                Computed Limit: {calc.computedLimitLiters.toFixed(1)} L (Weekly Cap:{' '}
                                {veh.maxWeeklyLiters} L)
                                {calc.exceedsComputedLimit && ' — Exceeds auto limit'}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div ref={floatingAddBtnRef} className="space-y-2 pt-1">
                      {addTicketWarning && !allExistingTicketsComplete && (
                        <div
                          role="alert"
                          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
                        >
                          {addTicketWarning}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-3">
                        {!allExistingTicketsComplete && ticketDrafts.length < MAX_TICKETS_PER_WORKPLAN && (
                          <span className="text-[11px] font-medium text-[#5A6F8C]">
                            Fill all mandatory (*) fields of the current ticket to activate
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={ticketDrafts.length >= MAX_TICKETS_PER_WORKPLAN}
                          data-activated={
                            allExistingTicketsComplete &&
                            ticketDrafts.length < MAX_TICKETS_PER_WORKPLAN
                              ? 'true'
                              : 'false'
                          }
                          onClick={addTicketRow}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                            allExistingTicketsComplete
                              ? 'border-[#1B3B6F] bg-[#0B192C] shadow-lg hover:bg-[#1B3B6F]'
                              : 'border-[#94A3B8] bg-[#94A3B8] shadow-sm hover:bg-[#7D8EA6]'
                          }`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>
                            Add Trip Ticket ({ticketDrafts.length}/{MAX_TICKETS_PER_WORKPLAN})
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Mandatory Sign-Offs & Designations */}
              <div className="space-y-3">
                <h3 className="font-display text-sm font-bold text-[#0B192C] border-b border-[#E6EBF2] pb-1.5">
                  03. Mandatory Sign-Offs & Designations
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wp-prep" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Prepared by (Name) *
                    </label>
                    <input
                      id="wp-prep"
                      type="text"
                      required
                      value={preparedBy}
                      onChange={(e) => setPreparedBy(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-prep-desig" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Prepared by Designation *
                    </label>
                    <input
                      id="wp-prep-desig"
                      type="text"
                      required
                      placeholder="e.g. Administrative Officer II"
                      value={preparedByDesignation}
                      onChange={(e) => setPreparedByDesignation(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>

                  <div>
                    <label htmlFor="wp-rev" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Reviewed by (Name) *
                    </label>
                    <input
                      id="wp-rev"
                      type="text"
                      required
                      placeholder="e.g. Engr. Noel Castaneda"
                      value={reviewedBy}
                      onChange={(e) => setReviewedBy(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-rev-desig" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Reviewed by Designation *
                    </label>
                    <input
                      id="wp-rev-desig"
                      type="text"
                      required
                      placeholder="e.g. Assistant Department Head"
                      value={reviewedByDesignation}
                      onChange={(e) => setReviewedByDesignation(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>

                  <div>
                    <label htmlFor="wp-app" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Approved by (Name) *
                    </label>
                    <input
                      id="wp-app"
                      type="text"
                      required
                      placeholder="e.g. Engr. Roberto Alcantara"
                      value={approvedBy}
                      onChange={(e) => setApprovedBy(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-app-desig" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Approved by Designation *
                    </label>
                    <input
                      id="wp-app-desig"
                      type="text"
                      required
                      placeholder="e.g. Department Head / Approving Officer"
                      value={approvedByDesignation}
                      onChange={(e) => setApprovedByDesignation(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3">
              <button
                type="button"
                onClick={onCloseModal}
                className="rounded-md border border-[#D5DCE6] bg-white px-4 py-2 text-xs font-semibold text-[#334E73] hover:bg-[#E6EBF2]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-60"
              >
                <FileDown className="h-4 w-4" />
                <span>{submitting ? 'Saving & Generating PDF...' : 'Save Work Plan & Download PDF'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
