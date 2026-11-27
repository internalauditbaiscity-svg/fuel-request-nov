import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  FileText,
  Folder,
  FolderCheck,
  FolderClock,
  FolderOpen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  BAIS_DEPARTMENTS,
  EQUIPMENT_CLASS_SPECS,
  EquipmentClass,
  FleetVehicle,
  FuelDepot,
  FuelType,
  InventoryLog,
  PmcProject,
  ReportUtilitiesConfig,
  TripTicket,
  TripTicketStatus,
  UserAccount,
  WorkPlan,
} from '../types/fuel';
import {
  addDaysIso,
  canPreviewAndDownloadPdf,
  canUserDeleteRecords,
  canUserEditWorkPlanRecord,
  canUserRequestSingleTrip,
  computePmcProjectFuelSummary,
  evaluateRequestedLitersAgainstVehicle,
  evaluateSingleTripTicketWindow,
  evaluateWorkPlanWeekStart,
  filterAndCategorizeWorkPrograms,
  filterVehiclesForTicket,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getActiveReportUtilityKeys,
  getDepartmentMnemonic,
  getDynamicProgressiveYearOptions,
  getLocalIsoDate,
  getMissingTicketMandatoryFields,
  getOrderedWorkPlanFullReportSections,
  getVehicleFuelTypeFromRegistry,
  getWorkPlanDepartmentSignOffs,
  getWorkPlanDisplayLabel,
  getWorkPlanFullReportSummaryItems,
  getWorkPlanReportTargetsForVariant,
  getWorkPlansForPeriod,
  hasCityWideAccess,
  MAX_TICKETS_PER_WORKPLAN,
  normalizePmcProject,
  requiresPmcRegistryReference,
  requiresWorkPlanSignOffs,
  resolveReportPreviewMode,
  resolveWorkPlanReportLayoutVariant,
  shiftIsoDateToYear,
  shouldRenderWorkProgramFolder,
  shouldShowWorkPlanNumberField,
  validateDraftTicketsAgainstPmcCaps,
  WorkProgramFolderKey,
  WorkProgramRowSummary,
} from '../utils/fuelEngine';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { generateWorkPlanPdf } from '../utils/pdfGenerator';
import { RecordsPreviewGate } from './RecordsPreviewGate';

const WORKPLAN_PREVIEW_COL_LABELS: Record<string, string> = {
  department: 'Dept',
  workPlanNo: 'WP No',
  ticketsApproved: 'Tkt Appr',
  ticketsDispensed: 'Tkt Disp',
  dieselApproved: 'Dsl Appr',
  dieselDispensed: 'Dsl Disp',
  gasApproved: 'Gas Appr',
  gasDispensed: 'Gas Disp',
};

const WORKPLAN_REVIEW_TICKET_COL_LABELS: Record<string, string> = {
  ticketNumber: 'Ticket #',
  vehicle: 'Vehicle',
  driver: 'Driver',
  purpose: 'Purpose',
  aipCode: 'AIP Code',
  scheduledDate: 'Scheduled Date',
  destination: 'Destination',
  autoLimit: 'Limit',
  requested: 'Req (L)',
  approved: 'Appr (L)',
  dispensed: 'Disp (L)',
  state: 'State',
};

const WORK_PROGRAM_MONTH_OPTIONS = [
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

const TRIP_TICKET_STATUS_OPTIONS: Array<{ value: TripTicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All Trip Ticket Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'reduced', label: 'Reduced (Tabletop)' },
  { value: 'dispensed', label: 'Dispensed' },
  { value: 'forfeited', label: 'Forfeited' },
  { value: 'rejected', label: 'Rejected' },
];

interface WorkPlansViewProps {
  workPlans: WorkPlan[];
  allWorkPlans: WorkPlan[];
  tickets: TripTicket[];
  allTickets: TripTicket[];
  vehicles: FleetVehicle[];
  depots: FuelDepot[];
  pmcProjects?: PmcProject[];
  inventoryLogs?: InventoryLog[];
  currentUser: UserAccount;
  reportUtilities?: ReportUtilitiesConfig;
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
  pmcProjectId: string;
  purposeOrProject: string;
  projectAip: string;
  depotId: string;
  scheduledDate: string;
  destination: string;
  estimatedUsage: number;
  terrainFactor: number;
  requestedLiters: number;
}

function getLatestPeriodFromPlans(plans: WorkPlan[]): { month: string; year: string } {
  const now = new Date();
  const fallbackYear = String(now.getFullYear());
  const fallbackMonth = String(now.getMonth() + 1).padStart(2, '0');
  if (plans.length === 0) {
    return { month: fallbackMonth, year: fallbackYear };
  }
  const sorted = [...plans].sort((a, b) => {
    const aMs = Date.parse(a.createdAt || a.weekStart || '');
    const bMs = Date.parse(b.createdAt || b.weekStart || '');
    if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && bMs !== aMs) return bMs - aMs;
    return b.controlNumber.localeCompare(a.controlNumber);
  });
  const ref = sorted[0]?.weekStart || sorted[0]?.createdAt || '';
  const yr = /^\d{4}/.test(ref) ? ref.slice(0, 4) : fallbackYear;
  const mo = /^(0[1-9]|1[0-2])$/.test(ref.slice(5, 7)) ? ref.slice(5, 7) : fallbackMonth;
  return { month: mo, year: yr };
}

export function WorkPlansView({
  workPlans,
  allWorkPlans,
  tickets,
  allTickets,
  vehicles,
  depots,
  pmcProjects = [],
  inventoryLogs = [],
  currentUser,
  reportUtilities,
  isModalOpen,
  onOpenModal,
  onCloseModal,
  onCreateWorkPlan,
  onPreviewPdf,
  onUpdateWorkPlanAdmin,
  onDeleteWorkPlan,
}: WorkPlansViewProps) {
  const activePreviewCols = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'workplans_preview'),
    [reportUtilities]
  );
  const activeForApprovalSections = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'workplans_full_review'),
    [reportUtilities]
  );
  const activeForApprovalTicketCols = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'workplans_review_tickets'),
    [reportUtilities]
  );
  const activeMonitoringSections = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'workplans_monitoring_review'),
    [reportUtilities]
  );
  const activeMonitoringTicketCols = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'workplans_monitoring_tickets'),
    [reportUtilities]
  );

  const initialPeriod = useMemo(() => getLatestPeriodFromPlans(workPlans), [workPlans]);
  const userAdjustedPeriodRef = useRef(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TripTicketStatus | 'all'>('all');
  const [workPlanFilter, setWorkPlanFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>(initialPeriod.month);
  const [yearFilter, setYearFilter] = useState<string>(initialPeriod.year);
  const [activeFolderTab, setActiveFolderTab] = useState<'all' | WorkProgramFolderKey>('all');
  const [filterValidationShown, setFilterValidationShown] = useState(false);

  // Records remain collapsed until selected; deselection collapses them back.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [fullReportDownloadOpen, setFullReportDownloadOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<WorkPlan | null>(null);
  const [editProjectTitle, setEditProjectTitle] = useState('');
  const [editPreparedBy, setEditPreparedBy] = useState('');
  const [editPreparedByDesignation, setEditPreparedByDesignation] = useState('');
  const [editReviewedBy, setEditReviewedBy] = useState('');
  const [editReviewedByDesignation, setEditReviewedByDesignation] = useState('');
  const [editApprovedBy, setEditApprovedBy] = useState('');
  const [editApprovedByDesignation, setEditApprovedByDesignation] = useState('');

  useEscapeClose(Boolean(fullReportDownloadOpen), () => setFullReportDownloadOpen(false), 3);
  useEscapeClose(Boolean(editingPlan), () => setEditingPlan(null), 3);
  useEscapeClose(Boolean(isModalOpen), onCloseModal, 3);

  useEffect(() => {
    if (!userAdjustedPeriodRef.current) {
      setMonthFilter(initialPeriod.month);
      setYearFilter(initialPeriod.year);
    }
  }, [initialPeriod.month, initialPeriod.year]);

  // New Work Plan / Single Trip Ticket Form State
  const preparationDate = getLocalIsoDate();
  const today = preparationDate;
  const nextWeek = addDaysIso(preparationDate, 6);
  const currentSystemYear = preparationDate.slice(0, 4);

  const [requestMode, setRequestMode] = useState<'weekly_work_plan' | 'single_trip'>(
    'weekly_work_plan'
  );
  const [singleExpectedDate, setSingleExpectedDate] = useState(preparationDate);
  const [requestYear, setRequestYear] = useState<string>(currentSystemYear);
  const preAssignedControlNumber = useMemo(
    () => generateNextWorkPlanNumber(allWorkPlans, Number(requestYear) || new Date().getFullYear()),
    [allWorkPlans, requestYear]
  );

  const isDepartmentLocked = !hasCityWideAccess(currentUser.role);
  const [department, setDepartment] = useState<string>(
    currentUser.department || BAIS_DEPARTMENTS[0]
  );

  useEffect(() => {
    if (currentUser.department) {
      setDepartment(currentUser.department);
    }
  }, [isDepartmentLocked, currentUser.department]);

  const effectiveRequestDept = isDepartmentLocked ? currentUser.department : department;
  const normalizedPmcProjects = useMemo(
    () =>
      pmcProjects
        .map((p) => normalizePmcProject(p))
        .sort((a, b) => {
          const aMatch =
            a.department.trim().toLowerCase() === effectiveRequestDept.trim().toLowerCase() ? 1 : 0;
          const bMatch =
            b.department.trim().toLowerCase() === effectiveRequestDept.trim().toLowerCase() ? 1 : 0;
          if (bMatch !== aMatch) return bMatch - aMatch;
          if (b.approvalYear !== a.approvalYear) return b.approvalYear - a.approvalYear;
          return a.aipCode.localeCompare(b.aipCode);
        }),
    [pmcProjects, effectiveRequestDept]
  );

  const pmcSummaryById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computePmcProjectFuelSummary>>();
    for (const p of normalizedPmcProjects) {
      map.set(
        p.id,
        computePmcProjectFuelSummary({
          project: p,
          tickets: allTickets,
          workPlans: allWorkPlans,
          vehicles,
          inventoryLogs,
          depots,
        })
      );
    }
    return map;
  }, [normalizedPmcProjects, allTickets, allWorkPlans, vehicles, inventoryLogs, depots]);

  const singleTripEval = useMemo(
    () => evaluateSingleTripTicketWindow(preparationDate, singleExpectedDate),
    [preparationDate, singleExpectedDate]
  );

  const [weekStart, setWeekStart] = useState(today);
  const [weekEnd, setWeekEnd] = useState(nextWeek);
  const weekStartEval = useMemo(
    () => evaluateWorkPlanWeekStart(preparationDate, weekStart),
    [preparationDate, weekStart]
  );

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

  const defaultDepot = depots[0];

  const vehicleOfficeOptions = useMemo(() => {
    return Array.from(new Set(vehicles.map((v) => v.office))).sort((a, b) => a.localeCompare(b));
  }, [vehicles]);

  const [ticketDrafts, setTicketDrafts] = useState<TicketDraftRow[]>(() => [
    {
      key: 'row_1',
      vehicleId: '',
      vehicleSearch: '',
      vehicleOfficeFilter: 'all',
      vehicleClassFilter: 'all',
      vehicleFuelFilter: 'all',
      driverName: '',
      driverLicense: '',
      pmcProjectId: '',
      purposeOrProject: '',
      projectAip: '',
      depotId: defaultDepot?.id ?? 'depot_gso_central',
      scheduledDate: today,
      destination: '',
      estimatedUsage: 120,
      terrainFactor: 1.0,
      requestedLiters: 30,
    },
  ]);

  const activeTicketDrafts = useMemo(
    () => (requestMode === 'single_trip' ? ticketDrafts.slice(0, 1) : ticketDrafts),
    [requestMode, ticketDrafts]
  );

  // Distinct 7-digit sequential Trip Ticket numbers pre-generated for the draft rows
  const preAssignedTicketNumbers = useMemo(
    () => generateNextTripTicketNumbers(allTickets, activeTicketDrafts.length),
    [allTickets, activeTicketDrafts.length]
  );

  const fallbackDepotId = depots[0]?.id ?? 'depot_gso_central';

  const allExistingTicketsComplete = useMemo(
    () =>
      activeTicketDrafts.every((t) => {
        const veh = vehicles.find((v) => v.id === t.vehicleId);
        const needsPmc = requiresPmcRegistryReference(veh?.equipmentClass);
        return (
          getMissingTicketMandatoryFields(
            {
              ...t,
              scheduledDate: requestMode === 'single_trip' ? singleExpectedDate : t.scheduledDate,
              depotId: t.depotId || fallbackDepotId,
            },
            { aipCodeMandatory: needsPmc, pmcReferenceMandatory: needsPmc }
          ).length === 0
        );
      }),
    [activeTicketDrafts, vehicles, fallbackDepotId, requestMode, singleExpectedDate]
  );

  const canDelete = canUserDeleteRecords(currentUser);
  const canPdf = canPreviewAndDownloadPdf(currentUser.role);
  const canRequestSingleTrip = canUserRequestSingleTrip(currentUser);

  const periodWorkPlans = useMemo(
    () =>
      getWorkPlansForPeriod(workPlans, tickets, {
        month: monthFilter,
        year: yearFilter,
      }),
    [workPlans, tickets, monthFilter, yearFilter]
  );

  const workPlanOptions = useMemo(() => {
    return [...periodWorkPlans].sort((a, b) => b.controlNumber.localeCompare(a.controlNumber));
  }, [periodWorkPlans]);

  useEffect(() => {
    if (workPlanFilter !== 'all' && !workPlanOptions.some((wp) => wp.id === workPlanFilter)) {
      setWorkPlanFilter('all');
    }
  }, [workPlanFilter, workPlanOptions]);

  const yearOptions = useMemo(() => {
    return getDynamicProgressiveYearOptions({
      workPlans: allWorkPlans,
      tickets: allTickets,
      extraYears: [yearFilter, requestYear],
      order: 'asc',
    });
  }, [allWorkPlans, allTickets, yearFilter, requestYear]);

  const modalYearOptions = useMemo(() => {
    const minYear = Number(currentSystemYear);
    return yearOptions.filter((yr) => Number(yr) >= minYear);
  }, [yearOptions, currentSystemYear]);

  const workProgramResult = useMemo(
    () =>
      filterAndCategorizeWorkPrograms(workPlans, tickets, {
        searchQuery,
        ticketStatus: ticketStatusFilter,
        workPlanId: workPlanFilter,
        month: monthFilter,
        year: yearFilter,
      }),
    [workPlans, tickets, searchQuery, ticketStatusFilter, workPlanFilter, monthFilter, yearFilter]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedPlanId || !workProgramResult.valid) return null;
    const pool = [
      ...workProgramResult.approvedDispensed,
      ...workProgramResult.approvedWithUndispensed,
      ...workProgramResult.pendingApproval,
    ];
    return pool.find((s) => s.workPlan.id === selectedPlanId) ?? null;
  }, [selectedPlanId, workProgramResult]);

  useEscapeClose(Boolean(previewOpen && selectedSummary), () => setSelectedPlanId(null), 2);

  const isMonthMissing = workProgramResult.missingFields.includes('month');
  const isYearMissing = workProgramResult.missingFields.includes('year');
  const showMandatoryError =
    !workProgramResult.valid && (filterValidationShown || previewOpen || isMonthMissing || isYearMissing);
  const isPreviewDisabled = !workProgramResult.valid || periodWorkPlans.length === 0;

  useEffect(() => {
    if (isPreviewDisabled && previewOpen) {
      setPreviewOpen(false);
      setSelectedPlanId(null);
    }
  }, [isPreviewDisabled, previewOpen]);

  const visibleFolderCount = workProgramResult.valid
    ? activeFolderTab === 'approved_dispensed'
      ? workProgramResult.approvedDispensed.length
      : activeFolderTab === 'pending_approval'
        ? workProgramResult.pendingApproval.length
        : activeFolderTab === 'approved_undispensed'
          ? workProgramResult.approvedWithUndispensed.length
          : workProgramResult.totalCount
    : 0;

  const hasOptionalFiltersActive = Boolean(
    searchQuery.trim() || ticketStatusFilter !== 'all' || workPlanFilter !== 'all'
  );

  const handleTogglePreview = (nextOpen: boolean) => {
    if (nextOpen && isPreviewDisabled) {
      if (!workProgramResult.valid) {
        setFilterValidationShown(true);
      }
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(nextOpen);
    if (!nextOpen) {
      setSelectedPlanId(null);
      setFullReportDownloadOpen(false);
    }
  };

  const handleResetFilters = () => {
    userAdjustedPeriodRef.current = false;
    setSearchQuery('');
    setTicketStatusFilter('all');
    setWorkPlanFilter('all');
    setMonthFilter(initialPeriod.month);
    setYearFilter(initialPeriod.year);
    setActiveFolderTab('all');
    setFilterValidationShown(false);
    setSelectedPlanId(null);
    setFullReportDownloadOpen(false);
  };

  const handleToggleRowSelection = (planId: string) => {
    setFullReportDownloadOpen(false);
    setSelectedPlanId((prev) => (prev === planId ? null : planId));
  };

  const handleDirectDownloadWorkPlanPdf = (wp: WorkPlan, planTickets: TripTicket[]) => {
    const res = generateWorkPlanPdf(wp, planTickets, reportUtilities, vehicles);
    res.doc.save(res.filename);
    URL.revokeObjectURL(res.blobUrl);
  };

  const handleRequestYearChange = (nextYear: string) => {
    setRequestYear(nextYear);
    setFormError(null);
    const shiftedStart = shiftIsoDateToYear(weekStart, nextYear);
    const clampedStart = shiftedStart < preparationDate ? preparationDate : shiftedStart;
    setWeekStart(clampedStart);
    setWeekEnd(addDaysIso(clampedStart, 6));
    setTicketDrafts((prev) =>
      prev.map((row) => {
        const shiftedTicketDate = shiftIsoDateToYear(row.scheduledDate || clampedStart, nextYear);
        return {
          ...row,
          scheduledDate: shiftedTicketDate < clampedStart ? clampedStart : shiftedTicketDate,
        };
      })
    );
  };

  const handleWeekStartChange = (nextStart: string) => {
    setWeekStart(nextStart);
    setFormError(null);
    const yrMatch = nextStart.match(/^(\d{4})-/);
    if (yrMatch) {
      const yrNum = Number(yrMatch[1]);
      if (yrNum >= Number(currentSystemYear) && yrNum <= 2100) {
        const yr = yrMatch[1];
        if (yr !== requestYear) {
          setRequestYear(yr);
          setTicketDrafts((prev) =>
            prev.map((row) => {
              const shifted = shiftIsoDateToYear(row.scheduledDate || nextStart, yr);
              return {
                ...row,
                scheduledDate: shifted < nextStart ? nextStart : shifted,
              };
            })
          );
        }
      }
      if (nextStart >= preparationDate) {
        if (weekEnd < nextStart) {
          setWeekEnd(addDaysIso(nextStart, 6));
        }
        setTicketDrafts((prev) =>
          prev.map((row) =>
            row.scheduledDate && row.scheduledDate < nextStart
              ? { ...row, scheduledDate: nextStart }
              : row
          )
        );
      }
    }
  };

  useEffect(() => {
    if (!canRequestSingleTrip && requestMode === 'single_trip') {
      setRequestMode('weekly_work_plan');
    }
  }, [canRequestSingleTrip, requestMode]);

  const handleRequestModeChange = (nextMode: 'weekly_work_plan' | 'single_trip') => {
    if (nextMode === 'single_trip' && !canRequestSingleTrip) return;
    setRequestMode(nextMode);
    setFormError(null);
    setAddTicketWarning(null);
    if (nextMode === 'single_trip') {
      const nextDate = singleExpectedDate || preparationDate;
      setSingleExpectedDate(nextDate);
      setRequestYear(preparationDate.slice(0, 4));
      setTicketDrafts((prev) =>
        prev.map((row, idx) => (idx === 0 ? { ...row, scheduledDate: nextDate } : row))
      );
    }
  };

  const handleSingleExpectedDateChange = (nextDate: string) => {
    setSingleExpectedDate(nextDate);
    setFormError(null);
    const yrMatch = nextDate.match(/^(\d{4})-/);
    if (yrMatch) {
      const yrNum = Number(yrMatch[1]);
      if (yrNum >= 2000 && yrNum <= 2100) {
        setRequestYear(yrMatch[1]);
      }
    }
    setTicketDrafts((prev) =>
      prev.map((row, idx) => (idx === 0 ? { ...row, scheduledDate: nextDate } : row))
    );
  };

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

  const handlePmcProjectPick = (index: number, pmcProjectId: string) => {
    const picked = normalizedPmcProjects.find((p) => p.id === pmcProjectId);
    setTicketDrafts((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        if (!picked) {
          return {
            ...row,
            pmcProjectId: '',
            projectAip: '',
          };
        }
        return {
          ...row,
          pmcProjectId: picked.id,
          projectAip: picked.aipCode,
          purposeOrProject: picked.projectName,
        };
      })
    );
  };

  const addTicketRow = () => {
    if (requestMode === 'single_trip') return;
    if (ticketDrafts.length >= MAX_TICKETS_PER_WORKPLAN) return;

    const incompleteKeys: Record<string, boolean> = {};
    let firstIncompleteIdx = -1;
    ticketDrafts.forEach((draft, idx) => {
      const veh = vehicles.find((v) => v.id === draft.vehicleId);
      const needsPmc = requiresPmcRegistryReference(veh?.equipmentClass);
      if (
        getMissingTicketMandatoryFields(
          { ...draft, depotId: draft.depotId || fallbackDepotId },
          { aipCodeMandatory: needsPmc, pmcReferenceMandatory: needsPmc }
        ).length > 0
      ) {
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
    setTicketDrafts((prev) => [
      ...prev,
      {
        key: `row_${Date.now()}_${prev.length + 1}`,
        vehicleId: '',
        vehicleSearch: '',
        vehicleOfficeFilter: 'all',
        vehicleClassFilter: 'all',
        vehicleFuelFilter: 'all',
        driverName: '',
        driverLicense: '',
        pmcProjectId: '',
        purposeOrProject: '',
        projectAip: '',
        depotId: fallbackDepotId,
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
    if (requestMode === 'single_trip') return;
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

    const needsSignOffs = requiresWorkPlanSignOffs(requestMode);
    if (
      !department.trim() ||
      (needsSignOffs &&
        (!preparedBy.trim() ||
          !preparedByDesignation.trim() ||
          !reviewedBy.trim() ||
          !reviewedByDesignation.trim() ||
          !approvedBy.trim() ||
          !approvedByDesignation.trim()))
    ) {
      setFormError(
        needsSignOffs
          ? 'Concerned Office / Department and mandatory sign-offs with designations (Prepared by, Reviewed by, and Approved by) are required.'
          : 'Concerned Office / Department is required.'
      );
      return;
    }

    if (requestMode === 'single_trip' && !singleTripEval.allowed) {
      setFormError(
        singleTripEval.reason ||
          'Single Trip Ticket is only allowed when expected date is less than 3 days from preparation date.'
      );
      return;
    }

    if (requestMode === 'weekly_work_plan' && !weekStartEval.allowed) {
      setFormError(
        weekStartEval.reason ||
          'Week Start Date cannot be earlier than Preparation Date. Work plans can only be prepared moving forward.'
      );
      return;
    }

    if (requestMode === 'weekly_work_plan' && weekEnd < weekStart) {
      setFormError('Week End Date cannot be earlier than Week Start Date.');
      return;
    }

    const draftsToSubmit = activeTicketDrafts;

    if (draftsToSubmit.length === 0 || draftsToSubmit.length > MAX_TICKETS_PER_WORKPLAN) {
      setFormError(`Include between 1 and ${MAX_TICKETS_PER_WORKPLAN} trip tickets in the work plan.`);
      return;
    }

    const incompleteOnSubmit: Record<string, boolean> = {};
    let hasTicketMissing = false;
    let missingPmcReference = false;
    for (const draft of draftsToSubmit) {
      const veh = vehicles.find((v) => v.id === draft.vehicleId);
      const needsPmc = requiresPmcRegistryReference(veh?.equipmentClass);
      const effectiveScheduled =
        requestMode === 'single_trip' ? singleExpectedDate : draft.scheduledDate;
      const missing = getMissingTicketMandatoryFields(
        {
          ...draft,
          scheduledDate: effectiveScheduled,
          depotId: draft.depotId || fallbackDepotId,
        },
        { aipCodeMandatory: needsPmc, pmcReferenceMandatory: needsPmc }
      );
      if (missing.length > 0) {
        incompleteOnSubmit[draft.key] = true;
        hasTicketMissing = true;
        if (missing.includes('pmcProjectId')) {
          missingPmcReference = true;
        }
      }
    }
    if (hasTicketMissing) {
      setValidatedTicketKeys((prev) => ({ ...prev, ...incompleteOnSubmit }));
      setFormError(
        missingPmcReference
          ? 'Heavy Equipment and Dump Truck trip tickets require selecting a registered AIP & Project Name from the PMC Project Registry, plus Assigned Driver, destination, scheduled date, and positive liters.'
          : 'Every trip ticket requires a selected vehicle/equipment unit, mandatory Assigned Driver, mandatory Purpose/Related Project, destination, scheduled date, and positive liters.'
      );
      return;
    }

    // Validate PMC Project Registry reference & aggregate fuel class caps (Diesel / Gasoline)
    const pmcCapCheck = validateDraftTicketsAgainstPmcCaps({
      draftTickets: draftsToSubmit,
      vehicles,
      pmcProjects: normalizedPmcProjects,
      existingTickets: allTickets,
      workPlans: allWorkPlans,
      inventoryLogs,
      depots,
    });
    if (!pmcCapCheck.valid) {
      const flaggedKeys: Record<string, boolean> = {};
      pmcCapCheck.issues.forEach((issue) => {
        const draft = draftsToSubmit[issue.ticketIndex];
        if (draft) flaggedKeys[draft.key] = true;
      });
      setValidatedTicketKeys((prev) => ({ ...prev, ...flaggedKeys }));
      setFormError(pmcCapCheck.issues.map((i) => i.message).join(' '));
      return;
    }

    setSubmitting(true);
    try {
      const preparedTickets = draftsToSubmit.map((draft) => {
        const veh = vehicles.find((v) => v.id === draft.vehicleId)!;
        const calc = evaluateRequestedLitersAgainstVehicle(
          veh,
          draft.estimatedUsage,
          draft.requestedLiters,
          draft.terrainFactor
        );
        const cleanAip = draft.projectAip.trim().slice(0, 160);
        const cleanPmcProjectId = draft.pmcProjectId.trim();
        const effectiveScheduled =
          requestMode === 'single_trip' ? singleExpectedDate : draft.scheduledDate;
        return {
          vehicleId: veh.id,
          plateNumber: veh.plateNumber,
          vehicleLabel: veh.makeModel,
          driverName: draft.driverName.trim(),
          driverLicense: draft.driverLicense.trim(),
          purposeOrProject: draft.purposeOrProject.trim(),
          ...(cleanAip ? { projectAip: cleanAip } : {}),
          ...(cleanPmcProjectId ? { pmcProjectId: cleanPmcProjectId } : {}),
          fuelType: veh.fuelType,
          depotId: draft.depotId || fallbackDepotId,
          scheduledDate: effectiveScheduled,
          destination: draft.destination.trim(),
          estimatedUsage: draft.estimatedUsage,
          computedLimitLiters: Math.max(1, calc.computedLimitLiters),
          requestedLiters: Math.round(draft.requestedLiters * 10) / 10,
        };
      });

      const firstTicketPurpose = preparedTickets
        .map((t) => t.purposeOrProject.trim())
        .find(Boolean);
      const firstTicketAip = preparedTickets
        .map((t) => (t.projectAip ?? '').trim())
        .find(Boolean);
      const derivedProjectCode = (firstTicketAip || '').slice(0, 48);
      const derivedProjectTitle = (
        firstTicketPurpose ||
        firstTicketAip ||
        (requestMode === 'single_trip'
          ? `${department.trim()} Single Trip Ticket`
          : `${department.trim()} Weekly Work Plan`)
      ).slice(0, 200);

      const effectiveWeekStart = requestMode === 'single_trip' ? singleExpectedDate : weekStart;
      const effectiveWeekEnd = requestMode === 'single_trip' ? singleExpectedDate : weekEnd;

      const created = await onCreateWorkPlan(
        {
          ...(requestMode === 'single_trip' ? {} : { controlNumber: preAssignedControlNumber }),
          requestType: requestMode,
          preparationDate,
          department: department.trim(),
          projectTitle: derivedProjectTitle,
          projectCode: derivedProjectCode,
          weekStart: effectiveWeekStart,
          weekEnd: effectiveWeekEnd,
          preparedBy: needsSignOffs ? preparedBy.trim() : '',
          ...(needsSignOffs ? { preparedByDesignation: preparedByDesignation.trim() } : {}),
          reviewedBy: needsSignOffs ? reviewedBy.trim() : '',
          ...(needsSignOffs ? { reviewedByDesignation: reviewedByDesignation.trim() } : {}),
          approvedBy: needsSignOffs ? approvedBy.trim() : '',
          ...(needsSignOffs ? { approvedByDesignation: approvedByDesignation.trim() } : {}),
        },
        preparedTickets
      );

      // Save automatically triggers downloadable printable PDF copy of the work plan
      const pdfResult = generateWorkPlanPdf(created.workPlan, created.tickets, reportUtilities);
      pdfResult.doc.save(pdfResult.filename);
      URL.revokeObjectURL(pdfResult.blobUrl);

      setRequestMode('weekly_work_plan');
      setSingleExpectedDate(preparationDate);
      setRequestYear(currentSystemYear);
      setWeekStart(today);
      setWeekEnd(nextWeek);
      setReviewedBy('');
      setReviewedByDesignation('');
      setApprovedBy('');
      setApprovedByDesignation('');
      setValidatedTicketKeys({});
      setAddTicketWarning(null);
      setTicketDrafts([
        {
          key: `row_${Date.now()}`,
          vehicleId: '',
          vehicleSearch: '',
          vehicleOfficeFilter: 'all',
          vehicleClassFilter: 'all',
          vehicleFuelFilter: 'all',
          driverName: '',
          driverLicense: '',
          pmcProjectId: '',
          purposeOrProject: '',
          projectAip: '',
          depotId: fallbackDepotId,
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

  const renderCompactMobileRecordPreview = (summary: WorkProgramRowSummary) => {
    const { workPlan: wp, planTickets } = summary;
    const isPendingPlan = summary.folder === 'pending_approval';
    const wpDisplayLabel = getWorkPlanDisplayLabel(wp);
    const wpTestKey = wp.controlNumber || wp.id;

    return (
      <div
        data-testid={`compact-record-review-${wpTestKey}`}
        data-preview-mode={resolveReportPreviewMode(false)}
        className="space-y-2.5 rounded-lg border border-[#D5DCE6] bg-white p-3"
      >
        {/* Compact Mobile Header with Top-Right Solid Monochrome Close */}
        <div className="flex items-start justify-between gap-2 border-b border-[#E6EBF2] pb-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
              <span className="font-mono font-bold text-[#1B3B6F]">{wpDisplayLabel}</span>
              <span className="text-[#94A3B8]" aria-hidden="true">·</span>
              <span className="font-mono font-bold text-[#0B192C]" title={wp.department}>
                {getDepartmentMnemonic(wp.department, vehicles)}
              </span>
              <span className="text-[#94A3B8]" aria-hidden="true">·</span>
              <span
                className={`text-[10px] font-bold uppercase ${
                  isPendingPlan
                    ? 'text-amber-800'
                    : summary.hasUndispensedApproved
                      ? 'text-red-700'
                      : 'text-emerald-800'
                }`}
              >
                {wp.status.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-[#5A6F8C]">
              {wp.requestType === 'single_trip' ? wp.weekStart : `${wp.weekStart} – ${wp.weekEnd}`}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setFullReportDownloadOpen(false);
              setSelectedPlanId(null);
            }}
            aria-label={`Close record preview for ${wpDisplayLabel}`}
            data-testid={`full-record-close-${wpTestKey}`}
            className="inline-flex items-center justify-center rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
          >
            Close
          </button>
        </div>

        {/* Compact Inline Totals Strip */}
        <div className="grid grid-cols-3 gap-1.5 rounded border border-[#E6EBF2] bg-[#F8FAFC] px-2.5 py-1.5 text-center">
          <div>
            <div className="text-[10px] font-semibold text-[#5A6F8C]">Req</div>
            <div className="font-mono text-xs font-bold tabular-nums text-[#0B192C]">
              {wp.totalRequestedLiters.toFixed(1)} L
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[#5A6F8C]">Appr</div>
            <div className="font-mono text-xs font-bold tabular-nums text-[#1B3B6F]">
              {wp.totalApprovedLiters.toFixed(1)} L
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[#5A6F8C]">Disp</div>
            <div className="font-mono text-xs font-bold tabular-nums text-emerald-800">
              {wp.totalDispensedLiters.toFixed(1)} L
            </div>
          </div>
        </div>

        {summary.hasUndispensedApproved && (
          <div className="flex items-center justify-between gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700">
            <span className="truncate">
              Undispensed: {summary.undispensedApprovedLiters.toFixed(1)} L ({summary.undispensedTicketCount} tkt)
            </span>
            <span className="font-mono text-[10px] uppercase shrink-0">Pending GSO</span>
          </div>
        )}

        {/* Mobile-Optimized Compact Ticket List */}
        <div className="divide-y divide-[#E6EBF2] rounded border border-[#D5DCE6] bg-white">
          {planTickets.map((t) => {
            const isUndispensedApproved =
              !t.servedOnce &&
              (t.status === 'approved' || t.status === 'reduced') &&
              t.approvedLiters > 0;
            return (
              <div
                key={t.id}
                className={`px-2.5 py-2 text-[11px] space-y-0.5 ${
                  isUndispensedApproved ? 'bg-red-50/40' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono font-bold text-[#0B192C]">{t.ticketNumber}</span>
                    <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-[#1B3B6F]">{t.plateNumber}</span>
                    <span className="font-mono text-[10px] uppercase text-[#5A6F8C]">
                      {t.fuelType === 'gasoline' ? 'GAS' : 'DSL'}
                    </span>
                  </div>
                  <span
                    className={`font-semibold text-[10px] uppercase shrink-0 ${
                      isUndispensedApproved
                        ? 'text-red-700'
                        : t.status === 'pending'
                          ? 'text-amber-800'
                          : 'text-emerald-800'
                    }`}
                  >
                    {isUndispensedApproved ? 'Undispensed' : t.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[#5A6F8C]">
                  <span className="truncate">{t.driverName}</span>
                  <span className="font-mono tabular-nums whitespace-nowrap text-[#0B192C]">
                    R:{t.requestedLiters.toFixed(0)} · A:{t.approvedLiters.toFixed(0)} · D:{t.dispensedLiters.toFixed(0)} L
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Concerned-Department Sign-Offs (Preparer, Reviewer, Department Approver ONLY) */}
        {(() => {
          const deptSignOffs = getWorkPlanDepartmentSignOffs(wp);
          if (deptSignOffs.length === 0) return null;
          return (
            <div
              data-testid={`compact-record-signoffs-${wpTestKey}`}
              className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 rounded border border-[#E6EBF2] bg-[#F8FAFC] px-2.5 py-2 text-[11px]"
            >
              {deptSignOffs.map((signOff) => (
                <div key={signOff.key} className="min-w-0">
                  <div className="text-[10px] font-semibold text-[#5A6F8C]">{signOff.label}</div>
                  <div className="font-semibold text-[#0B192C] truncate">{signOff.name}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Action Strip: Opt-In Download opens Full Preview Report View */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6EBF2] pt-2">
          <div className="flex items-center gap-1.5">
            {canUserEditWorkPlanRecord(currentUser, wp) && (
              <button
                type="button"
                onClick={() => {
                  setEditingPlan(wp);
                  setEditProjectTitle(wp.projectTitle);
                  setEditPreparedBy(wp.preparedBy ?? '');
                  setEditPreparedByDesignation(wp.preparedByDesignation ?? '');
                  setEditReviewedBy(wp.reviewedBy ?? '');
                  setEditReviewedByDesignation(wp.reviewedByDesignation ?? '');
                  setEditApprovedBy(wp.approvedBy ?? '');
                  setEditApprovedByDesignation(wp.approvedByDesignation ?? '');
                }}
                aria-label={`Edit ${wpDisplayLabel}`}
                data-testid={`edit-workplan-btn-${wpTestKey}`}
                className="inline-flex items-center gap-1 rounded border border-[#D5DCE6] px-2.5 py-1.5 text-[11px] font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
              >
                <Edit3 className="h-3 w-3" />
                <span>Edit</span>
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => onDeleteWorkPlan(wp)}
                aria-label={`Delete ${wpDisplayLabel}`}
                className="inline-flex items-center gap-1 rounded border border-[#D5DCE6] px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3" />
                <span>Delete</span>
              </button>
            )}
          </div>

          {canPdf && (
            <button
              type="button"
              data-testid={`workplan-download-optin-${wpTestKey}`}
              onClick={() => setFullReportDownloadOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download Report</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderFullRecordReview = (summary: WorkProgramRowSummary) => {
    const { workPlan: wp, planTickets } = summary;
    const isPendingPlan = summary.folder === 'pending_approval';
    const wpDisplayLabel = getWorkPlanDisplayLabel(wp);
    const wpTestKey = wp.controlNumber || wp.id;
    const layoutVariant = resolveWorkPlanReportLayoutVariant(wp);
    const layoutTargets = getWorkPlanReportTargetsForVariant(layoutVariant);
    const activeFullReviewSections =
      layoutVariant === 'for_approval' ? activeForApprovalSections : activeMonitoringSections;
    const activeReviewTicketCols =
      layoutVariant === 'for_approval' ? activeForApprovalTicketCols : activeMonitoringTicketCols;

    return (
      <div
        data-testid={`full-record-review-${wpTestKey}`}
        data-preview-mode={resolveReportPreviewMode(true)}
        data-layout-variant={layoutVariant}
        className="space-y-3 rounded-md border border-[#D5DCE6] bg-white p-3 sm:p-4"
      >
        {/* Full Preview Report Header (Presented ONLY once Download command is opted) */}
        <div className="space-y-2 border-b border-[#E6EBF2] pb-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                <span className="font-mono font-bold text-[#1B3B6F]">{wpDisplayLabel}</span>
                <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                <span className="font-mono font-bold text-[#0B192C]" title={wp.department}>
                  {getDepartmentMnemonic(wp.department, vehicles)}
                </span>
                <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                <span
                  className={`text-[10px] font-bold uppercase ${
                    isPendingPlan
                      ? 'text-amber-800'
                      : summary.hasUndispensedApproved
                        ? 'text-red-700'
                        : 'text-emerald-800'
                  }`}
                >
                  {wp.status.replace(/_/g, ' ')}
                </span>
                <span className="text-[#94A3B8]" aria-hidden="true">·</span>
                <span
                  data-testid={`full-record-layout-label-${wpTestKey}`}
                  className={`text-[10px] font-bold uppercase ${
                    layoutVariant === 'for_approval' ? 'text-amber-900' : 'text-[#1B3B6F]'
                  }`}
                >
                  {layoutTargets.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-[#5A6F8C]">
                <span>
                  {wp.requestType === 'single_trip'
                    ? `Expected ${wp.weekStart}`
                    : `${wp.weekStart} to ${wp.weekEnd}`}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Prep {wp.preparationDate || (wp.createdAt || '').slice(0, 10) || preparationDate}
                </span>
                {wp.projectCode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>AIP: {wp.projectCode}</span>
                  </>
                )}
              </div>
              {wp.approverNote && (
                <p className="text-[11px] text-[#334E73]">
                  <span className="font-semibold">Approver Note:</span> {wp.approverNote}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setFullReportDownloadOpen(false)}
              aria-label={`Close full report preview for ${wpDisplayLabel}`}
              data-testid={`full-report-download-close-${wpTestKey}`}
              className="inline-flex items-center justify-center rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
            >
              Close
            </button>
          </div>

          {canPdf && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid={`workplan-confirm-download-pdf-${wpTestKey}`}
                onClick={() => handleDirectDownloadWorkPlanPdf(wp, planTickets)}
                className="inline-flex items-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download PDF</span>
              </button>
              <button
                type="button"
                onClick={() => onPreviewPdf(wp, planTickets)}
                className="inline-flex items-center gap-1 rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#E6EBF2] whitespace-nowrap"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>PDF Preview</span>
              </button>
            </div>
          )}
        </div>

        {/* Dynamically Sequenced Full Record Review Sections (Fuel summary omitted prior to approval and placed below the last trip ticket once non-null) */}
        {(() => {
          const fullReportSummaryItems = getWorkPlanFullReportSummaryItems(wp, planTickets);
          const orderedFullSections = getOrderedWorkPlanFullReportSections(
            activeFullReviewSections,
            fullReportSummaryItems.length > 0
          );
          const summaryGridColsClass =
            fullReportSummaryItems.length >= 5
              ? 'sm:grid-cols-5'
              : fullReportSummaryItems.length === 4
                ? 'sm:grid-cols-4'
                : fullReportSummaryItems.length === 3
                  ? 'sm:grid-cols-3'
                  : 'sm:grid-cols-2';

          return orderedFullSections.map((sectionKey) => {
          switch (sectionKey) {
            case 'undispensedNotice':
              return summary.hasUndispensedApproved ? (
                <div
                  key={sectionKey}
                  role="status"
                  data-testid={`full-record-section-undispensedNotice-${wpTestKey}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-700" />
                    <span>
                      UNDISPENSED APPROVED FUEL REQUEST — {summary.undispensedApprovedLiters.toFixed(1)} L
                      approved across {summary.undispensedTicketCount} ticket(s), awaiting GSO dispensing
                    </span>
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wide text-red-800 whitespace-nowrap">
                    Undispensed
                  </span>
                </div>
              ) : null;

            case 'summaryMetrics':
              return fullReportSummaryItems.length > 0 ? (
                <div
                  key={sectionKey}
                  data-testid={`full-record-section-summaryMetrics-${wpTestKey}`}
                  className={`grid grid-cols-2 gap-3 ${summaryGridColsClass} rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-3 text-xs`}
                >
                  {fullReportSummaryItems.map((metric) => (
                    <div key={metric.key} data-testid={`summary-metric-${metric.key}-${wpTestKey}`}>
                      <div className="text-[11px] text-[#5A6F8C]">{metric.label}</div>
                      <div
                        className={`font-mono font-bold tabular-nums ${
                          metric.tone === 'emerald'
                            ? 'text-emerald-800'
                            : metric.tone === 'accent'
                              ? 'text-[#1B3B6F]'
                              : 'text-[#0B192C]'
                        }`}
                      >
                        {metric.value}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null;

            case 'tripTicketsTable':
              return (
                <div
                  key={sectionKey}
                  data-testid={`full-record-section-tripTicketsTable-${wpTestKey}`}
                  className="overflow-x-auto rounded-md border border-[#D5DCE6]"
                >
                  <table className="w-full text-left text-[11px] sm:text-xs" data-testid={`full-record-tickets-table-${wpTestKey}`}>
                    <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                      <tr>
                        {activeReviewTicketCols.map((colKey) => (
                          <th
                            key={colKey}
                            data-col-key={colKey}
                            className="px-2 py-2 sm:px-2.5 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap"
                          >
                            {WORKPLAN_REVIEW_TICKET_COL_LABELS[colKey] ?? colKey}
                          </th>
                        ))}
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
                            {activeReviewTicketCols.map((colKey) => {
                              switch (colKey) {
                                case 'ticketNumber':
                                  return (
                                    <td
                                      key={colKey}
                                      className="px-3 py-2.5 font-mono font-semibold text-[#0B192C] whitespace-nowrap"
                                    >
                                      {t.ticketNumber}
                                    </td>
                                  );
                                case 'vehicle':
                                  return (
                                    <td key={colKey} className="px-3 py-2.5">
                                      <div className="font-mono font-semibold text-[#0B192C]">{t.plateNumber}</div>
                                      <div className="text-[11px] text-[#5A6F8C]">
                                        {t.vehicleLabel} · {t.fuelType.toUpperCase()}
                                      </div>
                                    </td>
                                  );
                                case 'driver':
                                  return (
                                    <td key={colKey} className="px-3 py-2.5">
                                      <div className="font-medium text-[#0B192C]">{t.driverName}</div>
                                      {t.driverLicense && (
                                        <div className="font-mono text-[11px] text-[#5A6F8C]">
                                          Lic: {t.driverLicense}
                                        </div>
                                      )}
                                    </td>
                                  );
                                case 'purpose':
                                  return (
                                    <td
                                      key={colKey}
                                      data-cell-col="purpose"
                                      className="px-3 py-2.5 text-[#0B192C] font-medium min-w-[150px]"
                                    >
                                      {t.purposeOrProject || t.projectTitle || '—'}
                                    </td>
                                  );
                                case 'aipCode': {
                                  const aipVal = (t.projectAip || wp.projectCode || '').trim();
                                  return (
                                    <td
                                      key={colKey}
                                      data-cell-col="aipCode"
                                      className="px-2.5 py-2.5 font-mono text-[11px] font-semibold text-[#1B3B6F] whitespace-nowrap"
                                    >
                                      {aipVal || '—'}
                                    </td>
                                  );
                                }
                                case 'scheduledDate':
                                  return (
                                    <td
                                      key={colKey}
                                      data-cell-col="scheduledDate"
                                      className="px-2.5 py-2.5 font-mono text-[11px] text-[#334E73] whitespace-nowrap"
                                    >
                                      {t.scheduledDate || '—'}
                                    </td>
                                  );
                                case 'destination':
                                  return (
                                    <td
                                      key={colKey}
                                      data-cell-col="destination"
                                      className="px-3 py-2.5 text-[#334E73] min-w-[130px]"
                                    >
                                      {t.destination || '—'}
                                    </td>
                                  );
                                case 'autoLimit':
                                  return (
                                    <td
                                      key={colKey}
                                      className="px-2.5 py-2.5 text-right font-mono tabular-nums text-[#5A6F8C] whitespace-nowrap"
                                    >
                                      {t.computedLimitLiters.toFixed(1)} L
                                    </td>
                                  );
                                case 'requested':
                                  return (
                                    <td
                                      key={colKey}
                                      className="px-2.5 py-2.5 text-right font-mono tabular-nums font-medium text-[#0B192C] whitespace-nowrap"
                                    >
                                      {t.requestedLiters.toFixed(1)} L
                                    </td>
                                  );
                                case 'approved':
                                  return (
                                    <td
                                      key={colKey}
                                      className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-[#1B3B6F]"
                                    >
                                      {t.status === 'pending' ? (
                                        <span className="font-normal text-[#5A6F8C]">Pending</span>
                                      ) : (
                                        <>
                                          <div>{t.approvedLiters.toFixed(1)} L</div>
                                          {t.status === 'reduced' && (
                                            <div className="text-[10px] font-normal text-[#5A6F8C]">
                                              Tabletop reduced
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </td>
                                  );
                                case 'dispensed':
                                  return (
                                    <td
                                      key={colKey}
                                      className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold"
                                    >
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
                                        <span className="text-red-700">0.0 L (Undispensed)</span>
                                      ) : (
                                        <span className="text-[#5A6F8C]">{t.dispensedLiters.toFixed(1)} L</span>
                                      )}
                                    </td>
                                  );
                                case 'state':
                                  return (
                                    <td key={colKey} className="px-3 py-2.5 whitespace-nowrap">
                                      {isUndispensedApproved ? (
                                        <span className="font-semibold text-red-700">Undispensed · Approved</span>
                                      ) : t.status === 'pending' ? (
                                        <span className="font-medium text-amber-800">Pending Approval</span>
                                      ) : (
                                        <span className="font-medium text-emerald-800 capitalize">{t.status}</span>
                                      )}
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
              );

            case 'mandatorySignOffs': {
              if (!layoutTargets.includeSignOffs) return null;
              const deptSignOffs = getWorkPlanDepartmentSignOffs(wp);
              return deptSignOffs.length > 0 ? (
                <div
                  key={sectionKey}
                  data-testid={`full-record-signoffs-${wpTestKey}`}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-md border border-[#D5DCE6] bg-[#F9FAFC] p-3 text-xs"
                >
                  {deptSignOffs.map((signOff) => (
                    <div key={signOff.key}>
                      <div className="text-[11px] text-[#5A6F8C]">{signOff.label}</div>
                      <div className="font-semibold text-[#0B192C]">{signOff.name}</div>
                      {signOff.designation && (
                        <div className="text-[11px] text-[#5A6F8C]">{signOff.designation}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null;
            }

            default:
              return <Fragment key={sectionKey} />;
          }
          });
        })()}
      </div>
    );
  };

  const renderFolderTableSection = (opts: {
    folderKey: WorkProgramFolderKey;
    title: string;
    rows: WorkProgramRowSummary[];
    emptyMessage: string;
    icon: 'dispensed' | 'undispensed' | 'pending';
  }) => {
    const FolderIcon =
      opts.icon === 'dispensed'
        ? FolderCheck
        : opts.icon === 'undispensed'
          ? FolderOpen
          : FolderClock;

    return (
      <section
        aria-label={opts.title}
        data-testid={`workplan-folder-${opts.folderKey}`}
        className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#D5DCE6] bg-[#F8FAFC] px-3 py-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderIcon
              className={`h-3.5 w-3.5 shrink-0 ${
                opts.icon === 'dispensed'
                  ? 'text-emerald-700'
                  : opts.icon === 'undispensed'
                    ? 'text-red-700'
                    : 'text-amber-700'
              }`}
            />
            <h2 className="font-display text-xs font-bold text-[#0B192C] truncate">
              {opts.title} ({opts.rows.length})
            </h2>
          </div>
        </div>

        {opts.rows.length === 0 ? (
          <div className="px-3 py-3 text-center text-[11px] text-[#5A6F8C]">{opts.emptyMessage}</div>
        ) : (
          <div className="overflow-x-auto">
            <table
              data-testid={`workplan-table-${opts.folderKey}`}
              className="w-full text-left text-[11px] sm:text-xs"
            >
              <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                <tr>
                  {activePreviewCols.map((colKey) => (
                    <th
                      key={colKey}
                      data-col-key={colKey}
                      className="px-2 py-2 sm:px-2.5 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap"
                    >
                      {WORKPLAN_PREVIEW_COL_LABELS[colKey] ?? colKey}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {opts.rows.map((summary) => {
                  const wp = summary.workPlan;
                  const wpDisplayLabel = getWorkPlanDisplayLabel(wp);
                  const wpTestKey = wp.controlNumber || wp.id;
                  const isSelected = selectedPlanId === wp.id;

                  return (
                    <tr
                      key={wp.id}
                      data-testid={`workplan-row-${wpTestKey}`}
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => handleToggleRowSelection(wp.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#EEF2F8]'
                          : summary.hasUndispensedApproved
                            ? 'bg-red-50/25 hover:bg-red-50/60'
                            : 'hover:bg-[#F9FAFC]'
                      }`}
                    >
                      {activePreviewCols.map((colKey) => {
                        switch (colKey) {
                          case 'department':
                            return (
                              <td key={colKey} className="px-2 py-2 sm:px-2.5 font-medium text-[#0B192C] max-w-[130px] sm:max-w-[165px]">
                                <div
                                  className="font-mono font-bold text-[#0B192C]"
                                  title={wp.department}
                                  data-testid={`wp-dept-mnemonic-${wpTestKey}`}
                                >
                                  {getDepartmentMnemonic(wp.department, vehicles)}
                                </div>
                                <div
                                  className="text-[10px] sm:text-[11px] font-normal text-[#5A6F8C] truncate"
                                  title={wp.projectTitle}
                                >
                                  {wp.projectTitle}
                                </div>
                              </td>
                            );
                          case 'workPlanNo':
                            return (
                              <td key={colKey} className="px-2 py-2 sm:px-2.5 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleRowSelection(wp.id);
                                  }}
                                  aria-expanded={isSelected}
                                  aria-label={`${isSelected ? 'Deselect and collapse' : 'Select and review'} ${wpDisplayLabel}`}
                                  className="inline-flex items-center gap-1 font-mono font-bold text-[#1B3B6F] hover:underline"
                                >
                                  {isSelected ? (
                                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#0B192C]" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#5A6F8C]" />
                                  )}
                                  <span>{wpDisplayLabel}</span>
                                </button>
                              </td>
                            );
                          case 'ticketsApproved':
                            return (
                              <td
                                key={colKey}
                                className="px-2 py-2 sm:px-2.5 text-right font-mono font-semibold tabular-nums text-[#0B192C] whitespace-nowrap"
                              >
                                {summary.ticketsApprovedCount}
                              </td>
                            );
                          case 'ticketsDispensed':
                            return (
                              <td
                                key={colKey}
                                className={`px-2 py-2 sm:px-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                  summary.hasUndispensedApproved
                                    ? 'text-red-700'
                                    : summary.ticketsDispensedCount > 0
                                      ? 'text-emerald-800'
                                      : 'text-[#5A6F8C]'
                                }`}
                              >
                                {summary.ticketsDispensedCount}
                              </td>
                            );
                          case 'dieselApproved':
                            return (
                              <td
                                key={colKey}
                                className="px-2.5 py-2.5 text-right font-mono font-semibold tabular-nums text-[#1B3B6F] whitespace-nowrap"
                              >
                                {summary.totalDieselApproved.toFixed(1)} L
                              </td>
                            );
                          case 'dieselDispensed':
                            return (
                              <td
                                key={colKey}
                                className="px-2.5 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-800 whitespace-nowrap"
                              >
                                {summary.totalDieselDispensed.toFixed(1)} L
                              </td>
                            );
                          case 'gasApproved':
                            return (
                              <td
                                key={colKey}
                                className="px-2.5 py-2.5 text-right font-mono font-semibold tabular-nums text-[#1B3B6F] whitespace-nowrap"
                              >
                                {summary.totalGasApproved.toFixed(1)} L
                              </td>
                            );
                          case 'gasDispensed':
                            return (
                              <td
                                key={colKey}
                                className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-800 whitespace-nowrap"
                              >
                                {summary.totalGasDispensed.toFixed(1)} L
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
        )}
      </section>
    );
  };

  return (
    <div className="space-y-5">
      {/* Work Program Filtering Toolbar (Trip Ticket Status, Work Plan, Mandatory Month & Year) */}
      <div className="space-y-3 rounded-lg border border-[#D5DCE6] bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search work plan no., office, ticket no., or project..."
              aria-label="Search departmental work plans"
              className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] py-2 pl-9 pr-3 text-xs text-[#0B192C] placeholder:text-[#5A6F8C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(hasOptionalFiltersActive || !workProgramResult.valid) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2 text-xs font-semibold text-[#1B3B6F] hover:bg-[#E6EBF2] whitespace-nowrap"
              >
                Reset Filters
              </button>
            )}

            {canRequestSingleTrip && (
              <button
                type="button"
                data-testid="new-single-trip-btn"
                onClick={() => {
                  setRequestMode('single_trip');
                  setSingleExpectedDate(preparationDate);
                  setFormError(null);
                  setAddTicketWarning(null);
                  onOpenModal();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#1B3B6F] bg-white px-3.5 py-2 text-xs font-semibold text-[#1B3B6F] hover:bg-[#EEF2F8] whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                <span>Single Trip Ticket</span>
              </button>
            )}

            <button
              type="button"
              data-testid="new-work-plan-btn"
              onClick={() => {
                setRequestMode('weekly_work_plan');
                setRequestYear(currentSystemYear);
                setWeekStart(preparationDate);
                setWeekEnd(nextWeek);
                setFormError(null);
                setAddTicketWarning(null);
                onOpenModal();
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>New Work Plan</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-[#E6EBF2] pt-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <label
              htmlFor="wp-filter-month"
              className={`block text-[11px] font-semibold mb-1 ${
                showMandatoryError && isMonthMissing ? 'text-red-700' : 'text-[#334E73]'
              }`}
            >
              Month (Mandatory) *
            </label>
            <select
              id="wp-filter-month"
              required
              aria-required="true"
              aria-invalid={showMandatoryError && isMonthMissing}
              value={monthFilter}
              onChange={(e) => {
                userAdjustedPeriodRef.current = true;
                setMonthFilter(e.target.value);
                setFilterValidationShown(true);
                setSelectedPlanId(null);
              }}
              className={`w-full rounded-md border px-2.5 py-2 text-xs focus:outline-none ${
                showMandatoryError && isMonthMissing
                  ? 'border-red-600 bg-red-50 text-red-900'
                  : 'border-[#D5DCE6] bg-[#F9FAFC] text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white'
              }`}
            >
              <option value="">Select Month...</option>
              {WORK_PROGRAM_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="wp-filter-year"
              className={`block text-[11px] font-semibold mb-1 ${
                showMandatoryError && isYearMissing ? 'text-red-700' : 'text-[#334E73]'
              }`}
            >
              Year (Mandatory) *
            </label>
            <select
              id="wp-filter-year"
              required
              aria-required="true"
              aria-invalid={showMandatoryError && isYearMissing}
              value={yearFilter}
              onChange={(e) => {
                userAdjustedPeriodRef.current = true;
                setYearFilter(e.target.value);
                setFilterValidationShown(true);
                setSelectedPlanId(null);
              }}
              className={`w-full rounded-md border px-2.5 py-2 font-mono text-xs focus:outline-none ${
                showMandatoryError && isYearMissing
                  ? 'border-red-600 bg-red-50 text-red-900'
                  : 'border-[#D5DCE6] bg-[#F9FAFC] text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white'
              }`}
            >
              <option value="">Select Year...</option>
              {yearOptions.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="wp-filter-work-plan"
              className="block text-[11px] font-semibold text-[#334E73] mb-1"
            >
              Work Plan
            </label>
            <select
              id="wp-filter-work-plan"
              value={workPlanFilter}
              onChange={(e) => {
                setWorkPlanFilter(e.target.value);
                setSelectedPlanId(null);
              }}
              className="w-full rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-2 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            >
              <option value="all">
                {workPlanOptions.length === 0 ? 'No Work Plans in Period' : 'All Work Plans'}
              </option>
              {workPlanOptions.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {getWorkPlanDisplayLabel(wp)} — {getDepartmentMnemonic(wp.department, vehicles)}
                  {wp.requestType === 'single_trip' ? ` (${wp.weekStart})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="wp-filter-ticket-status"
              className="block text-[11px] font-semibold text-[#334E73] mb-1"
            >
              Trip Ticket
            </label>
            <select
              id="wp-filter-ticket-status"
              value={ticketStatusFilter}
              onChange={(e) => {
                setTicketStatusFilter(e.target.value as TripTicketStatus | 'all');
                setSelectedPlanId(null);
              }}
              className="w-full rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-2 text-xs text-[#0B192C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
            >
              {TRIP_TICKET_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showMandatoryError && workProgramResult.validationError && (
          <div
            role="alert"
            data-testid="workplan-mandatory-filter-error"
            className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-red-700" />
            <span>{workProgramResult.validationError}</span>
          </div>
        )}
      </div>

      {/* Preview-Gated Tabular Work Program View (3 Folders) */}
      <RecordsPreviewGate
        title="Departmental Work Program Preview"
        description="Work Program records remain hidden until Preview is pressed. Select a Month and Year with matching records, then click Preview to inspect folders and expand full records."
        recordCount={visibleFolderCount}
        previewOpen={previewOpen}
        onTogglePreview={handleTogglePreview}
        buttonLabel="Preview Work Plans"
        disabled={isPreviewDisabled}
        disabledReason={
          !workProgramResult.valid
            ? workProgramResult.validationError
            : 'Preview is disabled because no Work Plan or Trip Ticket falls under the selected Month and Year.'
        }
      >
        {!workProgramResult.valid ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-center space-y-1.5">
            <AlertCircle className="mx-auto h-6 w-6 text-red-700" />
            <h2 className="font-display text-xs sm:text-sm font-bold text-red-900">
              Mandatory Month and Year Required
            </h2>
            <p className="text-[11px] text-red-800 max-w-md mx-auto">
              {workProgramResult.validationError}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Compact Single-Row Scrollable Folder Navigation Tabs */}
            <div
              className="flex items-center gap-1 overflow-x-auto rounded-lg border border-[#D5DCE6] bg-white p-1.5"
              role="tablist"
              aria-label="Work Program Folders"
            >
              {(
                [
                  {
                    id: 'all',
                    label: `All (${workProgramResult.totalCount})`,
                  },
                  {
                    id: 'approved_dispensed',
                    label: `Done (${workProgramResult.approvedDispensed.length})`,
                  },
                  {
                    id: 'approved_undispensed',
                    label: `Pending Disp (${workProgramResult.approvedWithUndispensed.length})`,
                  },
                  {
                    id: 'pending_approval',
                    label: `For Appr (${workProgramResult.pendingApproval.length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeFolderTab === tab.id}
                  data-testid={`folder-tab-${tab.id}`}
                  onClick={() => {
                    setActiveFolderTab(tab.id);
                    setSelectedPlanId(null);
                    setFullReportDownloadOpen(false);
                  }}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeFolderTab === tab.id
                      ? 'bg-[#0B192C] text-white'
                      : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                  }`}
                >
                  <Folder className="h-3 w-3 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {workProgramResult.totalCount === 0 ? (
              <div className="rounded-lg border border-[#D5DCE6] bg-white p-5 text-center space-y-2">
                <FileText className="mx-auto h-7 w-7 text-[#5A6F8C]" />
                <h2 className="font-display text-sm font-bold text-[#0B192C]">
                  No Work Program records match the selected filters
                </h2>
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1 rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#E6EBF2]"
                  >
                    <span>Reset Filters</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenModal}
                    className="inline-flex items-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>New Work Plan</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {shouldRenderWorkProgramFolder(
                  activeFolderTab,
                  'approved_dispensed',
                  workProgramResult.approvedDispensed.length
                ) &&
                  renderFolderTableSection({
                    folderKey: 'approved_dispensed',
                    title: 'Approved / Dispensed',
                    rows: workProgramResult.approvedDispensed,
                    emptyMessage: 'No fully dispensed work plans for selected filters.',
                    icon: 'dispensed',
                  })}

                {shouldRenderWorkProgramFolder(
                  activeFolderTab,
                  'approved_undispensed',
                  workProgramResult.approvedWithUndispensed.length
                ) &&
                  renderFolderTableSection({
                    folderKey: 'approved_undispensed',
                    title: 'Approved — Undispensed Trips',
                    rows: workProgramResult.approvedWithUndispensed,
                    emptyMessage: 'No approved work plans with undispensed trips.',
                    icon: 'undispensed',
                  })}

                {shouldRenderWorkProgramFolder(
                  activeFolderTab,
                  'pending_approval',
                  workProgramResult.pendingApproval.length
                ) &&
                  renderFolderTableSection({
                    folderKey: 'pending_approval',
                    title: 'Pending Approval',
                    rows: workProgramResult.pendingApproval,
                    emptyMessage: 'No pending approval work plans.',
                    icon: 'pending',
                  })}
              </div>
            )}
          </div>
        )}
      </RecordsPreviewGate>

      {/* Mobile-Optimized Compact Record Display Window (Default on Row Select) */}
      {previewOpen && selectedSummary && !fullReportDownloadOpen && (
        <div
          className="fixed inset-0 z-[45] flex items-center justify-center bg-[#0B192C]/60 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Record Preview ${getWorkPlanDisplayLabel(selectedSummary.workPlan)}`}
        >
          <div className="max-h-[88vh] w-full max-w-[96vw] sm:max-w-md md:max-w-lg overflow-y-auto rounded-lg shadow-2xl">
            {renderCompactMobileRecordPreview(selectedSummary)}
          </div>
        </div>
      )}

      {/* Full Preview Report View — Presented ONLY once Download Report is opted */}
      {previewOpen && selectedSummary && fullReportDownloadOpen && (
        <div
          className="fixed inset-0 z-[50] flex items-center justify-center bg-[#0B192C]/70 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Full Report Preview ${getWorkPlanDisplayLabel(selectedSummary.workPlan)}`}
          data-testid="workplan-full-report-download-modal"
        >
          <div className="max-h-[90vh] w-full max-w-[96vw] sm:max-w-3xl lg:max-w-4xl overflow-y-auto rounded-lg shadow-2xl">
            {renderFullRecordReview(selectedSummary)}
          </div>
        </div>
      )}

      {/* Edit Modal (Permission Gated) */}
      {editingPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Work Plan"
        >
          <div className="w-full max-w-lg rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-[#D5DCE6] pb-3">
              <h2 className="font-display text-base font-bold text-[#0B192C]">
                {editingPlan.requestType === 'single_trip'
                  ? 'Edit Single Request Ticket'
                  : `Edit Work Plan (${getWorkPlanDisplayLabel(editingPlan)})`}
              </h2>
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                aria-label="Close edit dialog"
                className="inline-flex items-center justify-center rounded-md bg-[#0B192C] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label
                  htmlFor="edit-wp-prep-date"
                  className="block text-xs font-semibold text-[#334E73] mb-1"
                >
                  Preparation Date (Pre-Assigned)
                </label>
                <input
                  id="edit-wp-prep-date"
                  type="text"
                  readOnly
                  value={
                    editingPlan.preparationDate ||
                    (editingPlan.createdAt || '').slice(0, 10) ||
                    preparationDate
                  }
                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2 font-mono text-xs font-semibold text-[#1B3B6F]"
                />
              </div>
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
              {requiresWorkPlanSignOffs(editingPlan.requestType) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#334E73] mb-1">
                      Prepared by (Name)
                    </label>
                    <input
                      type="text"
                      value={editPreparedBy}
                      onChange={(e) => setEditPreparedBy(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334E73] mb-1">
                      Prepared by Designation
                    </label>
                    <input
                      type="text"
                      value={editPreparedByDesignation}
                      onChange={(e) => setEditPreparedByDesignation(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334E73] mb-1">
                      Reviewed by (Name)
                    </label>
                    <input
                      type="text"
                      value={editReviewedBy}
                      onChange={(e) => setEditReviewedBy(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334E73] mb-1">
                      Reviewed by Designation
                    </label>
                    <input
                      type="text"
                      value={editReviewedByDesignation}
                      onChange={(e) => setEditReviewedByDesignation(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334E73] mb-1">
                      Department Approver (Name)
                    </label>
                    <input
                      type="text"
                      value={editApprovedBy}
                      onChange={(e) => setEditApprovedBy(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334E73] mb-1">
                      Department Approver Designation
                    </label>
                    <input
                      type="text"
                      value={editApprovedByDesignation}
                      onChange={(e) => setEditApprovedByDesignation(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                    />
                  </div>
                </div>
              )}
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
                  if (!canUserEditWorkPlanRecord(currentUser, editingPlan)) {
                    setEditingPlan(null);
                    return;
                  }
                  const signOffUpdates = requiresWorkPlanSignOffs(editingPlan.requestType)
                    ? {
                        preparedBy: editPreparedBy.trim(),
                        preparedByDesignation: editPreparedByDesignation.trim(),
                        reviewedBy: editReviewedBy.trim(),
                        reviewedByDesignation: editReviewedByDesignation.trim(),
                        approvedBy: editApprovedBy.trim(),
                        approvedByDesignation: editApprovedByDesignation.trim(),
                      }
                    : {};
                  await onUpdateWorkPlanAdmin(editingPlan.id, {
                    projectTitle: editProjectTitle.trim(),
                    ...signOffUpdates,
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
            <div className="flex items-start justify-between gap-4 border-b border-[#D5DCE6] bg-[#0B192C] px-5 py-3.5 text-white">
              <div>
                <h2 className="font-display text-base font-bold">
                  {requestMode === 'single_trip'
                    ? 'New Single Trip Ticket & Fuel Requisition'
                    : 'New Departmental Weekly Work Plan & Fuel Requisition'}
                </h2>
                <p className="text-xs text-slate-300">
                  {requestMode === 'single_trip'
                    ? 'Single Trip Ticket (1 trip only) permitted exclusively when Expected Date is less than 3 days from Preparation Date.'
                    : 'Sequential Work Plan & 7-digit Trip Tickets (max 12 per request). Saving automatically downloads a printable PDF.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseModal}
                aria-label="Close new work plan modal"
                className="inline-flex items-center justify-center rounded-md bg-[#334E73] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {formError && (
                <div
                  role="alert"
                  data-testid="workplan-form-error"
                  className="rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                >
                  {formError}
                </div>
              )}

              {/* Section 1: Work Plan / Single Trip Request Details */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6EBF2] pb-2">
                  <h3 className="font-display text-sm font-bold text-[#0B192C]">
                    01. Department & Requisition Coverage
                  </h3>
                  <div
                    role="group"
                    aria-label="Fuel Request Type"
                    className="inline-flex rounded-md border border-[#D5DCE6] bg-[#F3F5F8] p-0.5 text-xs"
                  >
                    <button
                      type="button"
                      data-testid="mode-weekly-work-plan"
                      aria-pressed={requestMode === 'weekly_work_plan'}
                      onClick={() => handleRequestModeChange('weekly_work_plan')}
                      className={`rounded px-3 py-1 font-semibold transition-colors ${
                        requestMode === 'weekly_work_plan'
                          ? 'bg-[#0B192C] text-white'
                          : 'text-[#334E73] hover:text-[#0B192C]'
                      }`}
                    >
                      Weekly Work Plan
                    </button>
                    {canRequestSingleTrip && (
                      <button
                        type="button"
                        data-testid="mode-single-trip"
                        aria-pressed={requestMode === 'single_trip'}
                        onClick={() => handleRequestModeChange('single_trip')}
                        className={`rounded px-3 py-1 font-semibold transition-colors ${
                          requestMode === 'single_trip'
                            ? 'bg-[#1B3B6F] text-white'
                            : 'text-[#334E73] hover:text-[#0B192C]'
                        }`}
                      >
                        Single Trip Ticket (&lt; 3 Days)
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
                    shouldShowWorkPlanNumberField(requestMode) ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
                  } items-end`}
                >
                  <div>
                    <label htmlFor="wp-dept" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Concerned Office / Dept *
                    </label>
                    <input
                      id="wp-dept"
                      type="text"
                      list={isDepartmentLocked ? undefined : 'wp-dept-list'}
                      readOnly={isDepartmentLocked}
                      required
                      value={isDepartmentLocked ? currentUser.department : department}
                      onChange={(e) => {
                        if (!isDepartmentLocked) setDepartment(e.target.value);
                      }}
                      className={`w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C] ${
                        isDepartmentLocked ? 'bg-[#F3F5F8] font-medium' : 'bg-white'
                      }`}
                    />
                    {!isDepartmentLocked && (
                      <datalist id="wp-dept-list">
                        {BAIS_DEPARTMENTS.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                    )}
                  </div>
                  <div>
                    <label htmlFor="wp-program-year" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Program Year
                    </label>
                    <select
                      id="wp-program-year"
                      value={requestYear}
                      onChange={(e) => handleRequestYearChange(e.target.value)}
                      className="w-full rounded-md border border-[#D5DCE6] bg-white px-3 py-2 font-mono text-xs font-semibold text-[#0B192C] focus:border-[#1B3B6F] focus:outline-none"
                    >
                      {modalYearOptions.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>
                  {shouldShowWorkPlanNumberField(requestMode) && (
                    <div>
                      <label htmlFor="wp-ctrl" className="block text-xs font-semibold text-[#334E73] mb-1">
                        Work Plan No. (Auto)
                      </label>
                      <input
                        id="wp-ctrl"
                        type="text"
                        readOnly
                        value={preAssignedControlNumber}
                        className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2 font-mono text-xs font-bold text-[#1B3B6F]"
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor="wp-prep-date" className="block text-xs font-semibold text-[#334E73] mb-1">
                      Preparation Date (Pre-Assigned)
                    </label>
                    <input
                      id="wp-prep-date"
                      data-testid="wp-preparation-date"
                      type="date"
                      readOnly
                      value={preparationDate}
                      className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2 font-mono text-xs font-bold text-[#1B3B6F]"
                    />
                  </div>
                </div>

                {requestMode === 'single_trip' ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 items-end">
                    <div>
                      <label
                        htmlFor="wp-single-expected-date"
                        className="block text-xs font-semibold text-[#334E73] mb-1"
                      >
                        Expected Trip Date *
                      </label>
                      <input
                        id="wp-single-expected-date"
                        data-testid="single-trip-expected-date"
                        type="date"
                        required
                        min={preparationDate}
                        max={singleTripEval.maxAllowedDate}
                        value={singleExpectedDate}
                        onChange={(e) => handleSingleExpectedDateChange(e.target.value)}
                        className={`w-full rounded-md border px-3 py-2 font-mono text-xs ${
                          singleTripEval.allowed
                            ? 'border-[#D5DCE6] bg-white text-[#0B192C]'
                            : 'border-red-600 bg-red-50 text-red-900'
                        }`}
                      />
                    </div>
                    <div
                      data-testid={
                        singleTripEval.allowed
                          ? 'single-trip-window-status'
                          : 'single-trip-date-alert'
                      }
                      role={singleTripEval.allowed ? 'status' : 'alert'}
                      className={`rounded-md border px-3 py-2 text-xs ${
                        singleTripEval.allowed
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-red-300 bg-red-50 font-semibold text-red-800'
                      }`}
                    >
                      {singleTripEval.allowed ? (
                        <span>
                          Eligible Single Trip Window: <strong>{singleExpectedDate}</strong> (
                          {singleTripEval.daysFromPreparation} day(s) from Preparation Date{' '}
                          {preparationDate}; max allowed {singleTripEval.maxAllowedDate}).
                        </span>
                      ) : (
                        <span>{singleTripEval.reason}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="wp-week-start" className="block text-xs font-semibold text-[#334E73] mb-1">
                          Week Start Date *
                        </label>
                        <input
                          id="wp-week-start"
                          data-testid="wp-week-start-input"
                          type="date"
                          required
                          min={preparationDate}
                          aria-invalid={!weekStartEval.allowed}
                          value={weekStart}
                          onChange={(e) => handleWeekStartChange(e.target.value)}
                          className={`w-full rounded-md border px-3 py-2 font-mono text-xs ${
                            weekStartEval.allowed
                              ? 'border-[#D5DCE6] bg-white text-[#0B192C]'
                              : 'border-red-600 bg-red-50 text-red-900'
                          }`}
                        />
                      </div>
                      <div>
                        <label htmlFor="wp-week-end" className="block text-xs font-semibold text-[#334E73] mb-1">
                          Week End Date *
                        </label>
                        <input
                          id="wp-week-end"
                          data-testid="wp-week-end-input"
                          type="date"
                          required
                          min={weekStart >= preparationDate ? weekStart : preparationDate}
                          value={weekEnd}
                          onChange={(e) => setWeekEnd(e.target.value)}
                          className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
                        />
                      </div>
                    </div>
                    {!weekStartEval.allowed && weekStartEval.reason && (
                      <div
                        role="alert"
                        data-testid="wp-week-start-alert"
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800"
                      >
                        {weekStartEval.reason}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Section 2: Embedded Trip Tickets (Max 12, Distinct 7-Digit Sequence) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#E6EBF2] pb-1.5">
                  <h3 className="font-display text-sm font-bold text-[#0B192C]">
                    {requestMode === 'single_trip'
                      ? '02. Single Trip Ticket (1 Ticket Only)'
                      : `02. Embedded Trip Tickets (${activeTicketDrafts.length} / ${MAX_TICKETS_PER_WORKPLAN} max)`}
                  </h3>
                  <span className="text-[11px] font-medium text-[#5A6F8C]">
                    {requestMode === 'single_trip'
                      ? 'Single Trip request contains 1 trip ticket'
                      : `Max ${MAX_TICKETS_PER_WORKPLAN} trip tickets per work plan`}
                  </span>
                </div>

                {vehicles.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    No vehicles registered in this environment yet. Register fleet units in Fleet Registry first.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeTicketDrafts.map((row, idx) => {
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
                      const fuelTypeDisplay = getVehicleFuelTypeFromRegistry(
                        vehicles,
                        row.vehicleId
                      );
                      const effectiveRowDate =
                        requestMode === 'single_trip' ? singleExpectedDate : row.scheduledDate;
                      const needsPmcRef = requiresPmcRegistryReference(veh?.equipmentClass);
                      const missingFields = getMissingTicketMandatoryFields(
                        {
                          ...row,
                          scheduledDate: effectiveRowDate,
                          depotId: row.depotId || fallbackDepotId,
                        },
                        { aipCodeMandatory: needsPmcRef, pmcReferenceMandatory: needsPmcRef }
                      );
                      const showRed = Boolean(validatedTicketKeys[row.key]);
                      const isMissing = (field: ReturnType<typeof getMissingTicketMandatoryFields>[number]) =>
                        showRed && missingFields.includes(field);
                      const selectedPmcSummary = row.pmcProjectId
                        ? pmcSummaryById.get(row.pmcProjectId)
                        : undefined;
                      const selectedClassLedger =
                        selectedPmcSummary && veh
                          ? veh.fuelType === 'diesel'
                            ? selectedPmcSummary.diesel
                            : selectedPmcSummary.gasoline
                          : undefined;
                      const aggregateDraftLitersForProjectClass =
                        row.pmcProjectId && veh
                          ? activeTicketDrafts.reduce((sum, d) => {
                              const dv = vehicles.find((v) => v.id === d.vehicleId);
                              if (
                                d.pmcProjectId === row.pmcProjectId &&
                                dv?.fuelType === veh.fuelType
                              ) {
                                return sum + Math.max(0, Number(d.requestedLiters) || 0);
                              }
                              return sum;
                            }, 0)
                          : 0;
                      const projectedDraftCostPhp =
                        selectedClassLedger
                          ? Math.round(
                              aggregateDraftLitersForProjectClass *
                                selectedClassLedger.currentPrevailingWacPhp *
                                100
                            ) / 100
                          : 0;
                      const exceedsPmcClassCap = Boolean(
                        selectedClassLedger &&
                          selectedClassLedger.actualDispensedCostPhp +
                            selectedClassLedger.pendingAndApprovedCommittedPhp +
                            projectedDraftCostPhp >
                            selectedClassLedger.capPhp + 0.01
                      );

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
                            {requestMode === 'weekly_work_plan' && activeTicketDrafts.length > 1 && (
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
                                htmlFor={`ticket-vehicle-${row.key}`}
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
                                id={`ticket-vehicle-${row.key}`}
                                data-testid={`ticket-vehicle-select-${idx}`}
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
                                htmlFor={`ticket-driver-${row.key}`}
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
                                id={`ticket-driver-${row.key}`}
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
                                htmlFor={`ticket-fuel-type-${row.key}`}
                                className="block text-[11px] font-semibold text-[#334E73] mb-1"
                              >
                                Fuel Type (Fleet Registry)
                              </label>
                              <input
                                id={`ticket-fuel-type-${row.key}`}
                                data-testid={`ticket-fuel-type-display-${idx}`}
                                type="text"
                                readOnly
                                value={fuelTypeDisplay}
                                placeholder="Select vehicle / equipment first..."
                                className="w-full rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 font-mono text-xs font-bold text-[#1B3B6F] placeholder:font-sans placeholder:font-normal placeholder:text-[#5A6F8C]"
                              />
                            </div>
                          </div>

                          {/* PMC Project Registry Reference (Mandatory for Heavy Equipment & Dump Trucks only) */}
                          <div className="rounded border border-[#D5DCE6] bg-white p-2.5 space-y-2">
                            <div>
                              <label
                                htmlFor={`ticket-pmc-project-${row.key}`}
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('pmcProjectId') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                {needsPmcRef
                                  ? 'PMC Project Registry — AIP & Project Name (Required for Heavy Equipment / Dump Truck) *'
                                  : 'PMC Project Registry — AIP & Project Name (Optional for this vehicle class)'}
                                {isMissing('pmcProjectId') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <select
                                id={`ticket-pmc-project-${row.key}`}
                                data-testid={`ticket-pmc-project-select-${idx}`}
                                required={needsPmcRef}
                                aria-invalid={isMissing('pmcProjectId')}
                                value={row.pmcProjectId}
                                onChange={(e) => handlePmcProjectPick(idx, e.target.value)}
                                className={`w-full rounded border px-2.5 py-1.5 text-xs ${
                                  isMissing('pmcProjectId')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900'
                                    : 'border-[#D5DCE6] bg-[#F9FAFC] text-[#0B192C]'
                                }`}
                              >
                                <option value="">
                                  {needsPmcRef
                                    ? 'Select registered PMC Project (AIP & Project Name)...'
                                    : 'None (Optional — select to charge against a PMC Project)'}
                                </option>
                                {normalizedPmcProjects.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    [{p.aipCode}] {p.projectName} (FY {p.approvalYear} ·{' '}
                                    {getDepartmentMnemonic(p.department, vehicles)})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {selectedPmcSummary && selectedClassLedger && veh && (
                              <div
                                data-testid={`ticket-pmc-cap-status-${idx}`}
                                data-over-cap={exceedsPmcClassCap ? 'true' : 'false'}
                                className={`rounded border px-2.5 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                                  exceedsPmcClassCap
                                    ? 'border-red-400 bg-red-50 text-red-900'
                                    : 'border-[#C5D1E3] bg-[#EEF2F8] text-[#0B192C]'
                                }`}
                              >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
                                  <span className="font-bold uppercase">
                                    {veh.fuelType} POW Cap: ₱
                                    {selectedClassLedger.capPhp.toLocaleString('en-PH', {
                                      minimumFractionDigits: 2,
                                    })}
                                  </span>
                                  <span>
                                    Running Bal: ₱
                                    {selectedClassLedger.runningBalancePhp.toLocaleString('en-PH', {
                                      minimumFractionDigits: 2,
                                    })}
                                  </span>
                                  <span>
                                    Committed: ₱
                                    {selectedClassLedger.pendingAndApprovedCommittedPhp.toLocaleString(
                                      'en-PH',
                                      { minimumFractionDigits: 2 }
                                    )}
                                  </span>
                                  <span>
                                    This Draft ({aggregateDraftLitersForProjectClass.toFixed(1)} L @ ₱
                                    {selectedClassLedger.currentPrevailingWacPhp.toFixed(2)}): ₱
                                    {projectedDraftCostPhp.toLocaleString('en-PH', {
                                      minimumFractionDigits: 2,
                                    })}
                                  </span>
                                </div>
                                <span
                                  className={`font-bold ${
                                    exceedsPmcClassCap ? 'text-red-800' : 'text-emerald-800'
                                  }`}
                                >
                                  {exceedsPmcClassCap
                                    ? 'EXCEEDS PROJECT FUEL CAP'
                                    : `Avail: ₱${Math.max(0, selectedClassLedger.availableForNewRequestPhp - projectedDraftCostPhp).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                            <div>
                              <label
                                htmlFor={`ticket-purpose-${row.key}`}
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
                                id={`ticket-purpose-${row.key}`}
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
                                htmlFor={`ticket-aip-code-${row.key}`}
                                className={`block text-[11px] font-semibold mb-1 ${
                                  isMissing('projectAip') ? 'text-red-700' : 'text-[#334E73]'
                                }`}
                              >
                                {needsPmcRef ? 'AIP Code (PMC Registry) *' : 'AIP Code (Optional)'}
                                {isMissing('projectAip') && (
                                  <span className="ml-1 font-bold text-red-700">(Required)</span>
                                )}
                              </label>
                              <input
                                id={`ticket-aip-code-${row.key}`}
                                data-testid={`ticket-aip-code-input-${idx}`}
                                type="text"
                                required={needsPmcRef}
                                readOnly={Boolean(row.pmcProjectId)}
                                maxLength={160}
                                aria-invalid={isMissing('projectAip')}
                                placeholder={
                                  needsPmcRef
                                    ? 'Auto-filled from PMC Registry'
                                    : 'Optional (required for Heavy Eq. / Dump Truck)'
                                }
                                value={row.projectAip}
                                onChange={(e) =>
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, projectAip: e.target.value } : r
                                    )
                                  )
                                }
                                className={`w-full rounded border px-2.5 py-1.5 font-mono text-xs ${
                                  isMissing('projectAip')
                                    ? 'border-red-600 bg-red-50 ring-1 ring-red-500 text-red-900 placeholder:text-red-400'
                                    : row.pmcProjectId
                                      ? 'border-[#C5D1E3] bg-[#EEF2F8] font-bold text-[#1B3B6F]'
                                      : 'border-[#D5DCE6] bg-white text-[#0B192C]'
                                }`}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`ticket-destination-${row.key}`}
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
                                id={`ticket-destination-${row.key}`}
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
                                readOnly={requestMode === 'single_trip'}
                                min={
                                  requestMode === 'single_trip'
                                    ? preparationDate
                                    : weekStart >= preparationDate
                                      ? weekStart
                                      : preparationDate
                                }
                                aria-invalid={isMissing('scheduledDate')}
                                value={effectiveRowDate}
                                onChange={(e) => {
                                  if (requestMode === 'single_trip') return;
                                  setTicketDrafts((prev) =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, scheduledDate: e.target.value } : r
                                    )
                                  );
                                }}
                                className={`w-full rounded border px-2.5 py-1.5 font-mono text-xs ${
                                  requestMode === 'single_trip'
                                    ? 'border-[#D5DCE6] bg-[#F3F5F8] text-[#1B3B6F] font-semibold'
                                    : isMissing('scheduledDate')
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
                                data-testid={`ticket-requested-liters-${idx}`}
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
                    {requestMode === 'weekly_work_plan' && (
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
                          {!allExistingTicketsComplete && activeTicketDrafts.length < MAX_TICKETS_PER_WORKPLAN && (
                            <span className="text-[11px] font-medium text-[#5A6F8C]">
                              Fill all mandatory (*) fields of the current ticket to activate
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={activeTicketDrafts.length >= MAX_TICKETS_PER_WORKPLAN}
                            data-activated={
                              allExistingTicketsComplete &&
                              activeTicketDrafts.length < MAX_TICKETS_PER_WORKPLAN
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
                              Add Trip Ticket ({activeTicketDrafts.length}/{MAX_TICKETS_PER_WORKPLAN})
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Section 3: Mandatory Sign-Offs & Designations (Weekly Work Plan only) */}
              {requiresWorkPlanSignOffs(requestMode) && (
                <div data-testid="workplan-mandatory-signoffs-section" className="space-y-3">
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
                        Department Approver (Name) *
                      </label>
                      <input
                        id="wp-app"
                        type="text"
                        required
                        placeholder="e.g. Engr. Danilo Villanueva"
                        value={approvedBy}
                        onChange={(e) => setApprovedBy(e.target.value)}
                        className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                      />
                    </div>
                    <div>
                      <label htmlFor="wp-app-desig" className="block text-xs font-semibold text-[#334E73] mb-1">
                        Department Approver Designation *
                      </label>
                      <input
                        id="wp-app-desig"
                        type="text"
                        required
                        placeholder="e.g. Department Head / City Engineer"
                        value={approvedByDesignation}
                        onChange={(e) => setApprovedByDesignation(e.target.value)}
                        className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
                      />
                    </div>
                  </div>
                </div>
              )}
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
                disabled={
                  submitting ||
                  (requestMode === 'single_trip' && !singleTripEval.allowed) ||
                  (requestMode === 'weekly_work_plan' && (!weekStartEval.allowed || weekEnd < weekStart))
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                <span>
                  {submitting
                    ? 'Saving & Generating PDF...'
                    : requestMode === 'single_trip'
                      ? 'Save Single Trip Ticket & Download PDF'
                      : 'Save Work Plan & Download PDF'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
