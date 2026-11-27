import {
  AuditLog,
  AuditLogCategory,
  BAIS_DEPARTMENT_MNEMONICS,
  BAIS_DEPARTMENTS,
  DailyReconciliationSummary,
  DiscrepancyAlert,
  EfficiencyUnit,
  EnvironmentMode,
  EquipmentClass,
  EQUIPMENT_CLASS_SPECS,
  FleetVehicle,
  FuelClassLedgerMovement,
  FuelClassLedgerRow,
  FuelClassLedgerSummary,
  FuelDepot,
  FuelType,
  InventoryLog,
  InventoryTransactionType,
  NavSection,
  PmcProject,
  ReportFieldConfigItem,
  ReportUtilitiesConfig,
  ReportUtilitiesTargetKey,
  ROLE_LABELS,
  StorageTank,
  TankLedgerWacSnapshot,
  TripTicket,
  TripTicketStatus,
  UserAccount,
  UserRole,
  WorkPlan,
  WorkPlanReportLayoutVariant,
} from '../types/fuel';

export const MAX_TICKETS_PER_WORKPLAN = 12;
export const INACTIVE_WORKPLAN_DAYS = 30;

export interface FuelLimitCalculation {
  computedLimitLiters: number;
  exceedsComputedLimit: boolean;
  exceedsWeeklyCap: boolean;
  effectiveCapLiters: number;
  basisDescription: string;
}

/**
 * Automatically calculates allowable fuel limit per vehicle type, heavy equipment class,
 * or fuel-powered tool for both Gasoline and Diesel.
 */
export function calculateFuelLimit(params: {
  equipmentClass: EquipmentClass;
  fuelType: FuelType;
  efficiencyRate?: number;
  efficiencyUnit?: EfficiencyUnit;
  estimatedUsage: number;
  maxWeeklyLiters?: number;
  terrainFactor?: number;
}): FuelLimitCalculation {
  const spec = EQUIPMENT_CLASS_SPECS[params.equipmentClass];
  const unit = params.efficiencyUnit ?? spec.defaultUnit;
  const rate =
    params.efficiencyRate && params.efficiencyRate > 0
      ? params.efficiencyRate
      : params.fuelType === 'diesel'
        ? spec.defaultDieselRate
        : spec.defaultGasolineRate;
  const maxWeekly =
    params.maxWeeklyLiters && params.maxWeeklyLiters > 0
      ? params.maxWeeklyLiters
      : spec.defaultMaxWeeklyLiters;
  const terrain = params.terrainFactor && params.terrainFactor >= 0.8 ? params.terrainFactor : 1.0;
  const usage = Math.max(0, params.estimatedUsage);

  let rawLiters = 0;
  let basisDescription = '';

  if (unit === 'km_per_liter') {
    rawLiters = (usage / rate) * terrain;
    basisDescription = `${usage.toFixed(0)} km / ${rate.toFixed(1)} km/L × ${terrain.toFixed(2)} load`;
  } else {
    rawLiters = usage * rate * terrain;
    basisDescription = `${usage.toFixed(1)} hrs × ${rate.toFixed(1)} L/hr × ${terrain.toFixed(2)} load`;
  }

  // Round to nearest 0.5 L with a minimum operational buffer of 2 L when usage > 0
  const rounded = usage > 0 ? Math.max(2, Math.round(rawLiters * 2) / 2) : 0;
  const effectiveCap = Math.min(rounded, maxWeekly);

  return {
    computedLimitLiters: rounded,
    exceedsComputedLimit: false,
    exceedsWeeklyCap: rounded > maxWeekly,
    effectiveCapLiters: effectiveCap,
    basisDescription,
  };
}

export function evaluateRequestedLitersAgainstVehicle(
  vehicle: FleetVehicle,
  estimatedUsage: number,
  requestedLiters: number,
  terrainFactor = 1.0
): FuelLimitCalculation & { overLimitLiters: number } {
  const calc = calculateFuelLimit({
    equipmentClass: vehicle.equipmentClass,
    fuelType: vehicle.fuelType,
    efficiencyRate: vehicle.efficiencyRate,
    efficiencyUnit: vehicle.efficiencyUnit,
    estimatedUsage,
    maxWeeklyLiters: vehicle.maxWeeklyLiters,
    terrainFactor,
  });

  const overLimitLiters = Math.max(0, Math.round((requestedLiters - calc.effectiveCapLiters) * 10) / 10);
  return {
    ...calc,
    exceedsComputedLimit: requestedLiters > calc.computedLimitLiters,
    exceedsWeeklyCap: requestedLiters > vehicle.maxWeeklyLiters,
    overLimitLiters,
  };
}

export interface TabletopReductionResult {
  approvedLiters: number;
  reductionLiters: number;
  reductionPct: number;
  status: 'approved' | 'reduced' | 'rejected';
}

/**
 * Interactive tabletop approval evaluation: approvers have latitude to reduce
 * requested liters down to 0 based on tabletop assessment.
 */
export function evaluateTabletopApproval(
  requestedLiters: number,
  proposedApprovedLiters: number
): TabletopReductionResult {
  const safeReq = Math.max(0, requestedLiters);
  const clamped = Math.max(0, Math.min(safeReq, Math.round(proposedApprovedLiters * 10) / 10));
  const reductionLiters = Math.max(0, Math.round((safeReq - clamped) * 10) / 10);
  const reductionPct = safeReq > 0 ? Math.round((reductionLiters / safeReq) * 1000) / 10 : 0;

  let status: 'approved' | 'reduced' | 'rejected' = 'approved';
  if (clamped === 0) {
    status = 'rejected';
  } else if (clamped < safeReq) {
    status = 'reduced';
  }

  return {
    approvedLiters: clamped,
    reductionLiters,
    reductionPct,
    status,
  };
}

export interface DispenseOutcome {
  ok: boolean;
  error?: string;
  dispensedLiters: number;
  forfeitedLiters: number;
  newTicketStatus: 'dispensed' | 'forfeited';
  newDepotBalance: number;
  totalCostPhp: number;
}

/**
 * Enforces single-use daily dispensing per approved trip ticket at GSO fuel depot.
 * Any unserved balance is immediately forfeited and invalid.
 */
export function computeSingleDispenseOutcome(params: {
  ticket: TripTicket;
  actualDispensedLiters: number;
  depot: FuelDepot;
}): DispenseOutcome {
  const { ticket, actualDispensedLiters, depot } = params;

  if (ticket.servedOnce) {
    return {
      ok: false,
      error: `Trip ticket ${ticket.ticketNumber} has already been dispensed once. Unserved balances are void.`,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      newTicketStatus: 'dispensed',
      newDepotBalance:
        ticket.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters,
      totalCostPhp: 0,
    };
  }

  if (ticket.status !== 'approved' && ticket.status !== 'reduced') {
    return {
      ok: false,
      error: `Trip ticket ${ticket.ticketNumber} is not duly approved for GSO dispensing.`,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      newTicketStatus: 'forfeited',
      newDepotBalance:
        ticket.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters,
      totalCostPhp: 0,
    };
  }

  const cleanDispense = Math.max(0, Math.round(actualDispensedLiters * 10) / 10);
  if (cleanDispense > ticket.approvedLiters) {
    return {
      ok: false,
      error: `Dispensed liters (${cleanDispense} L) cannot exceed approved limit (${ticket.approvedLiters} L).`,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      newTicketStatus: 'dispensed',
      newDepotBalance:
        ticket.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters,
      totalCostPhp: 0,
    };
  }

  const currentStock =
    ticket.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters;
  const unitPrice =
    ticket.fuelType === 'gasoline' ? depot.gasolinePricePerLiter : depot.dieselPricePerLiter;

  if (cleanDispense > currentStock) {
    return {
      ok: false,
      error: `Insufficient ${ticket.fuelType} inventory at ${depot.name} (${currentStock.toFixed(1)} L available).`,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      newTicketStatus: 'dispensed',
      newDepotBalance: currentStock,
      totalCostPhp: 0,
    };
  }

  const forfeitedLiters = Math.max(0, Math.round((ticket.approvedLiters - cleanDispense) * 10) / 10);
  const newDepotBalance = Math.round((currentStock - cleanDispense) * 10) / 10;
  const totalCostPhp = Math.round(cleanDispense * unitPrice * 100) / 100;

  return {
    ok: true,
    dispensedLiters: cleanDispense,
    forfeitedLiters,
    newTicketStatus: cleanDispense === 0 ? 'forfeited' : 'dispensed',
    newDepotBalance,
    totalCostPhp,
  };
}

/**
 * Computes daily management summary, cost analysis, and automated discrepancy alerts.
 */
export function buildDailyReconciliationReport(params: {
  date: string;
  workPlans: WorkPlan[];
  tickets: TripTicket[];
  depots: FuelDepot[];
  inventoryLogs: InventoryLog[];
}): DailyReconciliationSummary {
  const { date, tickets, depots, inventoryLogs } = params;

  const dayTickets = tickets.filter(
    (t) => !date || t.scheduledDate === date || (t.dispensedAt && t.dispensedAt.startsWith(date))
  );
  const activeSet = dayTickets.length > 0 ? dayTickets : tickets;

  const depotMap = new Map<string, FuelDepot>();
  depots.forEach((d) => depotMap.set(d.id, d));

  let totalRequestedLiters = 0;
  let totalApprovedLiters = 0;
  let totalDispensedLiters = 0;
  let totalForfeitedLiters = 0;
  let gasolineDispensedLiters = 0;
  let dieselDispensedLiters = 0;
  let totalDispensedCostPhp = 0;
  let estimatedSavingsFromReductionsPhp = 0;
  let dispensedTicketsCount = 0;

  const deptAcc = new Map<
    string,
    {
      requestedLiters: number;
      approvedLiters: number;
      dispensedLiters: number;
      forfeitedLiters: number;
      costPhp: number;
    }
  >();

  const alerts: DiscrepancyAlert[] = [];

  for (const ticket of activeSet) {
    const depot = depotMap.get(ticket.depotId);
    const fallbackPrice =
      ticket.fuelType === 'gasoline'
        ? depot?.gasolinePricePerLiter ?? 64.5
        : depot?.dieselPricePerLiter ?? 58.2;
    const unitPrice = ticket.unitPriceAtDispense ?? fallbackPrice;

    totalRequestedLiters += ticket.requestedLiters;
    totalApprovedLiters += ticket.approvedLiters;
    totalDispensedLiters += ticket.dispensedLiters;
    totalForfeitedLiters += ticket.forfeitedLiters;

    const ticketCost = ticket.dispensedLiters * unitPrice;
    totalDispensedCostPhp += ticketCost;

    const reducedLiters = Math.max(0, ticket.requestedLiters - ticket.approvedLiters);
    estimatedSavingsFromReductionsPhp += reducedLiters * fallbackPrice;

    if (ticket.servedOnce) {
      dispensedTicketsCount += 1;
      if (ticket.fuelType === 'gasoline') {
        gasolineDispensedLiters += ticket.dispensedLiters;
      } else {
        dieselDispensedLiters += ticket.dispensedLiters;
      }
    }

    const currDept = deptAcc.get(ticket.department) ?? {
      requestedLiters: 0,
      approvedLiters: 0,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      costPhp: 0,
    };
    currDept.requestedLiters += ticket.requestedLiters;
    currDept.approvedLiters += ticket.approvedLiters;
    currDept.dispensedLiters += ticket.dispensedLiters;
    currDept.forfeitedLiters += ticket.forfeitedLiters;
    currDept.costPhp += ticketCost;
    deptAcc.set(ticket.department, currDept);

    // Automated discrepancy alert: request exceeded computed vehicle/equipment limit
    if (ticket.requestedLiters > ticket.computedLimitLiters * 1.05) {
      alerts.push({
        id: `alert_limit_${ticket.id}`,
        severity: 'medium',
        category: 'over_limit_request',
        title: `Request above computed limit (${ticket.ticketNumber})`,
        detail: `${ticket.plateNumber} requested ${ticket.requestedLiters.toFixed(1)} L vs ${ticket.computedLimitLiters.toFixed(1)} L calculated limit.`,
        department: ticket.department,
        referenceId: ticket.id,
      });
    }

    // Automated discrepancy alert: high forfeited/unserved balance (>20% of approved)
    if (
      ticket.servedOnce &&
      ticket.approvedLiters > 0 &&
      ticket.forfeitedLiters / ticket.approvedLiters >= 0.2
    ) {
      alerts.push({
        id: `alert_forfeit_${ticket.id}`,
        severity: 'high',
        category: 'forfeited_variance',
        title: `High unserved balance forfeited (${ticket.ticketNumber})`,
        detail: `${ticket.forfeitedLiters.toFixed(1)} L of ${ticket.approvedLiters.toFixed(1)} L approved (${Math.round((ticket.forfeitedLiters / ticket.approvedLiters) * 100)}%) went unserved and invalidated.`,
        department: ticket.department,
        referenceId: ticket.id,
      });
    }
  }

  // Depot alerts: low reserve or shrinkage adjustments
  for (const depot of depots) {
    const threshold = depot.reorderThresholdPct ?? 25;
    const gasPct = (depot.gasolineCurrentLiters / depot.gasolineCapacityLiters) * 100;
    const dslPct = (depot.dieselCurrentLiters / depot.dieselCapacityLiters) * 100;

    if (gasPct <= threshold) {
      alerts.push({
        id: `alert_low_gas_${depot.id}`,
        severity: 'high',
        category: 'low_depot_reserve',
        title: `Low Gasoline Reserve: ${depot.name}`,
        detail: `Gasoline tank at ${gasPct.toFixed(1)}% (${depot.gasolineCurrentLiters.toLocaleString()} L remaining).`,
        referenceId: depot.id,
      });
    }
    if (dslPct <= threshold) {
      alerts.push({
        id: `alert_low_dsl_${depot.id}`,
        severity: 'high',
        category: 'low_depot_reserve',
        title: `Low Diesel Reserve: ${depot.name}`,
        detail: `Diesel tank at ${dslPct.toFixed(1)}% (${depot.dieselCurrentLiters.toLocaleString()} L remaining).`,
        referenceId: depot.id,
      });
    }
  }

  for (const log of inventoryLogs) {
    if (log.approvalStatus === 'pending_gso_approval') {
      alerts.push({
        id: `alert_pending_dip_${log.id}`,
        severity: 'medium',
        category: 'pending_dip_verification',
        title: `Pending GSO Verification (${log.referenceNumber})`,
        detail: `${log.depotName} ${log.fuelType} adjustment of ${log.litersDelta > 0 ? '+' : ''}${log.litersDelta.toFixed(1)} L awaits designated GSO digital sign-off.`,
        referenceId: log.id,
      });
    }
    if (
      log.transactionType === 'shrinkage_adjustment' &&
      log.balanceBefore > 0 &&
      Math.abs(log.litersDelta) / log.balanceBefore >= 0.015
    ) {
      alerts.push({
        id: `alert_shrink_${log.id}`,
        severity: 'high',
        category: 'depot_shrinkage',
        title: `Material Tank Shrinkage Detected (${log.depotName})`,
        detail: `Shrinkage of ${Math.abs(log.litersDelta).toFixed(1)} L (${((Math.abs(log.litersDelta) / log.balanceBefore) * 100).toFixed(2)}% of book stock) recorded on ${log.referenceNumber}.`,
        referenceId: log.id,
      });
    }
  }

  const departmentBreakdown = Array.from(deptAcc.entries())
    .map(([department, vals]) => ({
      department,
      requestedLiters: Math.round(vals.requestedLiters * 10) / 10,
      approvedLiters: Math.round(vals.approvedLiters * 10) / 10,
      dispensedLiters: Math.round(vals.dispensedLiters * 10) / 10,
      forfeitedLiters: Math.round(vals.forfeitedLiters * 10) / 10,
      costPhp: Math.round(vals.costPhp * 100) / 100,
    }))
    .sort((a, b) => b.costPhp - a.costPhp);

  return {
    date,
    totalRequestedLiters: Math.round(totalRequestedLiters * 10) / 10,
    totalApprovedLiters: Math.round(totalApprovedLiters * 10) / 10,
    totalDispensedLiters: Math.round(totalDispensedLiters * 10) / 10,
    totalForfeitedLiters: Math.round(totalForfeitedLiters * 10) / 10,
    gasolineDispensedLiters: Math.round(gasolineDispensedLiters * 10) / 10,
    dieselDispensedLiters: Math.round(dieselDispensedLiters * 10) / 10,
    totalDispensedCostPhp: Math.round(totalDispensedCostPhp * 100) / 100,
    estimatedSavingsFromReductionsPhp: Math.round(estimatedSavingsFromReductionsPhp * 100) / 100,
    ticketsCount: activeSet.length,
    dispensedTicketsCount,
    departmentBreakdown,
    alerts,
  };
}

export const SINGLE_REQUEST_TICKET_LABEL = 'Single Request Ticket';

export function getWorkPlanDisplayLabel(
  plan: Pick<WorkPlan, 'requestType' | 'controlNumber'>
): string {
  if (plan.requestType === 'single_trip') {
    return SINGLE_REQUEST_TICKET_LABEL;
  }
  return (plan.controlNumber ?? '').trim() || '—';
}

export interface WorkPlanWeekStartEvaluation {
  allowed: boolean;
  minAllowedDate: string;
  reason?: string;
}

export function evaluateWorkPlanWeekStart(
  preparationDate: string,
  weekStart: string
): WorkPlanWeekStartEvaluation {
  const prep = (preparationDate ?? '').trim() || getLocalIsoDate();
  const start = (weekStart ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return {
      allowed: false,
      minAllowedDate: prep,
      reason: 'Week Start Date is required.',
    };
  }
  if (start < prep) {
    return {
      allowed: false,
      minAllowedDate: prep,
      reason: `Week Start Date (${start}) cannot be earlier than Preparation Date (${prep}). Work plans can only be prepared moving forward.`,
    };
  }
  return {
    allowed: true,
    minAllowedDate: prep,
  };
}

// Sequential Work Plan & 7-Digit Trip Ticket Generators
export function generateNextWorkPlanNumber(existingPlans: WorkPlan[], year = new Date().getFullYear()): string {
  const prefix = `WP-${year}-`;
  let maxSeq = 0;
  let plansInYearCount = 0;
  for (const plan of existingPlans) {
    if (plan.controlNumber.startsWith(prefix)) {
      plansInYearCount += 1;
      const match = plan.controlNumber.match(/(\d+)$/);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }
  const next = Math.max(maxSeq, plansInYearCount) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export function getDynamicProgressiveYearOptions(params?: {
  workPlans?: Array<Pick<WorkPlan, 'controlNumber' | 'weekStart' | 'createdAt'>>;
  tickets?: Array<Pick<TripTicket, 'scheduledDate' | 'createdAt'>>;
  inventoryLogs?: Array<Pick<InventoryLog, 'createdAt' | 'verifiedAt'>>;
  referenceYear?: number;
  yearsAhead?: number;
  extraYears?: Array<string | number>;
  order?: 'asc' | 'desc';
}): string[] {
  const currentYear = params?.referenceYear ?? new Date().getFullYear();
  const safeAhead = Math.max(1, Math.min(20, params?.yearsAhead ?? 5));
  const yearSet = new Set<number>([currentYear]);

  const tryAddYear = (raw?: string | number | null) => {
    if (raw === undefined || raw === null) return;
    const str = String(raw).trim();
    if (/^\d{4}$/.test(str)) {
      const y = Number(str);
      if (y >= 2000 && y <= 2100) yearSet.add(y);
    }
  };

  for (const wp of params?.workPlans ?? []) {
    const wpCodeMatch = wp.controlNumber?.match(/^WP-(\d{4})-/);
    if (wpCodeMatch) tryAddYear(wpCodeMatch[1]);
    if (wp.weekStart) tryAddYear(wp.weekStart.slice(0, 4));
    if (wp.createdAt) tryAddYear(wp.createdAt.slice(0, 4));
  }

  for (const t of params?.tickets ?? []) {
    if (t.scheduledDate) tryAddYear(t.scheduledDate.slice(0, 4));
    if (t.createdAt) tryAddYear(t.createdAt.slice(0, 4));
  }

  for (const log of params?.inventoryLogs ?? []) {
    if (log.createdAt) tryAddYear(log.createdAt.slice(0, 4));
    if (log.verifiedAt) tryAddYear(log.verifiedAt.slice(0, 4));
  }

  for (const extra of params?.extraYears ?? []) {
    tryAddYear(extra);
  }

  let maxYear = currentYear;
  for (const y of yearSet) {
    if (y > maxYear) maxYear = y;
  }

  for (let y = currentYear; y <= maxYear + safeAhead; y++) {
    yearSet.add(y);
  }

  const sorted = Array.from(yearSet).sort((a, b) =>
    params?.order === 'desc' ? b - a : a - b
  );
  return sorted.map((y) => String(y));
}

export function shiftIsoDateToYear(isoDate: string, targetYear: string | number): string {
  const yrStr = String(targetYear).trim();
  if (!/^\d{4}$/.test(yrStr)) return isoDate;
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return `${yrStr}-01-01`;

  const yearNum = Number(yrStr);
  const monthNum = Number(match[2]);
  const dayNum = Number(match[3]);
  const maxDaysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(1, dayNum), maxDaysInMonth);
  return `${yrStr}-${String(monthNum).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function getLocalIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return dt.toISOString().slice(0, 10);
}

export interface SingleTripWindowEvaluation {
  allowed: boolean;
  daysFromPreparation: number | null;
  maxAllowedDate: string;
  reason?: string;
}

export function evaluateSingleTripTicketWindow(
  preparationDate: string,
  expectedDate: string
): SingleTripWindowEvaluation {
  const prepMatch = preparationDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!prepMatch) {
    return {
      allowed: false,
      daysFromPreparation: null,
      maxAllowedDate: preparationDate,
      reason: 'Invalid preparation date.',
    };
  }
  const maxAllowedDate = addDaysIso(preparationDate.trim(), 2);
  const expMatch = expectedDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!expMatch) {
    return {
      allowed: false,
      daysFromPreparation: null,
      maxAllowedDate,
      reason: 'Select a valid expected trip date.',
    };
  }

  const prepUtc = Date.UTC(Number(prepMatch[1]), Number(prepMatch[2]) - 1, Number(prepMatch[3]));
  const expUtc = Date.UTC(Number(expMatch[1]), Number(expMatch[2]) - 1, Number(expMatch[3]));
  const daysFromPreparation = Math.round((expUtc - prepUtc) / 86400000);

  if (daysFromPreparation < 0) {
    return {
      allowed: false,
      daysFromPreparation,
      maxAllowedDate,
      reason: `Expected date (${expectedDate}) cannot be earlier than preparation date (${preparationDate}).`,
    };
  }

  if (daysFromPreparation >= 3) {
    return {
      allowed: false,
      daysFromPreparation,
      maxAllowedDate,
      reason: `Single Trip Ticket is only allowed when expected date is less than 3 days from preparation date (${preparationDate} to ${maxAllowedDate}). Select Weekly Work Plan instead.`,
    };
  }

  return {
    allowed: true,
    daysFromPreparation,
    maxAllowedDate,
  };
}

export function requiresWorkPlanSignOffs(requestType?: WorkPlan['requestType']): boolean {
  return requestType !== 'single_trip';
}

export function shouldShowWorkPlanNumberField(requestType?: WorkPlan['requestType']): boolean {
  return requestType !== 'single_trip';
}

export function shouldDisplayWorkPlanSignOffs(
  wp: Pick<WorkPlan, 'requestType' | 'preparedBy' | 'reviewedBy' | 'approvedBy'>
): boolean {
  if (wp.requestType === 'single_trip') return false;
  return Boolean(wp.preparedBy?.trim() || wp.reviewedBy?.trim() || wp.approvedBy?.trim());
}

export interface WorkPlanDepartmentSignOff {
  key: 'preparedBy' | 'reviewedBy' | 'approvedBy';
  label: string;
  name: string;
  designation: string;
}

/**
 * Returns ONLY the three concerned-department sign-offs (Preparer, Reviewer, and
 * Department Approver) for Work Plan preview displays and PDF downloads.
 * Any legacy/secondary names (e.g., divisionHead, unitLead, sectionManager, or
 * external tabletop approvers) are strictly excluded.
 */
export function getWorkPlanDepartmentSignOffs(
  wp: Pick<
    WorkPlan,
    | 'requestType'
    | 'preparedBy'
    | 'preparedByDesignation'
    | 'reviewedBy'
    | 'reviewedByDesignation'
    | 'approvedBy'
    | 'approvedByDesignation'
  >
): WorkPlanDepartmentSignOff[] {
  if (!shouldDisplayWorkPlanSignOffs(wp)) return [];
  return [
    {
      key: 'preparedBy',
      label: 'Prepared by',
      name: wp.preparedBy?.trim() || '—',
      designation: wp.preparedByDesignation?.trim() || 'Preparer / Focal Person',
    },
    {
      key: 'reviewedBy',
      label: 'Reviewed by',
      name: wp.reviewedBy?.trim() || '—',
      designation: wp.reviewedByDesignation?.trim() || 'Department Reviewer',
    },
    {
      key: 'approvedBy',
      label: 'Department Approver',
      name: wp.approvedBy?.trim() || '—',
      designation: wp.approvedByDesignation?.trim() || 'Department Approver',
    },
  ];
}

export interface WorkPlanSummaryMetricItem {
  key: 'requested' | 'diesel' | 'gasoline' | 'tickets' | 'totalApproved';
  label: string;
  value: string;
  tone: 'default' | 'accent' | 'emerald';
}

/**
 * Computes the non-null fuel & approval summary metrics for a Work Plan Full Report Preview / PDF.
 * - Prior to approval (status === 'pending_approval' or no approved fuel value yet), returns []
 *   so the header and report omit null requested/approved diesel & gas blocks.
 * - Once approved (non-null value), returns only metrics whose values are non-null (> 0),
 *   omitting Diesel or Gasoline portions when that fuel type has 0 approved/dispensed liters.
 */
export function getWorkPlanFullReportSummaryItems(
  wp: Pick<
    WorkPlan,
    'status' | 'totalRequestedLiters' | 'totalApprovedLiters' | 'totalDispensedLiters'
  >,
  planTickets: Pick<TripTicket, 'fuelType' | 'status' | 'approvedLiters' | 'dispensedLiters' | 'servedOnce'>[]
): WorkPlanSummaryMetricItem[] {
  if (wp.status === 'pending_approval') {
    return [];
  }

  let dieselApproved = 0;
  let dieselDispensed = 0;
  let gasApproved = 0;
  let gasDispensed = 0;
  let ticketsApprovedCount = 0;
  let ticketsDispensedCount = 0;

  for (const t of planTickets) {
    const isApprovedTicket = t.status !== 'pending' && t.status !== 'rejected' && t.approvedLiters > 0;
    if (isApprovedTicket) {
      ticketsApprovedCount += 1;
      if (t.fuelType === 'diesel') dieselApproved += t.approvedLiters;
      else gasApproved += t.approvedLiters;
    }
    if (t.servedOnce && t.dispensedLiters > 0) {
      ticketsDispensedCount += 1;
      if (t.fuelType === 'diesel') dieselDispensed += t.dispensedLiters;
      else gasDispensed += t.dispensedLiters;
    }
  }

  const totalApproved =
    wp.totalApprovedLiters > 0 ? wp.totalApprovedLiters : dieselApproved + gasApproved;

  // Still null / zero approved value (e.g., rejected with 0 L approved)
  if (totalApproved <= 0 && dieselApproved <= 0 && gasApproved <= 0 && ticketsApprovedCount === 0) {
    return [];
  }

  const items: WorkPlanSummaryMetricItem[] = [];

  if (wp.totalRequestedLiters > 0) {
    items.push({
      key: 'requested',
      label: 'Requested Fuel',
      value: `${wp.totalRequestedLiters.toFixed(1)} L`,
      tone: 'default',
    });
  }

  if (dieselApproved > 0 || dieselDispensed > 0) {
    items.push({
      key: 'diesel',
      label: 'Diesel Approved / Dispensed',
      value: `${dieselApproved.toFixed(1)} L / ${dieselDispensed.toFixed(1)} L`,
      tone: 'accent',
    });
  }

  if (gasApproved > 0 || gasDispensed > 0) {
    items.push({
      key: 'gasoline',
      label: 'Gasoline Approved / Dispensed',
      value: `${gasApproved.toFixed(1)} L / ${gasDispensed.toFixed(1)} L`,
      tone: 'accent',
    });
  }

  if (ticketsApprovedCount > 0) {
    items.push({
      key: 'tickets',
      label: 'Tickets Approved / Dispensed',
      value: `${ticketsApprovedCount} / ${ticketsDispensedCount}`,
      tone: 'default',
    });
  }

  if (totalApproved > 0) {
    items.push({
      key: 'totalApproved',
      label: 'Total Approved',
      value: `${totalApproved.toFixed(1)} L`,
      tone: 'emerald',
    });
  }

  return items;
}

/**
 * Resolves the section order for Work Plan Full Report Preview & PDF:
 * - Removes `summaryMetrics` when its values are null (prior to approval).
 * - When `summaryMetrics` has non-null values and `tripTicketsTable` is active,
 *   guarantees `summaryMetrics` appears directly BELOW the last trip ticket
 *   (never above it in the report header).
 */
export function getOrderedWorkPlanFullReportSections(
  activeSections: string[],
  hasNonNullSummary: boolean
): string[] {
  const withoutSummary = activeSections.filter((key) => key !== 'summaryMetrics');
  const includeSummary = hasNonNullSummary && activeSections.includes('summaryMetrics');
  if (!includeSummary) {
    return withoutSummary;
  }

  const ticketsIdx = withoutSummary.indexOf('tripTicketsTable');
  if (ticketsIdx >= 0) {
    const result = [...withoutSummary];
    result.splice(ticketsIdx + 1, 0, 'summaryMetrics');
    return result;
  }

  return [...activeSections];
}

export function resolveWorkPlanReportLayoutVariant(
  wp: Pick<WorkPlan, 'status'>,
  explicitVariant?: WorkPlanReportLayoutVariant
): WorkPlanReportLayoutVariant {
  if (explicitVariant) return explicitVariant;
  return wp.status === 'pending_approval' ? 'for_approval' : 'post_approval_monitoring';
}

export function getWorkPlanReportTargetsForVariant(variant: WorkPlanReportLayoutVariant): {
  variant: WorkPlanReportLayoutVariant;
  label: string;
  sectionsTarget: 'workplans_full_review' | 'workplans_monitoring_review';
  ticketColsTarget: 'workplans_review_tickets' | 'workplans_monitoring_tickets';
  includeSignOffs: boolean;
} {
  if (variant === 'for_approval') {
    return {
      variant: 'for_approval',
      label: 'For Approval Layout',
      sectionsTarget: 'workplans_full_review',
      ticketColsTarget: 'workplans_review_tickets',
      includeSignOffs: true,
    };
  }
  return {
    variant: 'post_approval_monitoring',
    label: 'Post-Approval Monitoring Layout',
    sectionsTarget: 'workplans_monitoring_review',
    ticketColsTarget: 'workplans_monitoring_tickets',
    includeSignOffs: false,
  };
}

export function replaceYearInProjectCode(code: string, targetYear: string | number): string {
  const yrStr = String(targetYear).trim();
  if (!/^\d{4}$/.test(yrStr)) return code;
  if (/^([A-Za-z0-9]+-)\d{4}(-.*)?$/.test(code)) {
    return code.replace(/^([A-Za-z0-9]+-)\d{4}(-.*)?$/, `$1${yrStr}$2`);
  }
  return code;
}

export function generateNextTripTicketNumbers(existingTickets: TripTicket[], count: number): string[] {
  let maxSeq = 0;
  for (const t of existingTickets) {
    if (/^\d{7}$/.test(t.ticketNumber.trim())) {
      const num = Number(t.ticketNumber.trim());
      if (Number.isFinite(num) && num > maxSeq) maxSeq = num;
    } else {
      const match = t.ticketNumber.match(/(\d+)$/);
      if (match) {
        const num = Number(match[1]);
        if (Number.isFinite(num) && num > maxSeq && num < 10000000) maxSeq = num;
      }
    }
  }
  const results: string[] = [];
  const safeCount = Math.max(0, Math.min(MAX_TICKETS_PER_WORKPLAN, count));
  for (let i = 1; i <= safeCount; i++) {
    results.push(String(maxSeq + i).padStart(7, '0'));
  }
  return results;
}

export function isWorkPlanInactive(workPlan: WorkPlan, referenceDate = new Date()): boolean {
  if (workPlan.status !== 'pending_approval') return false;
  const anchorIso = workPlan.updatedAt || workPlan.createdAt;
  const anchorMs = Date.parse(anchorIso);
  if (Number.isNaN(anchorMs)) return false;
  const diffDays = (referenceDate.getTime() - anchorMs) / 86400000;
  return diffDays > INACTIVE_WORKPLAN_DAYS;
}

export type ApprovalFolderKey =
  | 'for_approval'
  | 'partially_approved'
  | 'fully_approved'
  | 'inactive';

export interface ApprovalFilterCriteria {
  department?: string;
  month?: string;
  year?: string;
  referenceDate?: Date;
}

export function classifyApprovalFolder(
  wp: WorkPlan,
  planTickets: TripTicket[],
  referenceDate = new Date()
): ApprovalFolderKey | null {
  if (wp.status === 'pending_approval') {
    return isWorkPlanInactive(wp, referenceDate) ? 'inactive' : 'for_approval';
  }
  if (wp.status === 'partially_approved') {
    return 'partially_approved';
  }
  if (wp.status === 'approved' || wp.status === 'completed') {
    const hasPartialTicket = planTickets.some(
      (t) => t.status === 'reduced' || t.status === 'rejected'
    );
    const hasReducedTotal =
      wp.totalRequestedLiters > 0 && wp.totalApprovedLiters < wp.totalRequestedLiters;
    return hasPartialTicket || hasReducedTotal ? 'partially_approved' : 'fully_approved';
  }
  return null;
}

export function categorizeAndFilterApprovals(
  workPlans: WorkPlan[],
  tickets: TripTicket[],
  criteria: ApprovalFilterCriteria = {}
): {
  forApproval: WorkPlan[];
  partiallyApproved: WorkPlan[];
  fullyApproved: WorkPlan[];
  inactive: WorkPlan[];
  filteredTotal: number;
} {
  const deptFilter =
    criteria.department && criteria.department !== 'all'
      ? criteria.department.trim().toLowerCase()
      : '';
  const monthFilter = criteria.month && criteria.month !== 'all' ? criteria.month.trim() : '';
  const yearFilter = criteria.year && criteria.year !== 'all' ? criteria.year.trim() : '';
  const refDate = criteria.referenceDate ?? new Date();

  const sortedPlans = [...workPlans].sort((a, b) => {
    const aMs = Date.parse(a.createdAt || a.weekStart || '');
    const bMs = Date.parse(b.createdAt || b.weekStart || '');
    if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && bMs !== aMs) {
      return bMs - aMs;
    }
    return b.controlNumber.localeCompare(a.controlNumber);
  });

  const forApproval: WorkPlan[] = [];
  const partiallyApproved: WorkPlan[] = [];
  const fullyApproved: WorkPlan[] = [];
  const inactive: WorkPlan[] = [];

  for (const wp of sortedPlans) {
    if (deptFilter && wp.department.trim().toLowerCase() !== deptFilter) {
      continue;
    }
    const dateRef = wp.weekStart || wp.createdAt || '';
    const wpYear = dateRef.slice(0, 4);
    const wpMonth = dateRef.slice(5, 7);
    if (yearFilter && wpYear !== yearFilter) continue;
    if (monthFilter && wpMonth !== monthFilter) continue;

    const planTickets = tickets.filter((t) => t.workPlanId === wp.id);
    const folder = classifyApprovalFolder(wp, planTickets, refDate);
    if (folder === 'for_approval') {
      forApproval.push(wp);
    } else if (folder === 'partially_approved') {
      partiallyApproved.push(wp);
    } else if (folder === 'fully_approved') {
      fullyApproved.push(wp);
    } else if (folder === 'inactive') {
      inactive.push(wp);
    }
  }

  return {
    forApproval,
    partiallyApproved,
    fullyApproved,
    inactive,
    filteredTotal:
      forApproval.length + partiallyApproved.length + fullyApproved.length + inactive.length,
  };
}

export function computeWorkPlanFuelTotals(tickets: TripTicket[]): {
  totalDiesel: number;
  totalGasoline: number;
  ticketCount: number;
} {
  let totalDiesel = 0;
  let totalGasoline = 0;
  for (const t of tickets) {
    if (t.fuelType === 'diesel') totalDiesel += t.requestedLiters;
    else totalGasoline += t.requestedLiters;
  }
  return {
    totalDiesel: Math.round(totalDiesel * 10) / 10,
    totalGasoline: Math.round(totalGasoline * 10) / 10,
    ticketCount: tickets.length,
  };
}

// Synchronous deterministic SHA-256 hex digest (browser & Node safe)
export function sha256Hex(plain: string): string {
  const utf8 = unescape(encodeURIComponent(plain));
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8);
  }
  const bitLen = utf8.length * 8;
  words[bitLen >> 5] |= 0x80 << (24 - (bitLen % 32));
  words[(((bitLen + 64) >> 9) << 4) + 15] = bitLen;

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const w = new Array<number>(64);

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t] | 0;
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export function hashPassword(plain: string): string {
  return sha256Hex(plain);
}

// RBAC Permission Helpers
const ALL_NAV_SECTIONS: NavSection[] = [
  'dashboard',
  'registries',
  'work_plans',
  'approvals',
  'dispensing',
  'inventory',
  'users',
  'reports',
  'audit',
];

export function canAccessFleetRegistry(role: UserRole): boolean {
  return role === 'admin' || role === 'gso_head';
}

export function canRegisterFleetUnit(role: UserRole): boolean {
  return canAccessFleetRegistry(role);
}

export function canAccessPmcProjectRegistry(role: UserRole): boolean {
  return role === 'admin' || role === 'pmc_staff';
}

export function canAccessDepotRegistry(role: UserRole): boolean {
  return role === 'admin' || role === 'gso_head';
}

export function getAllowedRegistrySubTabs(role: UserRole): Array<'fleet' | 'pmc_projects' | 'depot'> {
  const tabs: Array<'fleet' | 'pmc_projects' | 'depot'> = [];
  if (canAccessFleetRegistry(role)) tabs.push('fleet');
  if (canAccessPmcProjectRegistry(role)) tabs.push('pmc_projects');
  if (canAccessDepotRegistry(role)) tabs.push('depot');
  return tabs;
}

export function getAllowedNavSections(role: UserRole): NavSection[] {
  switch (role) {
    case 'admin':
      return [...ALL_NAV_SECTIONS];
    case 'department_head':
    case 'requester':
      return ['work_plans'];
    case 'pmc_staff':
      return ['registries'];
    case 'gso_head':
      return ['dispensing', 'inventory', 'registries'];
    case 'gso_dispenser':
      return ['dispensing', 'inventory'];
    case 'approver':
      return ['approvals'];
    case 'auditor':
      return ['dashboard'];
    default:
      return ['work_plans'];
  }
}

export function canAccessNavSection(role: UserRole, section: NavSection): boolean {
  return getAllowedNavSections(role).includes(section);
}

export function getDefaultNavSection(role: UserRole): NavSection {
  const allowed = getAllowedNavSections(role);
  return allowed[0] ?? 'work_plans';
}

export function canManagePmcProjects(role: UserRole): boolean {
  return canAccessPmcProjectRegistry(role);
}

export function hasCityWideAccess(role: UserRole): boolean {
  return (
    role === 'admin' ||
    role === 'approver' ||
    role === 'gso_head' ||
    role === 'gso_dispenser' ||
    role === 'auditor'
  );
}

export function canAccessDepartmentRecord(
  role: UserRole,
  userDepartment: string,
  recordDepartment: string,
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): boolean {
  if (hasCityWideAccess(role)) return true;
  const uNorm = userDepartment.trim().toLowerCase();
  const rNorm = recordDepartment.trim().toLowerCase();
  if (uNorm === rNorm) return true;
  if (!uNorm || !rNorm) return false;
  return getDepartmentMnemonic(userDepartment, vehicles) === getDepartmentMnemonic(recordDepartment, vehicles);
}

export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}

export function canViewAuditLogs(role: UserRole): boolean {
  return role === 'admin';
}

export function canViewDailyReconciliation(role: UserRole): boolean {
  return role === 'admin';
}

export function canEditOrDeleteRecords(role: UserRole): boolean {
  return role === 'admin';
}

export function canUserEditRecords(user: Pick<UserAccount, 'role' | 'canEdit'>): boolean {
  return user.role === 'admin' || user.canEdit === true;
}

export function canUserDeleteRecords(user: Pick<UserAccount, 'role' | 'canDelete'>): boolean {
  return user.role === 'admin' || user.canDelete === true;
}

export function canUserSwitchToLive(
  user: Pick<UserAccount, 'role' | 'canSwitchToLive'>
): boolean {
  return user.role === 'admin' || user.canSwitchToLive === true;
}

export function canUserRequestSingleTrip(
  user: Pick<UserAccount, 'role' | 'canRequestSingleTrip'>
): boolean {
  return user.role === 'admin' || user.canRequestSingleTrip === true;
}

export function canUserEditWorkPlanRecord(
  user: Pick<UserAccount, 'role' | 'canEdit' | 'canRequestSingleTrip'>,
  wp: Pick<WorkPlan, 'requestType'>
): boolean {
  if (!canUserEditRecords(user)) return false;
  if (wp.requestType === 'single_trip') {
    return canUserRequestSingleTrip(user);
  }
  return true;
}

export function canPreviewAndDownloadPdf(role: UserRole): boolean {
  return role === 'admin' || role === 'approver' || role === 'auditor' || role === 'department_head' || role === 'requester';
}

export function canPerformTabletopApproval(role: UserRole): boolean {
  return role === 'admin' || role === 'approver';
}

export function canDispenseAtGso(role: UserRole): boolean {
  return role === 'admin' || role === 'gso_head' || role === 'gso_dispenser';
}

export function canViewDepotTankRunningBalances(role: UserRole): boolean {
  return role === 'admin' || role === 'gso_head';
}

/**
 * Depot Ledger Register & Verifications access at Depot Inventory & Logs.
 * GSO Depot Dispenser is strictly excluded; only System Administrator and GSO Head may view or verify the Depot Ledger Register.
 */
export function canAccessDepotLedgerRegister(role: UserRole): boolean {
  return role === 'admin' || role === 'gso_head';
}

export const GSO_VERIFICATION_CODE_REGEX = /^[A-Z0-9\-]{4,32}$/;

export function normalizeGsoVerificationCode(raw: string): string {
  return (raw ?? '').trim().toUpperCase();
}

export function generateDistinctGsoVerificationCode(
  existingUsers: ReadonlyArray<Pick<UserAccount, 'gsoVerificationCode'>>
): string {
  const used = new Set(
    existingUsers
      .map((u) => normalizeGsoVerificationCode(u.gsoVerificationCode ?? ''))
      .filter(Boolean)
  );
  const year = new Date().getFullYear().toString().slice(-2);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const candidate = `GSO-HD-${year}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  let seq = 1001;
  while (used.has(`GSO-HD-${seq}`)) seq += 1;
  return `GSO-HD-${seq}`;
}

export interface GsoHeadVerificationCodeValidation {
  valid: boolean;
  normalizedCode?: string;
  error?: string;
}

/**
 * Enforces that a GSO Verification Code:
 * 1. Exists ONLY on `gso_head` RBAC accounts (stripped/forbidden for all other roles).
 * 2. Is required when creating or editing a `gso_head` account (4-32 uppercase alphanumeric/hyphen chars).
 * 3. Is strictly distinct/unique across all GSO Head accounts.
 */
export function validateGsoHeadVerificationCode(params: {
  role: UserRole;
  code?: string;
  existingUsers: ReadonlyArray<Pick<UserAccount, 'uid' | 'role' | 'gsoVerificationCode'>>;
  excludeUid?: string;
}): GsoHeadVerificationCodeValidation {
  if (params.role !== 'gso_head') {
    return { valid: true, normalizedCode: undefined };
  }

  const normalized = normalizeGsoVerificationCode(params.code ?? '');
  if (!normalized) {
    return {
      valid: false,
      error: 'GSO Head Verification Code is required for GSO Head accounts.',
    };
  }
  if (!GSO_VERIFICATION_CODE_REGEX.test(normalized)) {
    return {
      valid: false,
      error:
        'GSO Head Verification Code must be 4–32 characters using only letters (A–Z), numbers (0–9), and hyphens (-).',
    };
  }

  const duplicate = params.existingUsers.find((u) => {
    if (params.excludeUid && u.uid === params.excludeUid) return false;
    const otherCode = normalizeGsoVerificationCode(u.gsoVerificationCode ?? '');
    return otherCode !== '' && otherCode === normalized;
  });
  if (duplicate) {
    return {
      valid: false,
      error: `GSO Head Verification Code "${normalized}" is already assigned to another GSO Head account. Please assign a distinct code.`,
    };
  }

  return { valid: true, normalizedCode: normalized };
}

export interface GsoHeadCodeMatchResult {
  matched: boolean;
  normalizedCode: string;
  gsoHead?: Pick<UserAccount, 'uid' | 'displayName' | 'role' | 'active' | 'gsoVerificationCode'>;
  error?: string;
}

/**
 * Matches an entered verification code strictly against active GSO Head RBAC accounts' distinct verification codes.
 */
export function matchGsoHeadVerificationCode(
  rawCode: string,
  users: ReadonlyArray<Pick<UserAccount, 'uid' | 'displayName' | 'role' | 'active' | 'gsoVerificationCode'>>
): GsoHeadCodeMatchResult {
  const normalizedCode = normalizeGsoVerificationCode(rawCode);
  if (!normalizedCode || !GSO_VERIFICATION_CODE_REGEX.test(normalizedCode)) {
    return {
      matched: false,
      normalizedCode,
      error: 'Enter a valid GSO Head Verification Code (4–32 alphanumeric/hyphen characters).',
    };
  }

  const activeGsoHeads = users.filter(
    (u) => u.role === 'gso_head' && u.active !== false && Boolean(normalizeGsoVerificationCode(u.gsoVerificationCode ?? ''))
  );
  if (activeGsoHeads.length === 0) {
    return {
      matched: false,
      normalizedCode,
      error:
        'No active GSO Head account has a distinct verification code assigned yet. Assign one under User Creation & RBAC.',
    };
  }

  const found = activeGsoHeads.find(
    (u) => normalizeGsoVerificationCode(u.gsoVerificationCode ?? '') === normalizedCode
  );
  if (!found) {
    return {
      matched: false,
      normalizedCode,
      error:
        'Invalid GSO Head Verification Code. Only the distinct code assigned to an active GSO Head account is accepted.',
    };
  }

  return {
    matched: true,
    normalizedCode,
    gsoHead: found,
  };
}

export function canPreviewDispensingFullRecord(role: UserRole): boolean {
  return (
    role === 'admin' ||
    role === 'gso_head' ||
    role === 'gso_dispenser' ||
    role === 'approver' ||
    role === 'auditor'
  );
}

export function canExportDispensingRecords(role: UserRole): boolean {
  return (
    role === 'admin' ||
    role === 'gso_head' ||
    role === 'approver' ||
    role === 'auditor'
  );
}

export interface VehicleFilterCriteria {
  search?: string;
  office?: string;
  equipmentClass?: EquipmentClass | 'all';
  fuelType?: FuelType | 'all';
  status?: FleetVehicle['status'] | 'all';
}

export function filterVehiclesForTicket(
  vehicles: FleetVehicle[],
  criteria: VehicleFilterCriteria
): FleetVehicle[] {
  const q = (criteria.search ?? '').trim().toLowerCase();
  const office = criteria.office && criteria.office !== 'all' ? criteria.office.trim().toLowerCase() : '';
  const eqClass = criteria.equipmentClass && criteria.equipmentClass !== 'all' ? criteria.equipmentClass : '';
  const fuel = criteria.fuelType && criteria.fuelType !== 'all' ? criteria.fuelType : '';
  const status = criteria.status && criteria.status !== 'all' ? criteria.status : '';

  return vehicles.filter((v) => {
    if (office && v.office.trim().toLowerCase() !== office) return false;
    if (eqClass && v.equipmentClass !== eqClass) return false;
    if (fuel && v.fuelType !== fuel) return false;
    if (status && v.status !== status) return false;
    if (q) {
      const hay = `${v.plateNumber} ${v.makeModel} ${v.chassisNumber} ${v.office}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getVehicleFuelTypeFromRegistry(
  vehicles: FleetVehicle[],
  vehicleId: string
): string {
  const id = vehicleId.trim();
  if (!id) return '';
  const match = vehicles.find((v) => v.id === id);
  if (!match) return '';
  return match.fuelType === 'diesel' ? 'DIESEL' : 'GASOLINE';
}

export function formatWorkPlanPreparedTimestamp(
  plan: Pick<WorkPlan, 'preparationDate' | 'createdAt'>,
  locale = 'en-PH'
): string {
  const rawCreated = (plan.createdAt ?? '').trim();
  const rawPrep = (plan.preparationDate ?? '').trim();
  const parsedCreated = rawCreated ? new Date(rawCreated) : null;
  const hasValidCreated = Boolean(parsedCreated && !Number.isNaN(parsedCreated.getTime()));
  const prepMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawPrep);

  if (hasValidCreated && parsedCreated) {
    const targetDate = prepMatch
      ? new Date(
          Number(prepMatch[1]),
          Number(prepMatch[2]) - 1,
          Number(prepMatch[3]),
          parsedCreated.getHours(),
          parsedCreated.getMinutes(),
          parsedCreated.getSeconds()
        )
      : parsedCreated;
    return targetDate.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (prepMatch) {
    const dateOnly = new Date(
      Number(prepMatch[1]),
      Number(prepMatch[2]) - 1,
      Number(prepMatch[3])
    );
    return dateOnly.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  }

  return rawPrep || rawCreated || getLocalIsoDate();
}

export function getVehicleClassificationLabel(
  vehicles: Array<Pick<FleetVehicle, 'id' | 'plateNumber' | 'equipmentClass'>>,
  ticket: Pick<TripTicket, 'vehicleId' | 'plateNumber'>
): string {
  const id = (ticket.vehicleId ?? '').trim();
  const normalizedPlate = (ticket.plateNumber ?? '').trim().toUpperCase();
  const match =
    (id ? vehicles.find((v) => v.id === id) : undefined) ??
    (normalizedPlate
      ? vehicles.find((v) => v.plateNumber.trim().toUpperCase() === normalizedPlate)
      : undefined);
  if (!match) return 'Unclassified';
  return EQUIPMENT_CLASS_SPECS[match.equipmentClass]?.label ?? 'Unclassified';
}

export function getWorkPlanVehicleClassifications(
  planTickets: Array<Pick<TripTicket, 'vehicleId' | 'plateNumber'>>,
  vehicles: Array<Pick<FleetVehicle, 'id' | 'plateNumber' | 'equipmentClass'>>
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const ticket of planTickets) {
    const label = getVehicleClassificationLabel(vehicles, ticket);
    if (!seen.has(label)) {
      seen.add(label);
      ordered.push(label);
    }
  }
  return ordered;
}

export type TicketMandatoryField =
  | 'vehicleId'
  | 'driverName'
  | 'depotId'
  | 'pmcProjectId'
  | 'purposeOrProject'
  | 'projectAip'
  | 'destination'
  | 'scheduledDate'
  | 'requestedLiters';

export interface TicketMandatoryCheckInput {
  vehicleId: string;
  driverName: string;
  depotId: string;
  pmcProjectId?: string;
  purposeOrProject: string;
  projectAip?: string;
  destination: string;
  scheduledDate: string;
  requestedLiters: number;
}

/**
 * Only Heavy Equipment and Dump Trucks trip tickets require mandatory referencing
 * from the PMC Project Registry (AIP Code & Project Name).
 */
export function requiresPmcRegistryReference(equipmentClass?: EquipmentClass | null): boolean {
  return equipmentClass === 'heavy_equipment' || equipmentClass === 'dump_truck';
}

export function isProjectAipOptionalDepartment(department?: string | null): boolean {
  const normalized = (department ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    normalized === "city mayor's office" ||
    normalized === 'city mayors office' ||
    normalized === 'cmo'
  );
}

export function isAipCodeMandatory(role: UserRole, department?: string | null): boolean {
  if (role === 'requester' && isProjectAipOptionalDepartment(department)) {
    return false;
  }
  return true;
}

export function getMissingTicketMandatoryFields(
  ticket: TicketMandatoryCheckInput,
  options?: {
    projectAipOptional?: boolean;
    aipCodeMandatory?: boolean;
    pmcReferenceMandatory?: boolean;
  }
): TicketMandatoryField[] {
  const requirePmcRef = Boolean(options?.pmcReferenceMandatory);
  const requireAip =
    requirePmcRef ||
    (options?.aipCodeMandatory !== undefined
      ? options.aipCodeMandatory
      : !options?.projectAipOptional);
  const missing: TicketMandatoryField[] = [];
  if (!ticket.vehicleId || !ticket.vehicleId.trim()) missing.push('vehicleId');
  if (!ticket.driverName || !ticket.driverName.trim()) missing.push('driverName');
  if (!ticket.depotId || !ticket.depotId.trim()) missing.push('depotId');
  if (requirePmcRef && (!ticket.pmcProjectId || !ticket.pmcProjectId.trim())) {
    missing.push('pmcProjectId');
  }
  if (!ticket.purposeOrProject || !ticket.purposeOrProject.trim()) missing.push('purposeOrProject');
  if (requireAip && (!ticket.projectAip || !ticket.projectAip.trim())) {
    missing.push('projectAip');
  }
  if (!ticket.destination || !ticket.destination.trim()) missing.push('destination');
  if (!ticket.scheduledDate || !ticket.scheduledDate.trim()) missing.push('scheduledDate');
  if (!Number.isFinite(ticket.requestedLiters) || ticket.requestedLiters <= 0) {
    missing.push('requestedLiters');
  }
  return missing;
}

export interface ApprovedWorkPlanSummary {
  workPlan: WorkPlan;
  planTickets: TripTicket[];
  approvedLiters: number;
  dispensedLiters: number;
  undispensedTicketCount: number;
  undispensedApprovedLiters: number;
  hasUndispensedApproved: boolean;
}

export function categorizeDepartmentWorkPlans(
  workPlans: WorkPlan[],
  tickets: TripTicket[]
): {
  pending: Array<{ workPlan: WorkPlan; planTickets: TripTicket[] }>;
  approved: ApprovedWorkPlanSummary[];
} {
  const pending: Array<{ workPlan: WorkPlan; planTickets: TripTicket[] }> = [];
  const approved: ApprovedWorkPlanSummary[] = [];

  for (const wp of workPlans) {
    const planTickets = tickets.filter((t) => t.workPlanId === wp.id);
    if (wp.status === 'pending_approval') {
      pending.push({ workPlan: wp, planTickets });
    } else if (
      wp.status === 'approved' ||
      wp.status === 'partially_approved' ||
      wp.status === 'completed'
    ) {
      const undispensedTickets = planTickets.filter(
        (t) =>
          (t.status === 'approved' || t.status === 'reduced') &&
          t.approvedLiters > 0 &&
          !t.servedOnce
      );
      const undispensedApprovedLiters =
        Math.round(
          undispensedTickets.reduce((sum, t) => sum + t.approvedLiters, 0) * 10
        ) / 10;

      approved.push({
        workPlan: wp,
        planTickets,
        approvedLiters: wp.totalApprovedLiters,
        dispensedLiters: wp.totalDispensedLiters,
        undispensedTicketCount: undispensedTickets.length,
        undispensedApprovedLiters,
        hasUndispensedApproved: undispensedTickets.length > 0,
      });
    }
  }

  return { pending, approved };
}

export type WorkProgramFolderKey =
  | 'approved_dispensed'
  | 'pending_approval'
  | 'approved_undispensed';

export interface WorkProgramFilterCriteria {
  searchQuery?: string;
  ticketStatus?: TripTicketStatus | 'all';
  workPlanId?: string;
  month: string;
  year: string;
}

export interface WorkProgramRowSummary {
  workPlan: WorkPlan;
  planTickets: TripTicket[];
  folder: WorkProgramFolderKey;
  ticketsApprovedCount: number;
  ticketsDispensedCount: number;
  pendingTicketCount: number;
  undispensedTicketCount: number;
  undispensedApprovedLiters: number;
  hasUndispensedApproved: boolean;
  totalDieselApproved: number;
  totalDieselDispensed: number;
  totalGasApproved: number;
  totalGasDispensed: number;
}

export interface WorkProgramFilterValidation {
  valid: boolean;
  missingFields: Array<'month' | 'year'>;
  error?: string;
}

export function validateWorkProgramMandatoryFilters(criteria: {
  month?: string;
  year?: string;
}): WorkProgramFilterValidation {
  const missingFields: Array<'month' | 'year'> = [];
  const cleanMonth = criteria.month?.trim() ?? '';
  if (!cleanMonth || (cleanMonth !== 'all' && !/^(0[1-9]|1[0-2])$/.test(cleanMonth))) {
    missingFields.push('month');
  }
  if (!criteria.year || !/^\d{4}$/.test(criteria.year.trim())) {
    missingFields.push('year');
  }

  if (missingFields.length === 0) {
    return { valid: true, missingFields: [] };
  }

  const label =
    missingFields.length === 2
      ? 'Month and Year'
      : missingFields[0] === 'month'
        ? 'Month'
        : 'Year';

  return {
    valid: false,
    missingFields,
    error: `${label} ${missingFields.length === 2 ? 'are' : 'is'} mandatory to preview Work Program records.`,
  };
}

function dateMatchesMonthYear(dateRef: string | undefined, month: string, year: string): boolean {
  if (!dateRef || dateRef.length < 4) return false;
  const yr = dateRef.slice(0, 4);
  if (yr !== year) return false;
  if (month === 'all') return true;
  return dateRef.slice(5, 7) === month;
}

export function doesWorkPlanMatchPeriod(
  wp: Pick<WorkPlan, 'weekStart' | 'createdAt'>,
  planTickets: Array<Pick<TripTicket, 'scheduledDate' | 'createdAt'>>,
  month: string,
  year: string
): boolean {
  const wpDateRef = wp.weekStart || wp.createdAt || '';
  if (dateMatchesMonthYear(wpDateRef, month, year)) return true;
  return planTickets.some((t) =>
    dateMatchesMonthYear(t.scheduledDate || t.createdAt || '', month, year)
  );
}

export function getWorkPlansForPeriod(
  workPlans: WorkPlan[],
  tickets: TripTicket[],
  criteria: { month?: string; year?: string }
): WorkPlan[] {
  const validation = validateWorkProgramMandatoryFilters(criteria);
  if (!validation.valid || !criteria.month || !criteria.year) return [];
  const month = criteria.month.trim();
  const year = criteria.year.trim();

  return workPlans.filter((wp) => {
    const planTickets = tickets.filter((t) => t.workPlanId === wp.id);
    return doesWorkPlanMatchPeriod(wp, planTickets, month, year);
  });
}

export function summarizeWorkProgramRow(
  wp: WorkPlan,
  planTickets: TripTicket[]
): WorkProgramRowSummary | null {
  let ticketsApprovedCount = 0;
  let ticketsDispensedCount = 0;
  let pendingTicketCount = 0;
  let undispensedTicketCount = 0;
  let undispensedApprovedLiters = 0;
  let totalDieselApproved = 0;
  let totalDieselDispensed = 0;
  let totalGasApproved = 0;
  let totalGasDispensed = 0;

  for (const t of planTickets) {
    const isApprovedTicket =
      t.approvedLiters > 0 ||
      t.status === 'approved' ||
      t.status === 'reduced' ||
      t.status === 'dispensed' ||
      t.status === 'forfeited';
    if (isApprovedTicket) {
      ticketsApprovedCount += 1;
    }

    const isDispensedTicket = t.status === 'dispensed' || (t.servedOnce && t.dispensedLiters > 0);
    if (isDispensedTicket) {
      ticketsDispensedCount += 1;
    }

    if (t.status === 'pending') {
      pendingTicketCount += 1;
    }

    const isUndispensedApproved =
      !t.servedOnce &&
      (t.status === 'approved' || t.status === 'reduced') &&
      t.approvedLiters > 0;
    if (isUndispensedApproved) {
      undispensedTicketCount += 1;
      undispensedApprovedLiters += t.approvedLiters;
    }

    if (t.fuelType === 'diesel') {
      totalDieselApproved += t.approvedLiters;
      totalDieselDispensed += t.dispensedLiters;
    } else {
      totalGasApproved += t.approvedLiters;
      totalGasDispensed += t.dispensedLiters;
    }
  }

  let folder: WorkProgramFolderKey | null = null;
  if (wp.status === 'pending_approval') {
    folder = 'pending_approval';
  } else if (
    wp.status === 'approved' ||
    wp.status === 'partially_approved' ||
    wp.status === 'completed'
  ) {
    if (undispensedTicketCount > 0 || pendingTicketCount > 0) {
      folder = 'approved_undispensed';
    } else {
      folder = 'approved_dispensed';
    }
  }

  if (!folder) return null;

  const round1 = (val: number) => Math.round(val * 10) / 10;

  return {
    workPlan: wp,
    planTickets,
    folder,
    ticketsApprovedCount,
    ticketsDispensedCount,
    pendingTicketCount,
    undispensedTicketCount,
    undispensedApprovedLiters: round1(undispensedApprovedLiters),
    hasUndispensedApproved: undispensedTicketCount > 0,
    totalDieselApproved: round1(totalDieselApproved),
    totalDieselDispensed: round1(totalDieselDispensed),
    totalGasApproved: round1(totalGasApproved),
    totalGasDispensed: round1(totalGasDispensed),
  };
}

export function filterAndCategorizeWorkPrograms(
  workPlans: WorkPlan[],
  tickets: TripTicket[],
  criteria: WorkProgramFilterCriteria
): {
  valid: boolean;
  validationError?: string;
  missingFields: Array<'month' | 'year'>;
  approvedDispensed: WorkProgramRowSummary[];
  pendingApproval: WorkProgramRowSummary[];
  approvedWithUndispensed: WorkProgramRowSummary[];
  totalCount: number;
} {
  const validation = validateWorkProgramMandatoryFilters(criteria);
  if (!validation.valid) {
    return {
      valid: false,
      validationError: validation.error,
      missingFields: validation.missingFields,
      approvedDispensed: [],
      pendingApproval: [],
      approvedWithUndispensed: [],
      totalCount: 0,
    };
  }

  const q = (criteria.searchQuery ?? '').trim().toLowerCase();
  const wpFilter = criteria.workPlanId && criteria.workPlanId !== 'all' ? criteria.workPlanId : '';
  const ticketStatusFilter =
    criteria.ticketStatus && criteria.ticketStatus !== 'all' ? criteria.ticketStatus : '';

  const sortedPlans = [...workPlans].sort((a, b) => {
    const aMs = Date.parse(a.createdAt || a.weekStart || '');
    const bMs = Date.parse(b.createdAt || b.weekStart || '');
    if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && bMs !== aMs) {
      return bMs - aMs;
    }
    return b.controlNumber.localeCompare(a.controlNumber);
  });

  const approvedDispensed: WorkProgramRowSummary[] = [];
  const pendingApproval: WorkProgramRowSummary[] = [];
  const approvedWithUndispensed: WorkProgramRowSummary[] = [];

  for (const wp of sortedPlans) {
    if (wpFilter && wp.id !== wpFilter && wp.controlNumber !== wpFilter) {
      continue;
    }

    const planTickets = tickets.filter((t) => t.workPlanId === wp.id);

    if (!doesWorkPlanMatchPeriod(wp, planTickets, criteria.month.trim(), criteria.year.trim())) {
      continue;
    }

    if (ticketStatusFilter && !planTickets.some((t) => t.status === ticketStatusFilter)) {
      continue;
    }

    if (q) {
      const ticketHay = planTickets
        .map((t) => `${t.ticketNumber} ${t.plateNumber} ${t.driverName} ${t.projectAip ?? ''}`)
        .join(' ');
      const haystack =
        `${wp.controlNumber} ${getWorkPlanDisplayLabel(wp)} ${wp.projectTitle} ${wp.department} ${wp.projectCode} ${ticketHay}`.toLowerCase();
      if (!haystack.includes(q)) {
        continue;
      }
    }

    const summary = summarizeWorkProgramRow(wp, planTickets);
    if (!summary) continue;

    if (summary.folder === 'approved_dispensed') {
      approvedDispensed.push(summary);
    } else if (summary.folder === 'pending_approval') {
      pendingApproval.push(summary);
    } else {
      approvedWithUndispensed.push(summary);
    }
  }

  return {
    valid: true,
    missingFields: [],
    approvedDispensed,
    pendingApproval,
    approvedWithUndispensed,
    totalCount:
      approvedDispensed.length + pendingApproval.length + approvedWithUndispensed.length,
  };
}

export function hasValidPumpReadingProof(photoDataUrl?: string | null): boolean {
  if (typeof photoDataUrl !== 'string') return false;
  const trimmed = photoDataUrl.trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{16,}$/.test(trimmed);
}

export interface DispensingTicketViewItem {
  ticket: TripTicket;
  workPlanNumber: string;
}

export interface DispensingFilterCriteria {
  searchQuery?: string;
  fuelType?: FuelType | 'all';
  department?: string;
  month?: string;
  year?: string;
}

function compareCreatedDesc(a: TripTicket, b: TripTicket): number {
  const aMs = Date.parse(a.createdAt || '');
  const bMs = Date.parse(b.createdAt || '');
  if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && bMs !== aMs) {
    return bMs - aMs;
  }
  const strCmp = (b.createdAt || '').localeCompare(a.createdAt || '');
  if (strCmp !== 0) return strCmp;
  return b.ticketNumber.localeCompare(a.ticketNumber);
}

export function categorizeAndFilterDispensingTickets(
  tickets: TripTicket[],
  workPlans: WorkPlan[],
  searchOrCriteria: string | DispensingFilterCriteria = ''
): {
  approved: DispensingTicketViewItem[];
  dispensed: DispensingTicketViewItem[];
  totalApprovedCount: number;
  totalDispensedCount: number;
} {
  const workPlanMap = new Map<string, string>();
  for (const wp of workPlans) {
    workPlanMap.set(wp.id, getWorkPlanDisplayLabel(wp));
  }

  const allApproved: DispensingTicketViewItem[] = [];
  const allDispensed: DispensingTicketViewItem[] = [];

  for (const t of tickets) {
    const workPlanNumber = workPlanMap.get(t.workPlanId) ?? t.workPlanId;
    if (!t.servedOnce && (t.status === 'approved' || t.status === 'reduced') && t.approvedLiters > 0) {
      allApproved.push({ ticket: t, workPlanNumber });
    } else if (t.servedOnce) {
      allDispensed.push({ ticket: t, workPlanNumber });
    }
  }

  // Latest created record always appears topmost in Preview mode
  allApproved.sort((a, b) => compareCreatedDesc(a.ticket, b.ticket));
  allDispensed.sort((a, b) => compareCreatedDesc(a.ticket, b.ticket));

  const criteria: DispensingFilterCriteria =
    typeof searchOrCriteria === 'string'
      ? { searchQuery: searchOrCriteria }
      : searchOrCriteria;

  const q = (criteria.searchQuery ?? '').trim().toLowerCase();
  const fuelFilter = criteria.fuelType && criteria.fuelType !== 'all' ? criteria.fuelType : '';
  const deptFilter =
    criteria.department && criteria.department !== 'all'
      ? criteria.department.trim().toLowerCase()
      : '';
  const monthFilter = criteria.month && criteria.month !== 'all' ? criteria.month : '';
  const yearFilter = criteria.year && criteria.year !== 'all' ? criteria.year : '';

  const matches = ({ ticket, workPlanNumber }: DispensingTicketViewItem): boolean => {
    if (fuelFilter && ticket.fuelType !== fuelFilter) return false;
    if (deptFilter && ticket.department.trim().toLowerCase() !== deptFilter) return false;

    const dateRef = ticket.scheduledDate || ticket.createdAt || '';
    const yr = dateRef.slice(0, 4);
    const mo = dateRef.slice(5, 7);
    if (yearFilter && yr !== yearFilter) return false;
    if (monthFilter && mo !== monthFilter) return false;

    if (q) {
      const haystack = [
        ticket.ticketNumber,
        ticket.gsoTransactionCode ?? '',
        workPlanNumber,
        ticket.plateNumber,
        ticket.driverName,
        ticket.department,
        ticket.purposeOrProject ?? '',
        ticket.projectAip ?? '',
        ticket.projectTitle,
        ticket.destination,
        ticket.fuelType,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  };

  return {
    approved: allApproved.filter(matches),
    dispensed: allDispensed.filter(matches),
    totalApprovedCount: allApproved.length,
    totalDispensedCount: allDispensed.length,
  };
}

function escapeCsvCell(value: string | number | undefined | null): string {
  const raw = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function buildDispensingCsvContent(
  items: DispensingTicketViewItem[],
  depots: FuelDepot[]
): string {
  const depotNameMap = new Map<string, string>();
  for (const d of depots) {
    depotNameMap.set(d.id, d.name);
  }

  const headers = [
    'Ticket Number',
    'Work Plan Number',
    'Category',
    'Department',
    'GSO Transaction Code',
    'Plate Number',
    'Driver Name',
    'Depot',
    'Fuel Type',
    'Fuel Approved (L)',
    'Actual Liters Dispensed (L)',
    'Forfeited Balance (L)',
    'Date Needed',
    'Dispensed Timestamp',
    'Dispensed By',
    'Pump Proof File',
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const { ticket: t, workPlanNumber } of items) {
    const category = t.servedOnce ? 'Dispensed' : 'Approved';
    const row = [
      t.ticketNumber,
      workPlanNumber,
      category,
      t.department,
      t.gsoTransactionCode || 'Pending',
      t.plateNumber,
      t.driverName,
      depotNameMap.get(t.depotId) ?? t.depotId,
      t.fuelType.toUpperCase(),
      t.approvedLiters.toFixed(1),
      t.dispensedLiters.toFixed(1),
      t.forfeitedLiters.toFixed(1),
      t.scheduledDate,
      t.dispensedAt || 'Pending',
      t.dispensedBy || 'Pending',
      t.pumpReadingPhotoName || (t.servedOnce ? 'Baseline Record' : 'Not Uploaded'),
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

export function getGsoTransactionPrefix(
  transactionType: InventoryTransactionType
): 'DS' | 'DL' | 'OV' | 'SH' {
  switch (transactionType) {
    case 'dispense':
      return 'DS';
    case 'delivery':
      return 'DL';
    case 'overage_adjustment':
      return 'OV';
    case 'shrinkage_adjustment':
      return 'SH';
  }
}

export function generateNextGsoTransactionCode(
  transactionType: InventoryTransactionType,
  existingLogs: Array<Pick<InventoryLog, 'gsoTransactionCode'>> = [],
  existingTickets: Array<Pick<TripTicket, 'gsoTransactionCode'>> = []
): string {
  const prefix = getGsoTransactionPrefix(transactionType);
  const pattern = new RegExp(`^${prefix}(\\d{5})$`);
  const usedCodes = new Set<string>();
  let maxSeq = 0;
  let matchingCount = 0;

  const inspect = (code?: string) => {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) return;
    usedCodes.add(clean);
    const match = clean.match(pattern);
    if (match) {
      matchingCount += 1;
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > maxSeq) maxSeq = num;
    }
  };

  for (const log of existingLogs) inspect(log.gsoTransactionCode);
  for (const ticket of existingTickets) inspect(ticket.gsoTransactionCode);

  let next = Math.max(maxSeq, matchingCount) + 1;
  let candidate = `${prefix}${String(next).padStart(5, '0')}`;
  while (usedCodes.has(candidate) && next < 99999) {
    next += 1;
    candidate = `${prefix}${String(next).padStart(5, '0')}`;
  }
  return candidate;
}

export interface DepotTransactionVerificationResolution {
  isVerifiedNow: boolean;
  approvalStatus: 'verified' | 'pending_gso_approval';
  gsoApproverName?: string;
  digitalVerificationCode?: string;
}

/**
 * Resolves verification status for depot ledger transactions.
 * When `requireSeparateGsoApproval` is true (default for pre-delivery dipstick variance
 * adjustments and pre-delivery fuel deliveries), the transaction ALWAYS posts as
 * `pending_gso_approval` so GSO Head must separately verify and approve each record.
 */
export function resolveDepotTransactionVerification(params: {
  transactionType: InventoryTransactionType;
  digitalVerificationCode?: string;
  gsoApproverName?: string;
  actorDisplayName: string;
  gsoTransactionCode: string;
  postImmediately?: boolean;
  requireSeparateGsoApproval?: boolean;
}): DepotTransactionVerificationResolution {
  if (params.requireSeparateGsoApproval) {
    return {
      isVerifiedNow: false,
      approvalStatus: 'pending_gso_approval',
      gsoApproverName: undefined,
      digitalVerificationCode: undefined,
    };
  }

  const manualCode = (params.digitalVerificationCode ?? '').trim().slice(0, 64);
  const hasManualCode = manualCode.length >= 4;
  const shouldPostImmediately = Boolean(params.postImmediately && params.transactionType === 'delivery');

  if (hasManualCode || shouldPostImmediately) {
    const resolvedApprover =
      (params.gsoApproverName ?? '').trim().slice(0, 120) ||
      (params.actorDisplayName || 'GSO Personnel').trim().slice(0, 120);
    const resolvedCode = hasManualCode
      ? manualCode
      : manualCode.length > 0
        ? `DIP-${manualCode}`.slice(0, 64)
        : `DIP-${params.gsoTransactionCode}`.slice(0, 64);
    return {
      isVerifiedNow: true,
      approvalStatus: 'verified',
      gsoApproverName: resolvedApprover,
      digitalVerificationCode: resolvedCode,
    };
  }

  return {
    isVerifiedNow: false,
    approvalStatus: 'pending_gso_approval',
    gsoApproverName: undefined,
    digitalVerificationCode: undefined,
  };
}

export interface PreDeliveryDipVarianceAdjustmentSpec {
  transactionType: 'shrinkage_adjustment' | 'overage_adjustment';
  litersAmount: number;
  signedVarianceLiters: number;
  physicalDipLiters: number;
  bookVolumeLiters: number;
  referenceNumber: string;
  notes: string;
}

/**
 * Pure builder for the separate Pre-Delivery Dipstick Reading vs. Tank Balance Volume
 * adjustment entry. Returns null when physical dip matches book volume (< 0.1 L variance).
 * Always posted separately from the fuel delivery so GSO Head independently verifies each.
 */
export function buildPreDeliveryDipVarianceAdjustment(params: {
  calculatedDipVolumeLiters: number;
  bookVolumeLiters: number;
  tankCode: string;
  bolNumber?: string | null;
  timestampIso?: string;
}): PreDeliveryDipVarianceAdjustmentSpec | null {
  const physicalDipLiters = Math.max(
    0,
    Math.round((Number(params.calculatedDipVolumeLiters) || 0) * 10) / 10
  );
  const bookVolumeLiters = Math.max(
    0,
    Math.round((Number(params.bookVolumeLiters) || 0) * 10) / 10
  );
  const signedVarianceLiters = Math.round((physicalDipLiters - bookVolumeLiters) * 10) / 10;
  if (Math.abs(signedVarianceLiters) < 0.1) {
    return null;
  }

  const transactionType: 'shrinkage_adjustment' | 'overage_adjustment' =
    signedVarianceLiters < 0 ? 'shrinkage_adjustment' : 'overage_adjustment';
  const litersAmount = Math.round(Math.abs(signedVarianceLiters) * 10) / 10;
  const cleanBol = (params.bolNumber ?? '').trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  const cleanTank = (params.tankCode || 'UST').trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  const dateTag = (params.timestampIso || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  const referenceNumber = (
    cleanBol ? `DIP-${cleanBol}` : `DIP-${cleanTank}-${dateTag}`
  ).slice(0, 64);

  const notes =
    `Pre-delivery dipstick variance on ${params.tankCode}${cleanBol ? ` (BOL ${cleanBol})` : ''}: ` +
    `Physical Dip ${physicalDipLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L vs ` +
    `Tank Book ${bookVolumeLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L ` +
    `(${signedVarianceLiters > 0 ? '+' : ''}${signedVarianceLiters.toFixed(1)} L). ` +
    `Posted separately from delivery; requires GSO Head verification approval.`;

  return {
    transactionType,
    litersAmount,
    signedVarianceLiters,
    physicalDipLiters,
    bookVolumeLiters,
    referenceNumber,
    notes: notes.slice(0, 400),
  };
}

export type InventoryDeltaTone = 'delivery' | 'addition' | 'deduction';

export function getInventoryDeltaTone(
  log: Pick<InventoryLog, 'transactionType' | 'litersDelta'>
): InventoryDeltaTone {
  if (log.transactionType === 'delivery') {
    return 'delivery';
  }
  if (log.transactionType === 'overage_adjustment') {
    return 'addition';
  }
  if (log.transactionType === 'shrinkage_adjustment' || log.transactionType === 'dispense') {
    return 'deduction';
  }
  return log.litersDelta >= 0 ? 'addition' : 'deduction';
}

export function getInventoryDeltaColorClass(
  log: Pick<InventoryLog, 'transactionType' | 'litersDelta'>
): string {
  const tone = getInventoryDeltaTone(log);
  if (tone === 'delivery') return 'text-blue-700';
  if (tone === 'addition') return 'text-emerald-700';
  return 'text-red-700';
}

export function resolveInventoryLogDisplayRefs(
  log: Pick<InventoryLog, 'transactionType' | 'tripTicketNumber' | 'referenceNumber'>
): { tripTicketNumber: string; referenceText: string } {
  if (log.transactionType === 'dispense') {
    return {
      tripTicketNumber: (log.tripTicketNumber || log.referenceNumber || '').trim() || '—',
      referenceText: '—',
    };
  }
  return {
    tripTicketNumber: '—',
    referenceText: (log.referenceNumber || '').trim() || '—',
  };
}

export interface InventoryLogFilterCriteria {
  month?: string;
  year?: string;
  fuelType?: FuelType | 'all';
  depotId?: string;
}

export function filterDepotInventoryLogs(
  logs: InventoryLog[],
  criteria: InventoryLogFilterCriteria = {}
): InventoryLog[] {
  const monthFilter = criteria.month && criteria.month !== 'all' ? criteria.month.trim() : '';
  const yearFilter = criteria.year && criteria.year !== 'all' ? criteria.year.trim() : '';
  const fuelFilter = criteria.fuelType && criteria.fuelType !== 'all' ? criteria.fuelType : '';
  const depotFilter = criteria.depotId && criteria.depotId !== 'all' ? criteria.depotId.trim() : '';

  return [...logs]
    .filter((log) => {
      if (fuelFilter && log.fuelType !== fuelFilter) return false;
      if (depotFilter && log.depotId !== depotFilter) return false;
      const dateRef = log.createdAt || '';
      if (yearFilter && dateRef.slice(0, 4) !== yearFilter) return false;
      if (monthFilter && dateRef.slice(5, 7) !== monthFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const aMs = Date.parse(a.createdAt || '');
      const bMs = Date.parse(b.createdAt || '');
      if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && bMs !== aMs) {
        return bMs - aMs;
      }
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}

export type DipstickVarianceStatus = 'overage' | 'shortage' | 'matched';

export interface DipstickEvaluationResult {
  status: DipstickVarianceStatus;
  label: 'Overage' | 'Shortage' | 'Matched';
  dipstickLiters: number;
  expectedBookLiters: number;
  varianceLiters: number;
  textClass: string;
  badgeClass: string;
}

export function evaluateDipstickReading(params: {
  bookStockLiters: number;
  transactionType: InventoryTransactionType;
  litersAmount?: number;
  dipstickLiters: number;
}): DipstickEvaluationResult {
  const safeBook = Math.max(0, Number(params.bookStockLiters) || 0);
  const safeAmount = Math.max(0, Number(params.litersAmount) || 0);
  const safeDip = Math.max(0, Number(params.dipstickLiters) || 0);

  let expectedBookLiters = safeBook;
  if (params.transactionType === 'delivery') {
    expectedBookLiters = Math.round((safeBook + safeAmount) * 10) / 10;
  } else if (params.transactionType === 'dispense') {
    expectedBookLiters = Math.max(0, Math.round((safeBook - safeAmount) * 10) / 10);
  }

  const varianceLiters = Math.round((safeDip - expectedBookLiters) * 10) / 10;

  if (varianceLiters > 0) {
    return {
      status: 'overage',
      label: 'Overage',
      dipstickLiters: safeDip,
      expectedBookLiters,
      varianceLiters,
      textClass: 'text-blue-700',
      badgeClass: 'border-blue-300 bg-blue-50 text-blue-700',
    };
  }

  if (varianceLiters < 0) {
    return {
      status: 'shortage',
      label: 'Shortage',
      dipstickLiters: safeDip,
      expectedBookLiters,
      varianceLiters,
      textClass: 'text-red-700',
      badgeClass: 'border-red-300 bg-red-50 text-red-700',
    };
  }

  return {
    status: 'matched',
    label: 'Matched',
    dipstickLiters: safeDip,
    expectedBookLiters,
    varianceLiters: 0,
    textClass: 'text-[#334E73]',
    badgeClass: 'border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]',
  };
}

export function evaluateInventoryLogDipstick(
  log: Pick<InventoryLog, 'transactionType' | 'balanceBefore' | 'litersDelta' | 'physicalDipLiters'>
): DipstickEvaluationResult | null {
  if (typeof log.physicalDipLiters !== 'number' || !Number.isFinite(log.physicalDipLiters)) {
    return null;
  }

  const isFlowTx = log.transactionType === 'delivery' || log.transactionType === 'dispense';
  const expectedBookLiters = isFlowTx
    ? Math.max(0, Math.round((log.balanceBefore + log.litersDelta) * 10) / 10)
    : Math.max(0, Math.round(log.balanceBefore * 10) / 10);
  const safeDip = Math.max(0, Math.round(log.physicalDipLiters * 10) / 10);
  const varianceLiters = Math.round((safeDip - expectedBookLiters) * 10) / 10;

  if (varianceLiters > 0) {
    return {
      status: 'overage',
      label: 'Overage',
      dipstickLiters: safeDip,
      expectedBookLiters,
      varianceLiters,
      textClass: 'text-blue-700',
      badgeClass: 'border-blue-300 bg-blue-50 text-blue-700',
    };
  }

  if (varianceLiters < 0) {
    return {
      status: 'shortage',
      label: 'Shortage',
      dipstickLiters: safeDip,
      expectedBookLiters,
      varianceLiters,
      textClass: 'text-red-700',
      badgeClass: 'border-red-300 bg-red-50 text-red-700',
    };
  }

  return {
    status: 'matched',
    label: 'Matched',
    dipstickLiters: safeDip,
    expectedBookLiters,
    varianceLiters: 0,
    textClass: 'text-[#334E73]',
    badgeClass: 'border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]',
  };
}

export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

export interface PersistedSessionState {
  uid: string;
  envMode: 'sandbox' | 'live';
  sandboxActiveRole: UserRole;
  sandboxActiveDepartment: string;
  activeSection?: string;
  lastActivityAt: number;
}

export function isSessionExpired(
  lastActivityAt: number,
  nowMs: number,
  timeoutMs: number = INACTIVITY_TIMEOUT_MS
): boolean {
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return true;
  if (!Number.isFinite(nowMs)) return true;
  return nowMs - lastActivityAt >= timeoutMs;
}

export function getRemainingInactivityMs(
  lastActivityAt: number,
  nowMs: number,
  timeoutMs: number = INACTIVITY_TIMEOUT_MS
): number {
  if (isSessionExpired(lastActivityAt, nowMs, timeoutMs)) return 0;
  const elapsed = Math.max(0, nowMs - lastActivityAt);
  return Math.max(0, timeoutMs - elapsed);
}

export function parsePersistedSession(
  raw: string | null,
  nowMs: number,
  timeoutMs: number = INACTIVITY_TIMEOUT_MS
): { session: PersistedSessionState | null; expired: boolean } {
  if (!raw) return { session: null, expired: false };
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSessionState>;
    if (
      !parsed ||
      typeof parsed.uid !== 'string' ||
      !parsed.uid ||
      (parsed.envMode !== 'sandbox' && parsed.envMode !== 'live') ||
      typeof parsed.lastActivityAt !== 'number'
    ) {
      return { session: null, expired: false };
    }
    if (isSessionExpired(parsed.lastActivityAt, nowMs, timeoutMs)) {
      return { session: null, expired: true };
    }
    return {
      session: {
        uid: parsed.uid,
        envMode: parsed.envMode,
        sandboxActiveRole: parsed.sandboxActiveRole ?? 'requester',
        sandboxActiveDepartment:
          typeof parsed.sandboxActiveDepartment === 'string' && parsed.sandboxActiveDepartment
            ? parsed.sandboxActiveDepartment
            : 'City Engineering Office',
        activeSection:
          typeof parsed.activeSection === 'string' ? parsed.activeSection : undefined,
        lastActivityAt: parsed.lastActivityAt,
      },
      expired: false,
    };
  } catch {
    return { session: null, expired: false };
  }
}

export function normalizeEmailToId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export function stripUndefinedFields<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

export function normalizeUsernameInput(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

export function computeCredentialProofId(identifier: string, passwordHash: string): string {
  const cleanId = normalizeUsernameInput(identifier);
  const cleanHash = (passwordHash || '').trim().toLowerCase();
  if (!cleanId || !cleanHash) return '';
  return sha256Hex(`bais_cred_v1:${cleanId}:${cleanHash}`);
}

export function buildCredentialLoginPayloadsFromUser(
  user: UserAccount,
  actorUid: string
): Array<Record<string, unknown> & { id: string }> {
  const cleanHash = (user.passwordHash || '').trim().toLowerCase();
  const cleanEmail = (user.email || '').trim().toLowerCase().slice(0, 254);
  const cleanUid = (user.uid || '').trim();
  if (!cleanHash || !cleanUid || cleanEmail.length < 3) return [];

  const cleanUsername = normalizeUsernameInput(user.username || '').slice(0, 64);
  const isAdminRole = user.role === 'admin';
  const nowIso = new Date().toISOString();
  const rawDisplay = (user.displayName || cleanEmail).trim().slice(0, 120);
  const safeDisplay = rawDisplay.length >= 2 ? rawDisplay : 'City Staff';
  const rawDept = (user.department || 'City Engineering Office').trim().slice(0, 120);
  const safeDept = rawDept.length >= 2 ? rawDept : 'City Engineering Office';
  const rawPos = (user.positionTitle || '').trim().slice(0, 120);
  const createdAt =
    user.createdAt && user.createdAt.length >= 10 ? user.createdAt.slice(0, 64) : nowIso;
  const updatedAt =
    user.updatedAt && user.updatedAt.length >= 10 ? user.updatedAt.slice(0, 64) : createdAt;

  const identifiers: string[] = [];
  if (cleanUsername.length >= 2) identifiers.push(cleanUsername);
  identifiers.push(cleanEmail);

  const seenProofs = new Set<string>();
  const results: Array<Record<string, unknown> & { id: string }> = [];

  for (const ident of identifiers) {
    const proofId = computeCredentialProofId(ident, cleanHash);
    if (!proofId || seenProofs.has(proofId)) continue;
    seenProofs.add(proofId);

    const payload: Record<string, unknown> & { id: string } = {
      id: proofId,
      uid: cleanUid,
      ...(cleanUsername.length >= 2 ? { username: cleanUsername } : {}),
      email: cleanEmail,
      displayName: safeDisplay,
      role: user.role,
      department: safeDept,
      ...(rawPos.length > 0 ? { positionTitle: rawPos } : {}),
      canEdit: isAdminRole ? true : Boolean(user.canEdit),
      canDelete: isAdminRole ? true : Boolean(user.canDelete),
      canSwitchToLive: isAdminRole ? true : Boolean(user.canSwitchToLive),
      canRequestSingleTrip: isAdminRole ? true : Boolean(user.canRequestSingleTrip),
      active: user.active !== false,
      createdBy: (user.createdBy || actorUid || 'admin').slice(0, 128),
      createdAt,
      updatedAt,
    };
    results.push(stripUndefinedFields(payload) as Record<string, unknown> & { id: string });
  }

  return results;
}

export interface CredentialAuthResult {
  ok: boolean;
  user?: UserAccount;
  error?: string;
}

export function authenticateLocalUserCredentials(params: {
  liveUsers?: UserAccount[];
  sandboxUsers?: UserAccount[];
  seedUsers?: UserAccount[];
  identifier: string;
  password: string;
}): CredentialAuthResult {
  const cleanId = normalizeUsernameInput(params.identifier);
  if (!cleanId || !params.password) {
    return { ok: false, error: 'Enter both Account Name and Password.' };
  }

  const orderedPool = [
    ...(params.liveUsers ?? []),
    ...(params.sandboxUsers ?? []),
    ...(params.seedUsers ?? []),
  ];

  const matchingAccounts = orderedPool.filter(
    (u) =>
      (u.username && normalizeUsernameInput(u.username) === cleanId) ||
      u.email.trim().toLowerCase() === cleanId
  );

  if (matchingAccounts.length === 0) {
    return {
      ok: false,
      error:
        'Account Name not recognized or credentials have not been synced to Cloud yet. Verify the account name, ask your Administrator to sync via Google, or click "Sign In with Google (Live Cloud)" below.',
    };
  }

  const activeCandidates = matchingAccounts.filter((u) => u.active);
  if (activeCandidates.length === 0) {
    return {
      ok: false,
      error: 'This user account is suspended. Contact your Administrator.',
    };
  }

  const inputHash = hashPassword(params.password);
  const authenticated = activeCandidates.find(
    (u) => Boolean(u.passwordHash) && u.passwordHash === inputHash
  );

  if (!authenticated) {
    return { ok: false, error: 'Invalid password for this account.' };
  }

  return { ok: true, user: authenticated };
}

export function mergeClaimedUserProfile(params: {
  uid: string;
  email: string;
  displayName?: string | null;
  sourceProfile?: Partial<UserAccount> | null;
  isBootstrappedAdmin?: boolean;
  nowIso?: string;
}): UserAccount {
  const now = params.nowIso ?? new Date().toISOString();
  const cleanEmail = params.email.trim().toLowerCase();
  const emailId = normalizeEmailToId(cleanEmail) || params.uid;

  if (params.isBootstrappedAdmin) {
    return {
      uid: params.uid,
      username: params.sourceProfile?.username?.trim().toLowerCase() || 'admin',
      ...(params.sourceProfile?.passwordHash ? { passwordHash: params.sourceProfile.passwordHash } : {}),
      email: cleanEmail,
      displayName: (
        params.sourceProfile?.displayName ||
        params.displayName ||
        'Bais Internal Audit Admin'
      )
        .trim()
        .slice(0, 120),
      role: 'admin',
      department: params.sourceProfile?.department?.trim() || 'Internal Audit Service',
      positionTitle: params.sourceProfile?.positionTitle?.trim() || 'System Administrator',
      canEdit: true,
      canDelete: true,
      canSwitchToLive: true,
      canRequestSingleTrip: true,
      active: true,
      createdBy: params.sourceProfile?.createdBy || 'system',
      createdAt: params.sourceProfile?.createdAt || now,
      updatedAt: now,
    };
  }

  const src = params.sourceProfile;
  if (src) {
    const role: UserRole = src.role ?? 'requester';
    const isAdminRole = role === 'admin';
    const cleanGsoCode =
      role === 'gso_head' ? normalizeGsoVerificationCode(src.gsoVerificationCode ?? '') : '';
    return {
      uid: params.uid,
      username: normalizeUsernameInput(src.username || emailId).slice(0, 64),
      ...(src.passwordHash ? { passwordHash: src.passwordHash } : {}),
      email: cleanEmail,
      displayName: (src.displayName || params.displayName || cleanEmail).trim().slice(0, 120) || 'City Staff',
      role,
      department: (src.department || 'City Engineering Office').trim().slice(0, 120),
      positionTitle: (src.positionTitle || 'Staff').trim().slice(0, 120),
      canEdit: isAdminRole ? true : Boolean(src.canEdit),
      canDelete: isAdminRole ? true : Boolean(src.canDelete),
      canSwitchToLive: isAdminRole ? true : Boolean(src.canSwitchToLive),
      canRequestSingleTrip: isAdminRole ? true : Boolean(src.canRequestSingleTrip),
      ...(role === 'gso_head' && GSO_VERIFICATION_CODE_REGEX.test(cleanGsoCode)
        ? { gsoVerificationCode: cleanGsoCode }
        : {}),
      active: src.active !== false,
      createdBy: src.createdBy || 'admin',
      createdAt: src.createdAt || now,
      updatedAt: now,
    };
  }

  return {
    uid: params.uid,
    username: emailId.slice(0, 64),
    email: cleanEmail,
    displayName: (params.displayName || cleanEmail).trim().slice(0, 120) || 'City Staff',
    role: 'requester',
    department: 'City Engineering Office',
    positionTitle: 'Department Requester',
    canEdit: false,
    canDelete: false,
    canSwitchToLive: false,
    canRequestSingleTrip: false,
    active: true,
    createdBy: 'self',
    createdAt: now,
    updatedAt: now,
  };
}

function mergeUserCredentials(preferred: UserAccount, secondary: UserAccount): UserAccount {
  const mergedGsoCode =
    preferred.role === 'gso_head'
      ? preferred.gsoVerificationCode || secondary.gsoVerificationCode
      : undefined;
  return {
    ...preferred,
    username: preferred.username || secondary.username,
    passwordHash: preferred.passwordHash || secondary.passwordHash,
    ...(mergedGsoCode ? { gsoVerificationCode: mergedGsoCode } : {}),
  };
}

export function deduplicateUsersByEmail(users: UserAccount[]): UserAccount[] {
  const byEmail = new Map<string, UserAccount>();
  for (const user of users) {
    const key = user.email.trim().toLowerCase();
    if (!key) {
      byEmail.set(user.uid, user);
      continue;
    }
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, user);
      continue;
    }
    const emailPlaceholderId = normalizeEmailToId(key);
    const existingIsPlaceholder = existing.uid === emailPlaceholderId;
    const currentIsPlaceholder = user.uid === emailPlaceholderId;

    if (existingIsPlaceholder && !currentIsPlaceholder) {
      byEmail.set(key, mergeUserCredentials(user, existing));
    } else if (!existingIsPlaceholder && currentIsPlaceholder) {
      byEmail.set(key, mergeUserCredentials(existing, user));
    } else if ((user.updatedAt || '') > (existing.updatedAt || '')) {
      byEmail.set(key, mergeUserCredentials(user, existing));
    } else {
      byEmail.set(key, mergeUserCredentials(existing, user));
    }
  }
  return Array.from(byEmail.values());
}

export function buildInvitePayloadFromUser(
  user: UserAccount,
  actorUid: string
): Record<string, unknown> | null {
  const cleanEmail = (user.email || '').trim().toLowerCase();
  const inviteId = normalizeEmailToId(cleanEmail);
  if (!inviteId || cleanEmail.length < 3) return null;
  const cleanUsername = normalizeUsernameInput(user.username || '').slice(0, 64);
  const isAdminRole = user.role === 'admin';
  const rawDisplay = (user.displayName || cleanEmail).trim().slice(0, 120);
  const rawDept = (user.department || 'City Engineering Office').trim().slice(0, 120);
  const rawPos = (user.positionTitle || '').trim().slice(0, 120);
  const cleanGsoCode =
    user.role === 'gso_head' ? normalizeGsoVerificationCode(user.gsoVerificationCode ?? '') : '';
  const payload: Record<string, unknown> = {
    id: inviteId,
    email: cleanEmail.slice(0, 254),
    ...(cleanUsername.length >= 2 ? { username: cleanUsername } : {}),
    ...(user.passwordHash ? { passwordHash: user.passwordHash.slice(0, 128) } : {}),
    displayName: rawDisplay.length >= 2 ? rawDisplay : 'City Staff',
    role: user.role,
    department: rawDept.length >= 2 ? rawDept : 'City Engineering Office',
    ...(rawPos.length > 0 ? { positionTitle: rawPos } : {}),
    canEdit: isAdminRole ? true : Boolean(user.canEdit),
    canDelete: isAdminRole ? true : Boolean(user.canDelete),
    canSwitchToLive: isAdminRole ? true : Boolean(user.canSwitchToLive),
    canRequestSingleTrip: isAdminRole ? true : Boolean(user.canRequestSingleTrip),
    ...(user.role === 'gso_head' && GSO_VERIFICATION_CODE_REGEX.test(cleanGsoCode)
      ? { gsoVerificationCode: cleanGsoCode }
      : {}),
    active: user.active !== false,
    createdBy: (user.createdBy || actorUid || 'admin').slice(0, 128),
    createdAt: user.createdAt && user.createdAt.length >= 10 ? user.createdAt : new Date().toISOString(),
  };
  return stripUndefinedFields(payload);
}

export function prepareFirestoreRecordPayload<T extends Record<string, unknown>>(
  record: T,
  firebaseUid: string,
  options?: { isCreate?: boolean; collection?: string }
): Record<string, unknown> {
  const cleaned = stripUndefinedFields(record);

  if (options?.collection === 'users') {
    if (typeof cleaned.username === 'string') {
      const normalized = normalizeUsernameInput(cleaned.username).slice(0, 64);
      if (normalized.length < 2) {
        delete cleaned.username;
      } else {
        cleaned.username = normalized;
      }
    }
    if (typeof cleaned.email === 'string') {
      cleaned.email = cleaned.email.trim().toLowerCase().slice(0, 254);
    }
    if (typeof cleaned.displayName === 'string') {
      const trimmedDisplay = cleaned.displayName.trim().slice(0, 120);
      cleaned.displayName = trimmedDisplay.length >= 2 ? trimmedDisplay : 'City Staff';
    }
    if (typeof cleaned.department === 'string') {
      const trimmedDept = cleaned.department.trim().slice(0, 120);
      cleaned.department = trimmedDept.length >= 2 ? trimmedDept : 'City Engineering Office';
    }
    if (typeof cleaned.positionTitle === 'string') {
      const trimmedPos = cleaned.positionTitle.trim().slice(0, 120);
      if (!trimmedPos) {
        delete cleaned.positionTitle;
      } else {
        cleaned.positionTitle = trimmedPos;
      }
    }
    if ('gsoVerificationCode' in cleaned) {
      const normalizedCode =
        typeof cleaned.gsoVerificationCode === 'string'
          ? normalizeGsoVerificationCode(cleaned.gsoVerificationCode)
          : '';
      if (cleaned.role === 'gso_head' && GSO_VERIFICATION_CODE_REGEX.test(normalizedCode)) {
        cleaned.gsoVerificationCode = normalizedCode;
      } else {
        delete cleaned.gsoVerificationCode;
      }
    }
    return cleaned;
  }

  if (options?.collection === 'auditLogs') {
    if (options.isCreate && firebaseUid) {
      cleaned.actorUid = firebaseUid;
    }
    if (typeof cleaned.actorName === 'string') {
      const trimmedActorName = cleaned.actorName.trim().slice(0, 120);
      if (!trimmedActorName) delete cleaned.actorName;
      else cleaned.actorName = trimmedActorName;
    }
    if ('category' in cleaned) {
      const cat = cleaned.category;
      if (cat !== 'credential' && cat !== 'transaction' && cat !== 'registry' && cat !== 'system') {
        delete cleaned.category;
      }
    }
    if ('environment' in cleaned) {
      if (cleaned.environment !== 'sandbox' && cleaned.environment !== 'live') {
        delete cleaned.environment;
      }
    }
    if (typeof cleaned.summary === 'string') {
      const trimmedSummary = sanitizeAuditDetails(cleaned.summary, 400) || 'Audit entry';
      cleaned.summary = trimmedSummary.length < 2 ? 'Audit entry' : trimmedSummary;
    }
    if (typeof cleaned.details === 'string') {
      const safeDetails = sanitizeAuditDetails(cleaned.details, 1200);
      if (!safeDetails) delete cleaned.details;
      else cleaned.details = safeDetails;
    }
    return cleaned;
  }

  if (options?.collection === 'vehicles') {
    if (typeof cleaned.officeMnemonic === 'string') {
      const check = validateDepartmentMnemonic(cleaned.officeMnemonic);
      if (check.valid) {
        cleaned.officeMnemonic = check.normalized;
      } else {
        delete cleaned.officeMnemonic;
      }
    }
  }

  if (options?.collection === 'tripTickets') {
    if (typeof cleaned.projectAip === 'string') {
      const trimmedAip = cleaned.projectAip.trim().slice(0, 160);
      if (!trimmedAip) {
        delete cleaned.projectAip;
      } else {
        cleaned.projectAip = trimmedAip;
      }
    }
    if (typeof cleaned.pmcProjectId === 'string') {
      const trimmedPmcId = cleaned.pmcProjectId.trim().slice(0, 128);
      if (!trimmedPmcId || !/^[a-zA-Z0-9_\-]+$/.test(trimmedPmcId)) {
        delete cleaned.pmcProjectId;
      } else {
        cleaned.pmcProjectId = trimmedPmcId;
      }
    }
  }

  if (options?.collection === 'inventoryLogs') {
    for (const field of [
      'deliveryUnitCostPhp',
      'weightedAverageCostBefore',
      'weightedAverageCostAfter',
      'prevailingWeightedAverageCostPhp',
    ] as const) {
      if (typeof cleaned[field] === 'number') {
        if (!Number.isFinite(cleaned[field] as number) || (cleaned[field] as number) < 0) {
          delete cleaned[field];
        } else {
          cleaned[field] = Math.round((cleaned[field] as number) * 10000) / 10000;
        }
      }
    }
    if (typeof cleaned.deliveryTotalAmountPhp === 'number') {
      if (!Number.isFinite(cleaned.deliveryTotalAmountPhp) || cleaned.deliveryTotalAmountPhp < 0) {
        delete cleaned.deliveryTotalAmountPhp;
      } else {
        cleaned.deliveryTotalAmountPhp = Math.min(
          1_000_000_000,
          Math.round(cleaned.deliveryTotalAmountPhp * 100) / 100
        );
      }
    }
    if (typeof cleaned.physicalDipLiters === 'number') {
      if (!Number.isFinite(cleaned.physicalDipLiters) || cleaned.physicalDipLiters < 0) {
        delete cleaned.physicalDipLiters;
      } else {
        cleaned.physicalDipLiters = Math.round(cleaned.physicalDipLiters * 10) / 10;
      }
    }
    if (typeof cleaned.referenceNumber === 'string') {
      const refTrim = cleaned.referenceNumber.trim().slice(0, 64);
      cleaned.referenceNumber = refTrim.length >= 2 ? refTrim : 'DR-REF';
    }
    if (typeof cleaned.purchaseOrderRef === 'string') {
      const poTrim = cleaned.purchaseOrderRef.trim().toUpperCase().slice(0, 64);
      if (!poTrim) delete cleaned.purchaseOrderRef;
      else cleaned.purchaseOrderRef = poTrim;
    }
    if (typeof cleaned.supplierName === 'string') {
      const supTrim = cleaned.supplierName.trim().slice(0, 120);
      if (!supTrim) delete cleaned.supplierName;
      else cleaned.supplierName = supTrim;
    }
    if (typeof cleaned.deliveryDate === 'string') {
      const dateTrim = cleaned.deliveryDate.trim().slice(0, 20);
      if (!dateTrim) delete cleaned.deliveryDate;
      else cleaned.deliveryDate = dateTrim;
    }
    if (typeof cleaned.notes === 'string') {
      cleaned.notes = cleaned.notes.trim().slice(0, 400);
    }
    if (typeof cleaned.gsoApproverName === 'string') {
      const approverTrim = cleaned.gsoApproverName.trim().slice(0, 120);
      if (!approverTrim) delete cleaned.gsoApproverName;
      else cleaned.gsoApproverName = approverTrim;
    }
    if (typeof cleaned.digitalVerificationCode === 'string') {
      const codeTrim = cleaned.digitalVerificationCode.trim().slice(0, 64);
      if (!codeTrim) delete cleaned.digitalVerificationCode;
      else cleaned.digitalVerificationCode = codeTrim;
    }
    if (typeof cleaned.tankId === 'string') {
      const tankTrim = cleaned.tankId.trim().slice(0, 128);
      if (!tankTrim || !/^[a-zA-Z0-9_\-]+$/.test(tankTrim)) {
        delete cleaned.tankId;
      } else {
        cleaned.tankId = tankTrim;
      }
    }
  }

  if (options?.collection === 'pmcProjects') {
    if (typeof cleaned.department === 'string') {
      const trimmedDept = cleaned.department.trim().slice(0, 120);
      cleaned.department = trimmedDept.length >= 2 ? trimmedDept : 'City Engineering Office';
    }
    if (typeof cleaned.projectName === 'string') {
      cleaned.projectName = cleaned.projectName.trim().slice(0, 200);
    }
    if (typeof cleaned.aipCode === 'string') {
      cleaned.aipCode = cleaned.aipCode.trim().toUpperCase().slice(0, 64);
    }
    if (typeof cleaned.approvalYear === 'number') {
      cleaned.approvalYear = Math.trunc(cleaned.approvalYear);
    }
    if (typeof cleaned.dieselFuelComponentPhp === 'number') {
      cleaned.dieselFuelComponentPhp = Math.max(
        0,
        Math.min(1_000_000_000, Math.round(cleaned.dieselFuelComponentPhp * 100) / 100)
      );
    }
    if (typeof cleaned.gasolineFuelComponentPhp === 'number') {
      cleaned.gasolineFuelComponentPhp = Math.max(
        0,
        Math.min(1_000_000_000, Math.round(cleaned.gasolineFuelComponentPhp * 100) / 100)
      );
    }
    if (typeof cleaned.fuelComponentAmountPhp === 'number') {
      cleaned.fuelComponentAmountPhp = Math.max(
        0,
        Math.min(1_000_000_000, Math.round(cleaned.fuelComponentAmountPhp * 100) / 100)
      );
    }
  }

  if (options?.collection === 'storageTanks') {
    if (typeof cleaned.currentWacPhp === 'number') {
      if (!Number.isFinite(cleaned.currentWacPhp) || cleaned.currentWacPhp < 0) {
        delete cleaned.currentWacPhp;
      } else {
        cleaned.currentWacPhp = Math.min(
          10000,
          Math.round(cleaned.currentWacPhp * 10000) / 10000
        );
      }
    }
  }

  if (options?.isCreate && firebaseUid && 'ownerId' in cleaned) {
    cleaned.ownerId = firebaseUid;
  }

  return cleaned;
}

export function reconcileCollectionRecords<
  T extends { id?: string; uid?: string; updatedAt?: string; createdAt?: string }
>(params: {
  localItems: T[];
  cloudItems: T[];
  keyField: 'id' | 'uid';
  cloudPurgeAt?: string | null;
  seedUpdatedAtByKey?: ReadonlyMap<string, string>;
}): { merged: T[]; toCreate: T[]; toUpdate: T[] } {
  const cloudByKey = new Map<string, T>();
  for (const item of params.cloudItems) {
    const key = item[params.keyField];
    if (typeof key === 'string' && key) {
      cloudByKey.set(key, item);
    }
  }

  const getTimestamp = (item: { updatedAt?: string; createdAt?: string }): string =>
    item.updatedAt || item.createdAt || '';

  const cloudHasRecords = params.cloudItems.length > 0;
  const toCreate: T[] = [];
  const toUpdate: T[] = [];
  const mergedByKey = new Map<string, T>(cloudByKey);

  for (const localItem of params.localItems) {
    const key = localItem[params.keyField];
    if (typeof key !== 'string' || !key) continue;

    const localTs = getTimestamp(localItem);
    const cloudItem = cloudByKey.get(key);

    if (!cloudItem) {
      if (params.cloudPurgeAt && (!localTs || localTs <= params.cloudPurgeAt)) {
        continue;
      }
      const seedTs = params.seedUpdatedAtByKey?.get(key);
      if (cloudHasRecords && seedTs && (!localTs || localTs <= seedTs)) {
        continue;
      }
      toCreate.push(localItem);
      mergedByKey.set(key, localItem);
    } else {
      const cloudTs = getTimestamp(cloudItem);
      if (localTs && (!cloudTs || localTs > cloudTs)) {
        toUpdate.push(localItem);
        mergedByKey.set(key, localItem);
      }
    }
  }

  return {
    merged: Array.from(mergedByKey.values()),
    toCreate,
    toUpdate,
  };
}

export function resolveEffectiveEnvironmentAfterGoogleAuth(params: {
  preserveEnvMode?: EnvironmentMode | null;
  user: Pick<UserAccount, 'role' | 'canSwitchToLive'>;
}): EnvironmentMode {
  if (params.preserveEnvMode === 'sandbox') {
    return 'sandbox';
  }
  return canUserSwitchToLive(params.user) ? 'live' : 'sandbox';
}

export interface EscapeHandlerEntry {
  id: string;
  priority: number;
  order: number;
}

export function resolveTopEscapeHandlerId(entries: EscapeHandlerEntry[]): string | null {
  if (entries.length === 0) return null;
  let best = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const candidate = entries[i];
    if (
      candidate.priority > best.priority ||
      (candidate.priority === best.priority && candidate.order > best.order)
    ) {
      best = candidate;
    }
  }
  return best.id;
}

export interface ReportUtilityFieldSpec {
  key: string;
  label: string;
  description: string;
}

export interface ReportUtilityTargetSpec {
  target: ReportUtilitiesTargetKey;
  group: 'preview' | 'for_approval' | 'post_approval_monitoring' | 'full_report';
  title: string;
  shortLabel: string;
  description: string;
  fields: ReadonlyArray<ReportUtilityFieldSpec>;
}

export const REPORT_UTILITIES_TARGET_SPECS: ReadonlyArray<ReportUtilityTargetSpec> = [
  {
    target: 'workplans_preview',
    group: 'preview',
    title: 'Dept Request — Preview Table',
    shortLabel: 'Dept Request Preview',
    description:
      'Controls column sequence and visibility across all Departmental Work Program preview folders.',
    fields: [
      { key: 'department', label: 'Dept', description: 'Department 3–5 letter mnemonic and project title' },
      { key: 'workPlanNo', label: 'WP No', description: 'Work Plan control number or Single Request Ticket' },
      { key: 'ticketsApproved', label: 'Tkt Appr', description: 'Count of approved embedded tickets' },
      { key: 'ticketsDispensed', label: 'Tkt Disp', description: 'Count of served/dispensed tickets' },
      { key: 'dieselApproved', label: 'Dsl Appr', description: 'Approved diesel volume in liters' },
      { key: 'dieselDispensed', label: 'Dsl Disp', description: 'Actual dispensed diesel volume in liters' },
      { key: 'gasApproved', label: 'Gas Appr', description: 'Approved gasoline volume in liters' },
      { key: 'gasDispensed', label: 'Gas Disp', description: 'Actual dispensed gasoline volume in liters' },
    ],
  },
  {
    target: 'approvals_preview',
    group: 'preview',
    title: 'Approver — Preview Table',
    shortLabel: 'Approver Preview',
    description:
      'Controls column sequence and visibility inside Fuel Request Approval preview folders.',
    fields: [
      { key: 'department', label: 'Dept', description: 'Requesting office 3–5 letter mnemonic' },
      { key: 'workPlanNo', label: 'WP No', description: 'Work Plan control number or Single Request Ticket' },
      { key: 'datePrepared', label: 'Prepared', description: 'Preparation date and timestamp' },
      { key: 'vehicleClassification', label: 'Veh Class', description: 'Fleet equipment classifications in request' },
      { key: 'ticketCount', label: 'Tickets', description: 'Number of embedded trip tickets' },
      { key: 'totalDiesel', label: 'Diesel', description: 'Total requested diesel liters' },
      { key: 'totalGasoline', label: 'Gas', description: 'Total requested gasoline liters' },
    ],
  },
  {
    target: 'dispensing_approved_preview',
    group: 'preview',
    title: 'GSO Approved — Preview Table',
    shortLabel: 'GSO Approved Preview',
    description:
      'Controls column sequence and visibility in the GSO Approved tickets preview table (GSO Head & Admin view).',
    fields: [
      { key: 'ticketNumber', label: 'Ticket #', description: 'Unique sequential trip ticket number' },
      { key: 'department', label: 'Dept', description: 'Requesting office 3–5 letter mnemonic' },
      { key: 'fuelType', label: 'Fuel', description: 'Diesel or Gasoline fuel classification' },
      { key: 'fuelApproved', label: 'Appr (L)', description: 'Approved fuel allocation in liters' },
      { key: 'actualDispensed', label: 'Disp (L)', description: 'Dispensed quantity or Pending indicator' },
      { key: 'dateNeeded', label: 'Needed', description: 'Scheduled operational date' },
      { key: 'dispensedTimestamp', label: 'Disp At', description: 'Date/time dispensed or Pending' },
    ],
  },
  {
    target: 'dispensing_dispensed_preview',
    group: 'preview',
    title: 'GSO Dispensed — Preview Table',
    shortLabel: 'GSO Dispensed Preview',
    description:
      'Controls column sequence and visibility in the GSO Completed/Dispensed tickets preview table (GSO Head & Admin view).',
    fields: [
      { key: 'ticketNumber', label: 'Ticket #', description: 'Unique sequential trip ticket number' },
      { key: 'gsoTxCode', label: 'Tx Code', description: '7-character GSO dispensing transaction code' },
      { key: 'department', label: 'Dept', description: 'Requesting office 3–5 letter mnemonic' },
      { key: 'fuelType', label: 'Fuel', description: 'Diesel or Gasoline fuel classification' },
      { key: 'fuelApproved', label: 'Appr (L)', description: 'Approved fuel allocation in liters' },
      { key: 'actualDispensed', label: 'Disp (L)', description: 'Actual dispensed liters at GSO pump' },
      { key: 'dateNeeded', label: 'Needed', description: 'Scheduled operational date' },
      { key: 'dispensedTimestamp', label: 'Disp At', description: 'Actual dispensing timestamp' },
    ],
  },
  {
    target: 'workplans_full_review',
    group: 'for_approval',
    title: 'Work Plan (For Approval) — Report Sections',
    shortLabel: 'For Approval: Sections',
    description:
      'Pre-approval Work Plan submission & approval report layout. Includes Departmental Sign-Offs (Preparer, Reviewer, Department Approver); omits null fuel totals prior to approval.',
    fields: [
      { key: 'tripTicketsTable', label: 'Trip Tickets Table', description: 'Detailed table of requested trip tickets for approval review' },
      { key: 'mandatorySignOffs', label: 'Sign-Off & Approval Matrix', description: 'Prepared by, Reviewed by, and Department Approver of the concerned department' },
    ],
  },
  {
    target: 'workplans_review_tickets',
    group: 'for_approval',
    title: 'Work Plan (For Approval) — Ticket Columns',
    shortLabel: 'For Approval: Ticket Cols',
    description:
      'Controls column sequence and checkbox visibility for Trip Tickets in the Pre-Approval Work Plan report & PDF (for submission & sign-off).',
    fields: [
      { key: 'ticketNumber', label: 'Ticket #', description: 'Trip ticket sequence number' },
      { key: 'vehicle', label: 'Vehicle', description: 'Plate number, model label, and fuel type' },
      { key: 'driver', label: 'Driver', description: 'Driver name and license number' },
      { key: 'purpose', label: 'Purpose', description: 'Trip purpose or related project description' },
      { key: 'aipCode', label: 'AIP Code', description: 'Annual Investment Plan (AIP) project code' },
      { key: 'scheduledDate', label: 'Scheduled Date', description: 'Scheduled operational trip date' },
      { key: 'destination', label: 'Destination', description: 'Target barangay, route, or project site' },
      { key: 'autoLimit', label: 'Limit', description: 'System-calculated allowable fuel limit' },
      { key: 'requested', label: 'Req (L)', description: 'Requested liters by department' },
      { key: 'approved', label: 'Appr (L)', description: 'Tabletop approved liters and reduction status' },
      { key: 'dispensed', label: 'Disp (L)', description: 'Dispensed liters, custodian, and voided balance' },
      { key: 'state', label: 'State', description: 'Current lifecycle status of the ticket' },
    ],
  },
  {
    target: 'workplans_monitoring_review',
    group: 'post_approval_monitoring',
    title: 'Work Plan (Post-Approval Monitoring) — Report Sections',
    shortLabel: 'Post-Approval: Sections',
    description:
      'Downloadable monitoring layout used after Work Plan approval. Excludes the sign-off and approval matrix and places non-null fuel totals below the last trip ticket.',
    fields: [
      { key: 'undispensedNotice', label: 'Undispensed Notice', description: 'Alert banner when approved tickets remain unserved at GSO' },
      { key: 'tripTicketsTable', label: 'Trip Tickets Table', description: 'Detailed monitoring table of approved and dispensed trip tickets' },
      { key: 'summaryMetrics', label: 'Summary Metrics (Below Tickets)', description: 'Requested, approved, and dispensed Diesel/Gas totals (rendered below the last trip ticket)' },
    ],
  },
  {
    target: 'workplans_monitoring_tickets',
    group: 'post_approval_monitoring',
    title: 'Work Plan (Post-Approval Monitoring) — Ticket Columns',
    shortLabel: 'Post-Approval: Ticket Cols',
    description:
      'Controls column sequence and checkbox visibility for Trip Tickets in the Post-Approval Monitoring report & PDF (downloaded after approval; sign-off block excluded).',
    fields: [
      { key: 'ticketNumber', label: 'Ticket #', description: 'Trip ticket sequence number' },
      { key: 'vehicle', label: 'Vehicle', description: 'Plate number, model label, and fuel type' },
      { key: 'driver', label: 'Driver', description: 'Driver name and license number' },
      { key: 'purpose', label: 'Purpose', description: 'Trip purpose or related project description' },
      { key: 'aipCode', label: 'AIP Code', description: 'Annual Investment Plan (AIP) project code' },
      { key: 'scheduledDate', label: 'Scheduled Date', description: 'Scheduled operational trip date' },
      { key: 'destination', label: 'Destination', description: 'Target barangay, route, or project site' },
      { key: 'autoLimit', label: 'Limit', description: 'System-calculated allowable fuel limit' },
      { key: 'requested', label: 'Req (L)', description: 'Requested liters by department' },
      { key: 'approved', label: 'Appr (L)', description: 'Tabletop approved liters and reduction status' },
      { key: 'dispensed', label: 'Disp (L)', description: 'Dispensed liters, custodian, and voided balance' },
      { key: 'state', label: 'State', description: 'Current lifecycle status of the ticket' },
    ],
  },
  {
    target: 'reports_full_preview',
    group: 'full_report',
    title: 'Daily Recon — Full Report Sections',
    shortLabel: 'Full Report Sections',
    description:
      'Controls section sequence and visibility in Daily Reconciliation Full Report Preview and Reconciliation PDF.',
    fields: [
      { key: 'summaryMetrics', label: 'Summary KPIs', description: 'Total Requested, Approved, Dispensed, Forfeited, and Cost KPIs' },
      { key: 'departmentBreakdown', label: 'Dept Recon & Cost', description: 'Per-department volume and PHP cost table' },
      { key: 'discrepancyAlerts', label: 'Discrepancy Alerts', description: 'Forfeited variances, shrinkage, and depot threshold alerts' },
      { key: 'depotValuation', label: 'Depot Valuation', description: 'Remaining Gasoline & Diesel tank inventory valuation' },
    ],
  },
  {
    target: 'reports_dept_table',
    group: 'full_report',
    title: 'Daily Recon — Table Columns',
    shortLabel: 'Full Report Columns',
    description:
      'Controls column sequence and visibility inside the Dept Reconciliation & Cost table and PDF.',
    fields: [
      { key: 'department', label: 'Dept', description: 'Department 3–5 letter mnemonic' },
      { key: 'requestedLiters', label: 'Req (L)', description: 'Total requested fuel liters' },
      { key: 'approvedLiters', label: 'Appr (L)', description: 'Total approved fuel liters' },
      { key: 'dispensedLiters', label: 'Disp (L)', description: 'Total actual dispensed fuel liters' },
      { key: 'forfeitedLiters', label: 'Void (L)', description: 'Total voided/forfeited unserved liters' },
      { key: 'costPhp', label: 'Cost (₱)', description: 'Total dispensed fuel cost in Philippine Pesos' },
    ],
  },
];

export const REPORT_UTILITIES_TARGET_KEYS: ReadonlyArray<ReportUtilitiesTargetKey> =
  REPORT_UTILITIES_TARGET_SPECS.map((s) => s.target);

export function canManageReportUtilities(role: UserRole): boolean {
  return role === 'admin';
}

export function getReportUtilityTargetSpec(
  target: ReportUtilitiesTargetKey
): ReportUtilityTargetSpec {
  const found = REPORT_UTILITIES_TARGET_SPECS.find((s) => s.target === target);
  if (!found) {
    throw new Error(`Unknown Report Utilities target: ${target}`);
  }
  return found;
}

export function createDefaultTargetItems(
  target: ReportUtilitiesTargetKey
): ReportFieldConfigItem[] {
  return getReportUtilityTargetSpec(target).fields.map((f) => ({
    key: f.key,
    enabled: true,
  }));
}

export function createDefaultReportUtilitiesConfig(
  updatedBy = 'system',
  updatedAt = ''
): ReportUtilitiesConfig {
  return {
    id: 'report_utilities',
    workplans_preview: createDefaultTargetItems('workplans_preview'),
    workplans_full_review: createDefaultTargetItems('workplans_full_review'),
    workplans_review_tickets: createDefaultTargetItems('workplans_review_tickets'),
    workplans_monitoring_review: createDefaultTargetItems('workplans_monitoring_review'),
    workplans_monitoring_tickets: createDefaultTargetItems('workplans_monitoring_tickets'),
    approvals_preview: createDefaultTargetItems('approvals_preview'),
    dispensing_approved_preview: createDefaultTargetItems('dispensing_approved_preview'),
    dispensing_dispensed_preview: createDefaultTargetItems('dispensing_dispensed_preview'),
    reports_full_preview: createDefaultTargetItems('reports_full_preview'),
    reports_dept_table: createDefaultTargetItems('reports_dept_table'),
    updatedBy,
    updatedAt,
  };
}

const LEGACY_REPORT_UTILITY_FIELD_EXPANSIONS: Partial<
  Record<ReportUtilitiesTargetKey, Record<string, ReadonlyArray<string>>>
> = {
  workplans_review_tickets: {
    purposeDestination: ['purpose', 'aipCode', 'scheduledDate', 'destination'],
  },
  workplans_monitoring_tickets: {
    purposeDestination: ['purpose', 'aipCode', 'scheduledDate', 'destination'],
  },
};

function normalizeTargetItems(
  target: ReportUtilitiesTargetKey,
  rawItems: unknown
): ReportFieldConfigItem[] {
  const spec = getReportUtilityTargetSpec(target);
  const validKeys = new Set(spec.fields.map((f) => f.key));
  const legacyExpansions = LEGACY_REPORT_UTILITY_FIELD_EXPANSIONS[target];
  const seen = new Set<string>();
  const normalized: ReportFieldConfigItem[] = [];

  const rawExplicitKeys = new Set<string>();
  if (Array.isArray(rawItems)) {
    for (const entry of rawItems) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { key?: unknown }).key === 'string'
      ) {
        const k = (entry as { key: string }).key;
        if (validKeys.has(k)) rawExplicitKeys.add(k);
      }
    }

    for (const entry of rawItems) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { key?: unknown }).key === 'string'
      ) {
        const key = (entry as { key: string }).key;
        const enabled = (entry as { enabled?: unknown }).enabled !== false;

        if (legacyExpansions && legacyExpansions[key]) {
          for (const expandedKey of legacyExpansions[key]) {
            if (!validKeys.has(expandedKey) || seen.has(expandedKey) || rawExplicitKeys.has(expandedKey)) {
              continue;
            }
            seen.add(expandedKey);
            normalized.push({ key: expandedKey, enabled });
          }
          continue;
        }

        if (!validKeys.has(key) || seen.has(key)) continue;
        seen.add(key);
        normalized.push({
          key,
          enabled,
        });
      }
    }
  }

  // Retroactively append any newly introduced canonical fields at the end (enabled by default)
  for (const field of spec.fields) {
    if (!seen.has(field.key)) {
      seen.add(field.key);
      normalized.push({ key: field.key, enabled: true });
    }
  }

  // Safeguard: guarantee at least one enabled item per target so previews/reports are never blank
  if (!normalized.some((item) => item.enabled) && normalized.length > 0) {
    normalized[0] = { ...normalized[0], enabled: true };
  }

  return normalized;
}

export function normalizeReportUtilitiesConfig(
  raw?: Partial<ReportUtilitiesConfig> | null
): ReportUtilitiesConfig {
  const defaults = createDefaultReportUtilitiesConfig();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  return {
    id: 'report_utilities',
    workplans_preview: normalizeTargetItems('workplans_preview', raw.workplans_preview),
    workplans_full_review: normalizeTargetItems('workplans_full_review', raw.workplans_full_review),
    workplans_review_tickets: normalizeTargetItems(
      'workplans_review_tickets',
      raw.workplans_review_tickets
    ),
    workplans_monitoring_review: normalizeTargetItems(
      'workplans_monitoring_review',
      raw.workplans_monitoring_review
    ),
    workplans_monitoring_tickets: normalizeTargetItems(
      'workplans_monitoring_tickets',
      raw.workplans_monitoring_tickets
    ),
    approvals_preview: normalizeTargetItems('approvals_preview', raw.approvals_preview),
    dispensing_approved_preview: normalizeTargetItems(
      'dispensing_approved_preview',
      raw.dispensing_approved_preview
    ),
    dispensing_dispensed_preview: normalizeTargetItems(
      'dispensing_dispensed_preview',
      raw.dispensing_dispensed_preview
    ),
    reports_full_preview: normalizeTargetItems('reports_full_preview', raw.reports_full_preview),
    reports_dept_table: normalizeTargetItems('reports_dept_table', raw.reports_dept_table),
    updatedBy:
      typeof raw.updatedBy === 'string' && raw.updatedBy.trim() ? raw.updatedBy.trim() : 'system',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export function reorderReportUtilityItems(
  items: ReadonlyArray<ReportFieldConfigItem>,
  fromIndex: number,
  toIndex: number
): ReportFieldConfigItem[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items.map((item) => ({ ...item }));
  }
  const next = items.map((item) => ({ ...item }));
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function toggleReportUtilityItem(
  items: ReadonlyArray<ReportFieldConfigItem>,
  key: string
): { items: ReportFieldConfigItem[]; blockedLastEnabled: boolean } {
  const target = items.find((item) => item.key === key);
  if (!target) {
    return { items: items.map((item) => ({ ...item })), blockedLastEnabled: false };
  }

  const enabledCount = items.filter((item) => item.enabled).length;
  if (target.enabled && enabledCount <= 1) {
    return { items: items.map((item) => ({ ...item })), blockedLastEnabled: true };
  }

  return {
    items: items.map((item) => (item.key === key ? { ...item, enabled: !item.enabled } : { ...item })),
    blockedLastEnabled: false,
  };
}

export function getActiveReportUtilityKeys(
  config: Partial<ReportUtilitiesConfig> | null | undefined,
  target: ReportUtilitiesTargetKey
): string[] {
  const normalized = normalizeReportUtilitiesConfig(config);
  return normalized[target].filter((item) => item.enabled).map((item) => item.key);
}

// ============================================================================
// Department 3–5 Letter Mnemonic Registry & Resolution Engine
// ============================================================================

const MNEMONIC_STOP_WORDS = new Set([
  'OF',
  'THE',
  'AND',
  'FOR',
  'IN',
  'AT',
  'TO',
  'ON',
  'WITH',
  'BY',
]);

function normalizeOfficeKey(office: string): string {
  return office.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function validateDepartmentMnemonic(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized.length < 3 || normalized.length > 5) {
    return {
      valid: false,
      normalized,
      error: 'Department mnemonic must be 3 to 5 uppercase letters (A–Z).',
    };
  }
  return { valid: true, normalized };
}

export function buildDepartmentMnemonicMap(
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [officeName, code] of Object.entries(BAIS_DEPARTMENT_MNEMONICS)) {
    map[normalizeOfficeKey(officeName)] = code;
    map[normalizeOfficeKey(code)] = code;
  }

  if (Array.isArray(vehicles)) {
    for (const v of vehicles) {
      if (!v?.office || !v.officeMnemonic) continue;
      const check = validateDepartmentMnemonic(v.officeMnemonic);
      if (check.valid) {
        map[normalizeOfficeKey(v.office)] = check.normalized;
        map[normalizeOfficeKey(check.normalized)] = check.normalized;
      }
    }
  }
  return map;
}

export function deriveDepartmentMnemonic(
  department: string,
  usedMnemonics?: ReadonlySet<string>
): string {
  const trimmed = department.trim();
  if (!trimmed) return 'LGU';

  // 1. Canonical exact match (case-insensitive)
  const normKey = normalizeOfficeKey(trimmed);
  for (const [officeName, code] of Object.entries(BAIS_DEPARTMENT_MNEMONICS)) {
    if (normalizeOfficeKey(officeName) === normKey || code.toLowerCase() === normKey) {
      return code;
    }
  }

  // 2. If already a 3–5 letter alphabetic mnemonic
  if (/^[A-Za-z]{3,5}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const ensureUnique = (candidate: string): string => {
    const clean = candidate.toUpperCase().replace(/[^A-Z]/g, '');
    const base =
      clean.length >= 3
        ? clean.slice(0, 5)
        : (clean + 'OFF').slice(0, 3);
    if (!usedMnemonics || !usedMnemonics.has(base)) {
      return base;
    }
    // Try compact variations using remaining letters from the office name
    const allLetters = trimmed.toUpperCase().replace(/[^A-Z]/g, '');
    for (let i = 0; i < allLetters.length; i++) {
      const alt = (base.slice(0, 4) + allLetters[i]).slice(0, 5);
      if (alt.length >= 3 && !usedMnemonics.has(alt)) return alt;
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < alphabet.length; i++) {
      const alt = (base.slice(0, Math.min(4, base.length)) + alphabet[i]).slice(0, 5);
      if (alt.length >= 3 && !usedMnemonics.has(alt)) return alt;
    }
    return base;
  };

  // 3. Check parenthetical abbreviation like "(CSWDO)" or "(BFP)"
  const parenMatch = trimmed.match(/\(([A-Za-z]{3,6})\)/);
  if (parenMatch) {
    const parenCode = parenMatch[1].toUpperCase();
    return ensureUnique(parenCode.length > 5 ? parenCode.slice(-5) : parenCode);
  }

  // 4. Build abbreviation from significant words
  const words = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !MNEMONIC_STOP_WORDS.has(w));

  if (words.length >= 3) {
    const initials = words.map((w) => w[0]).join('').slice(0, 5);
    return ensureUnique(initials);
  }
  if (words.length === 2) {
    // e.g. "City Veterinary" -> "CVET", "Traffic Management" -> "TMGT"
    const combo = (words[0][0] + words[1].slice(0, 3)).slice(0, 5);
    return ensureUnique(combo);
  }
  if (words.length === 1) {
    return ensureUnique(words[0].slice(0, 5));
  }

  return ensureUnique(trimmed.replace(/[^A-Za-z]/g, ''));
}

export function getDepartmentMnemonic(
  department?: string | null,
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): string {
  const trimmed = (department ?? '').trim();
  if (!trimmed) return 'LGU';

  const map = buildDepartmentMnemonicMap(vehicles);
  const direct = map[normalizeOfficeKey(trimmed)];
  if (direct) return direct;

  const used = new Set(Object.values(map));
  return deriveDepartmentMnemonic(trimmed, used);
}

export function checkDepartmentMnemonicCollision(
  mnemonic: string,
  office: string,
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): string | null {
  const check = validateDepartmentMnemonic(mnemonic);
  if (!check.valid) return null;
  const targetOfficeKey = normalizeOfficeKey(office);

  // Check canonical offices first
  for (const [canonicalOffice, code] of Object.entries(BAIS_DEPARTMENT_MNEMONICS)) {
    if (code === check.normalized && normalizeOfficeKey(canonicalOffice) !== targetOfficeKey) {
      return canonicalOffice;
    }
  }

  // Check registered fleet vehicles
  if (Array.isArray(vehicles)) {
    for (const v of vehicles) {
      if (!v?.office || !v.officeMnemonic) continue;
      if (
        v.officeMnemonic.trim().toUpperCase() === check.normalized &&
        normalizeOfficeKey(v.office) !== targetOfficeKey
      ) {
        return v.office;
      }
    }
  }

  return null;
}

export function formatDepartmentWithMnemonic(
  department: string,
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): string {
  const code = getDepartmentMnemonic(department, vehicles);
  if (department.trim().toUpperCase() === code) return code;
  return `${code} — ${department}`;
}

// ============================================================================
// GSO Dispenser Search-First Lookup Mode
// ============================================================================

export function isGsoDispenserOnlyMode(role: UserRole): boolean {
  return role === 'gso_dispenser';
}

export interface GsoDispenserTicketLookupResult {
  status: 'empty' | 'found' | 'pending_approval' | 'rejected' | 'not_found';
  item?: DispensingTicketViewItem;
  ticket?: TripTicket;
}

export function findDispensingTicketByNumber(
  tickets: ReadonlyArray<TripTicket>,
  workPlans: ReadonlyArray<WorkPlan>,
  rawQuery: string
): GsoDispenserTicketLookupResult {
  const cleaned = rawQuery.trim();
  if (!cleaned) {
    return { status: 'empty' };
  }

  const normalizedUpper = cleaned.toUpperCase();
  const digitsOnly = cleaned.replace(/^0+/, '') || '0';

  const exactMatch = tickets.find(
    (t) => t.ticketNumber.trim().toUpperCase() === normalizedUpper
  );
  const numericMatch =
    exactMatch ??
    (/^\d+$/.test(cleaned)
      ? tickets.find((t) => (t.ticketNumber.trim().replace(/^0+/, '') || '0') === digitsOnly)
      : undefined);

  if (!numericMatch) {
    return { status: 'not_found' };
  }

  if (numericMatch.status === 'pending') {
    return { status: 'pending_approval', ticket: numericMatch };
  }
  if (numericMatch.status === 'rejected') {
    return { status: 'rejected', ticket: numericMatch };
  }

  const wp = workPlans.find((plan) => plan.id === numericMatch.workPlanId);
  const workPlanNumber = wp ? getWorkPlanDisplayLabel(wp) : numericMatch.workPlanId;

  return {
    status: 'found',
    ticket: numericMatch,
    item: {
      ticket: numericMatch,
      workPlanNumber,
    },
  };
}

// ============================================================================
// Mobile-First Display Preview Optimization & Download-Gated Full Report Mode
// ============================================================================

export type ReportPreviewMode = 'mobile_compact' | 'full_report';

/**
 * Full Preview Report View is presented strictly once the user opts into a Download command;
 * standard display previews remain in compact mobile-first mode to eliminate empty screen space.
 */
export function resolveReportPreviewMode(downloadOpted: boolean): ReportPreviewMode {
  return downloadOpted ? 'full_report' : 'mobile_compact';
}

/**
 * When viewing All Folders in Work Program Preview, suppress empty folder boxes so mobile screens
 * never waste vertical space on empty placeholder containers. When a specific folder tab is chosen,
 * always render that folder (showing a compact empty state if 0 rows).
 */
export function shouldRenderWorkProgramFolder(
  activeTab: 'all' | WorkProgramFolderKey,
  folderKey: WorkProgramFolderKey,
  rowCount: number
): boolean {
  if (activeTab === folderKey) return true;
  if (activeTab === 'all') return rowCount > 0;
  return false;
}

/**
 * When viewing All Tickets in GSO Dispensing, hide an empty category card whenever the opposite
 * category has records, avoiding dead vertical space on mobile.
 */
export function shouldRenderDispensingSection(
  categoryTab: 'all' | 'approved' | 'dispensed',
  section: 'approved' | 'dispensed',
  count: number,
  otherCount: number
): boolean {
  if (categoryTab === section) return true;
  if (categoryTab === 'all') {
    if (count > 0) return true;
    return section === 'approved' && otherCount === 0;
  }
  return false;
}

/**
 * Selects only the essential mobile-first table section for standard Reconciliation Display Preview.
 * Multi-section full report blocks (KPI grid, discrepancy lists, depot valuation) are deferred to
 * the Full Preview Report View when Download is opted.
 */
export function getCompactMobileReportSections(
  activeSections: ReadonlyArray<string>
): string[] {
  if (activeSections.includes('departmentBreakdown')) {
    return ['departmentBreakdown'];
  }
  return activeSections.length > 0 ? [activeSections[0]] : ['departmentBreakdown'];
}

export const USER_OFFICE_DEPARTMENT = 'Internal Audit Service';
export const TABLETOP_APPROVER_DEPARTMENT = "City Mayor's Office";
export const GSO_OFFICE_DEPARTMENT = 'General Services Office (GSO)';
export const PMC_OFFICE_DEPARTMENT = 'Project Monitoring Committee (PMC)';

export function normalizePmcProject(raw: Partial<PmcProject> & { id: string }): PmcProject {
  const legacyTotal =
    typeof raw.fuelComponentAmountPhp === 'number' && Number.isFinite(raw.fuelComponentAmountPhp)
      ? Math.max(0, Math.round(raw.fuelComponentAmountPhp * 100) / 100)
      : 0;
  const hasSplit =
    typeof raw.dieselFuelComponentPhp === 'number' ||
    typeof raw.gasolineFuelComponentPhp === 'number';
  const dieselFuelComponentPhp = hasSplit
    ? Math.max(0, Math.round((Number(raw.dieselFuelComponentPhp) || 0) * 100) / 100)
    : legacyTotal;
  const gasolineFuelComponentPhp = hasSplit
    ? Math.max(0, Math.round((Number(raw.gasolineFuelComponentPhp) || 0) * 100) / 100)
    : 0;
  const fuelComponentAmountPhp = Math.round((dieselFuelComponentPhp + gasolineFuelComponentPhp) * 100) / 100;

  let inferredDept = String(raw.department ?? '').trim();
  if (!inferredDept) {
    const aip = String(raw.aipCode ?? '').toUpperCase();
    if (aip.startsWith('AGRI')) inferredDept = 'City Agriculture Office';
    else if (aip.startsWith('ENRO')) inferredDept = 'City Environment & Natural Resources Office (CENRO)';
    else if (aip.startsWith('HLTH') || aip.startsWith('CHO')) inferredDept = 'City Health Office';
    else if (aip.startsWith('DRRM')) inferredDept = 'City Disaster Risk Reduction & Management Office (CDRRMO)';
    else inferredDept = 'City Engineering Office';
  }

  return {
    id: raw.id,
    department: inferredDept,
    approvalYear: Number.isInteger(Number(raw.approvalYear))
      ? Number(raw.approvalYear)
      : new Date().getFullYear(),
    projectName: String(raw.projectName ?? '').trim(),
    aipCode: String(raw.aipCode ?? '').trim().toUpperCase(),
    dieselFuelComponentPhp,
    gasolineFuelComponentPhp,
    fuelComponentAmountPhp,
    ownerId: raw.ownerId ?? 'system',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date().toISOString(),
  };
}

export interface PmcProjectValidationResult {
  valid: boolean;
  error?: string;
  normalized?: {
    department: string;
    approvalYear: number;
    projectName: string;
    aipCode: string;
    dieselFuelComponentPhp: number;
    gasolineFuelComponentPhp: number;
    fuelComponentAmountPhp: number;
  };
}

export function validatePmcProjectInput(
  input: {
    department?: string;
    approvalYear: number;
    projectName: string;
    aipCode: string;
    dieselFuelComponentPhp?: number;
    gasolineFuelComponentPhp?: number;
    fuelComponentAmountPhp?: number;
  },
  existingProjects: ReadonlyArray<Pick<PmcProject, 'id' | 'approvalYear' | 'aipCode'>> = [],
  editingId?: string
): PmcProjectValidationResult {
  const cleanDepartment = String(input.department ?? 'City Engineering Office')
    .trim()
    .slice(0, 120);
  if (cleanDepartment.length < 2) {
    return {
      valid: false,
      error: 'Concerned Department Office must be selected.',
    };
  }

  const yearNum = Number(input.approvalYear);
  if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
    return {
      valid: false,
      error: 'Year of Project Approval must be a valid 4-digit year between 2000 and 2100.',
    };
  }

  const cleanName = String(input.projectName ?? '').trim().slice(0, 200);
  if (cleanName.length < 3) {
    return {
      valid: false,
      error: 'Name of Project must be at least 3 characters.',
    };
  }

  const cleanAip = String(input.aipCode ?? '').trim().toUpperCase().slice(0, 64);
  if (cleanAip.length < 2) {
    return {
      valid: false,
      error: 'AIP Code must be at least 2 characters.',
    };
  }

  const hasSplitInput =
    input.dieselFuelComponentPhp !== undefined || input.gasolineFuelComponentPhp !== undefined;

  let dieselAmt: number;
  let gasolineAmt: number;

  if (hasSplitInput) {
    dieselAmt = Number(input.dieselFuelComponentPhp ?? 0);
    gasolineAmt = Number(input.gasolineFuelComponentPhp ?? 0);
    if (!Number.isFinite(dieselAmt) || dieselAmt < 0 || dieselAmt > 1_000_000_000) {
      return {
        valid: false,
        error: 'Diesel Fuel Component (PHP) must be a valid non-negative PHP amount.',
      };
    }
    if (!Number.isFinite(gasolineAmt) || gasolineAmt < 0 || gasolineAmt > 1_000_000_000) {
      return {
        valid: false,
        error: 'Gasoline Fuel Component (PHP) must be a valid non-negative PHP amount.',
      };
    }
  } else {
    const legacyFuel = Number(input.fuelComponentAmountPhp);
    if (!Number.isFinite(legacyFuel) || legacyFuel < 0 || legacyFuel > 1_000_000_000) {
      return {
        valid: false,
        error: 'Amount of Fuel Component of the Program of Work must be a valid non-negative PHP amount.',
      };
    }
    dieselAmt = legacyFuel;
    gasolineAmt = 0;
  }

  const roundedDiesel = Math.round(dieselAmt * 100) / 100;
  const roundedGasoline = Math.round(gasolineAmt * 100) / 100;
  const totalFuelAmt = Math.round((roundedDiesel + roundedGasoline) * 100) / 100;

  if (totalFuelAmt > 1_000_000_000) {
    return {
      valid: false,
      error: 'Combined Diesel and Gasoline Fuel Component cannot exceed PHP 1,000,000,000.',
    };
  }

  const duplicate = existingProjects.find(
    (p) =>
      p.id !== editingId &&
      p.approvalYear === yearNum &&
      p.aipCode.trim().toUpperCase() === cleanAip
  );
  if (duplicate) {
    return {
      valid: false,
      error: `AIP Code "${cleanAip}" is already registered under Approval Year ${yearNum}.`,
    };
  }

  return {
    valid: true,
    normalized: {
      department: cleanDepartment,
      approvalYear: yearNum,
      projectName: cleanName,
      aipCode: cleanAip,
      dieselFuelComponentPhp: roundedDiesel,
      gasolineFuelComponentPhp: roundedGasoline,
      fuelComponentAmountPhp: totalFuelAmt,
    },
  };
}

export function filterAndSummarizePmcProjects(
  projects: ReadonlyArray<PmcProject>,
  filters: { search?: string; year?: string; department?: string } = {}
): {
  items: PmcProject[];
  availableYears: number[];
  availableDepartments: string[];
  projectCount: number;
  totalDieselComponentPhp: number;
  totalGasolineComponentPhp: number;
  totalFuelComponentPhp: number;
} {
  const normalizedList = projects.map((p) => normalizePmcProject(p));
  const availableYears = Array.from(new Set(normalizedList.map((p) => p.approvalYear))).sort(
    (a, b) => b - a
  );
  const availableDepartments = Array.from(
    new Set(normalizedList.map((p) => p.department).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const q = (filters.search ?? '').trim().toLowerCase();
  const yearFilter = (filters.year ?? '').trim();
  const deptFilter =
    filters.department && filters.department !== 'all'
      ? filters.department.trim().toLowerCase()
      : '';

  const items = normalizedList
    .filter((p) => {
      if (yearFilter && String(p.approvalYear) !== yearFilter) return false;
      if (deptFilter && p.department.trim().toLowerCase() !== deptFilter) return false;
      if (!q) return true;
      return (
        p.projectName.toLowerCase().includes(q) ||
        p.aipCode.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q) ||
        String(p.approvalYear).includes(q)
      );
    })
    .sort((a, b) => {
      if (b.approvalYear !== a.approvalYear) return b.approvalYear - a.approvalYear;
      return a.aipCode.localeCompare(b.aipCode);
    });

  const totalDieselComponentPhp =
    Math.round(items.reduce((sum, p) => sum + (Number(p.dieselFuelComponentPhp) || 0), 0) * 100) /
    100;
  const totalGasolineComponentPhp =
    Math.round(items.reduce((sum, p) => sum + (Number(p.gasolineFuelComponentPhp) || 0), 0) * 100) /
    100;
  const totalFuelComponentPhp =
    Math.round((totalDieselComponentPhp + totalGasolineComponentPhp) * 100) / 100;

  return {
    items,
    availableYears,
    availableDepartments,
    projectCount: items.length,
    totalDieselComponentPhp,
    totalGasolineComponentPhp,
    totalFuelComponentPhp,
  };
}

// ============================================================================
// Weighted Average Cost (WAC) per Fuel Class & PMC Project Fuel Cap Ledger
// ============================================================================

/**
 * Computes the new Weighted Average Cost (PHP/L) upon delivery of new stock:
 *   WAC_new = (Stock_before * WAC_before + Delivered_L * Delivery_Unit_Cost) / (Stock_before + Delivered_L)
 * Rounded to 4 decimal places for accurate PHP cost accounting.
 */
export function computeWeightedAverageCostAfterDelivery(params: {
  currentStockLiters: number;
  currentWacPhp: number;
  deliveredLiters: number;
  deliveryUnitCostPhp: number;
}): number {
  const prevStock = Math.max(0, Number(params.currentStockLiters) || 0);
  const prevWac = Math.max(0, Number(params.currentWacPhp) || 0);
  const delivered = Math.max(0, Number(params.deliveredLiters) || 0);
  const deliveryCost = Math.max(0, Number(params.deliveryUnitCostPhp) || 0);

  const totalLiters = prevStock + delivered;
  if (totalLiters <= 0) {
    return Math.round(deliveryCost * 10000) / 10000;
  }
  const weighted = (prevStock * prevWac + delivered * deliveryCost) / totalLiters;
  return Math.round(weighted * 10000) / 10000;
}

export interface WeightedAverageCostLedgerRow {
  logId: string;
  timestamp: string;
  gsoTransactionCode: string;
  referenceNumber: string;
  depotId: string;
  depotName: string;
  tankId?: string;
  tankCode?: string;
  tankName?: string;
  fuelType: FuelType;
  stockBeforeLiters: number;
  deliveredLiters: number;
  stockAfterLiters: number;
  previousWacPhp: number;
  deliveryUnitCostPhp: number;
  newPrevailingWacPhp: number;
  approvalStatus: InventoryLog['approvalStatus'];
}

/**
 * Computes the volume-weighted average WAC across all tanks of a fuel class within a depot,
 * keeping depot-level summary pricing synchronized with independent per-tank WACs.
 */
export function computeAggregateDepotWacFromTanks(params: {
  depotId: string;
  fuelType: FuelType;
  storageTanks: ReadonlyArray<StorageTank>;
  fallbackWacPhp: number;
}): number {
  const matchingTanks = params.storageTanks.filter(
    (t) => t.depotId === params.depotId && t.mappedFuelType === params.fuelType
  );
  if (matchingTanks.length === 0) {
    return Math.round(Math.max(0, params.fallbackWacPhp) * 10000) / 10000;
  }
  let totalVolume = 0;
  let totalValue = 0;
  for (const tank of matchingTanks) {
    const vol = Math.max(0, Number(tank.currentBookVolumeLiters) || 0);
    const wac =
      typeof tank.currentWacPhp === 'number' && Number.isFinite(tank.currentWacPhp) && tank.currentWacPhp > 0
        ? tank.currentWacPhp
        : params.fallbackWacPhp;
    totalVolume += vol;
    totalValue += vol * wac;
  }
  if (totalVolume <= 0) {
    const avg =
      matchingTanks.reduce(
        (sum, t) =>
          sum +
          (typeof t.currentWacPhp === 'number' && t.currentWacPhp > 0
            ? t.currentWacPhp
            : params.fallbackWacPhp),
        0
      ) / matchingTanks.length;
    return Math.round(avg * 10000) / 10000;
  }
  return Math.round((totalValue / totalVolume) * 10000) / 10000;
}

/**
 * Builds the tabular Weighted Average Cost (WAC) monitoring rows from inventory delivery logs
 * sorted newest-first for Depot Inventory tabular monitoring per fuel tank & fuel class.
 */
export function buildWeightedAverageCostLedger(
  inventoryLogs: ReadonlyArray<InventoryLog>,
  depots: ReadonlyArray<FuelDepot>,
  filters?: {
    fuelType?: FuelType | 'all';
    depotId?: string;
    tankId?: string;
    year?: string;
    month?: string;
  },
  storageTanks: ReadonlyArray<StorageTank> = []
): WeightedAverageCostLedgerRow[] {
  const depotMap = new Map(depots.map((d) => [d.id, d]));
  const tankMap = new Map(storageTanks.map((t) => [t.id, t]));

  return inventoryLogs
    .filter((log) => {
      if (log.transactionType !== 'delivery') return false;
      if (filters?.fuelType && filters.fuelType !== 'all' && log.fuelType !== filters.fuelType) {
        return false;
      }
      if (filters?.depotId && filters.depotId !== 'all' && log.depotId !== filters.depotId) {
        return false;
      }
      if (filters?.tankId && filters.tankId !== 'all' && log.tankId !== filters.tankId) {
        return false;
      }
      const ts = log.verifiedAt || log.createdAt || '';
      if (filters?.year && filters.year !== 'all' && ts.slice(0, 4) !== filters.year) {
        return false;
      }
      if (filters?.month && filters.month !== 'all' && ts.slice(5, 7) !== filters.month) {
        return false;
      }
      return true;
    })
    .map((log) => {
      const depot = depotMap.get(log.depotId);
      const tank = log.tankId ? tankMap.get(log.tankId) : undefined;
      const fallbackPrice =
        (typeof tank?.currentWacPhp === 'number' && tank.currentWacPhp > 0
          ? tank.currentWacPhp
          : undefined) ??
        (log.fuelType === 'gasoline'
          ? depot?.gasolinePricePerLiter ?? 64.5
          : depot?.dieselPricePerLiter ?? 58.2);
      const deliveredLiters = Math.max(0, Math.abs(log.litersDelta));
      const deliveryUnitCostPhp =
        typeof log.deliveryUnitCostPhp === 'number' && Number.isFinite(log.deliveryUnitCostPhp)
          ? log.deliveryUnitCostPhp
          : fallbackPrice;
      const previousWacPhp =
        typeof log.weightedAverageCostBefore === 'number' &&
        Number.isFinite(log.weightedAverageCostBefore)
          ? log.weightedAverageCostBefore
          : fallbackPrice;
      const newPrevailingWacPhp =
        typeof log.weightedAverageCostAfter === 'number' &&
        Number.isFinite(log.weightedAverageCostAfter)
          ? log.weightedAverageCostAfter
          : computeWeightedAverageCostAfterDelivery({
              currentStockLiters: log.balanceBefore,
              currentWacPhp: previousWacPhp,
              deliveredLiters,
              deliveryUnitCostPhp,
            });

      return {
        logId: log.id,
        timestamp: log.verifiedAt || log.createdAt,
        gsoTransactionCode: log.gsoTransactionCode || '—',
        referenceNumber: log.referenceNumber,
        depotId: log.depotId,
        depotName: log.depotName,
        tankId: log.tankId,
        tankCode: tank?.tankCode,
        tankName: tank?.name,
        fuelType: log.fuelType,
        stockBeforeLiters: log.balanceBefore,
        deliveredLiters,
        stockAfterLiters: log.balanceAfter,
        previousWacPhp,
        deliveryUnitCostPhp,
        newPrevailingWacPhp,
        approvalStatus: log.approvalStatus,
      };
    })
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/**
 * Resolves the prevailing Weighted Average Cost (PHP/L) for a specific fuel tank (when `tankId`
 * is provided) or fuel class vis-a-vis the actual dispensing/delivery timestamp.
 * Because deliveries occur per tank at differing prices, tank-scoped lookup isolates each
 * tank's WAC history from other tanks storing the same fuel class.
 */
export function resolvePrevailingWeightedAverageCost(params: {
  fuelType: FuelType;
  timestampIso?: string | null;
  inventoryLogs: ReadonlyArray<InventoryLog>;
  depots: ReadonlyArray<FuelDepot>;
  storageTanks?: ReadonlyArray<StorageTank>;
  depotId?: string;
  tankId?: string;
}): number {
  const { fuelType, timestampIso, inventoryLogs, depots, storageTanks = [], depotId, tankId } =
    params;
  const targetMs = timestampIso ? Date.parse(timestampIso) : Number.POSITIVE_INFINITY;

  const extractVerifiedDeliveries = (filterByTank: boolean) =>
    inventoryLogs
      .filter((log) => {
        if (log.transactionType !== 'delivery' || log.approvalStatus !== 'verified') return false;
        if (log.fuelType !== fuelType) return false;
        if (filterByTank && tankId && log.tankId !== tankId) return false;
        const wac = log.weightedAverageCostAfter ?? log.prevailingWeightedAverageCostPhp;
        return typeof wac === 'number' && Number.isFinite(wac) && wac > 0;
      })
      .map((log) => ({
        log,
        tsMs: Date.parse(log.verifiedAt || log.createdAt || ''),
        wacAfter: Number(log.weightedAverageCostAfter ?? log.prevailingWeightedAverageCostPhp),
      }))
      .filter((entry) => !Number.isNaN(entry.tsMs))
      .sort((a, b) => {
        if (b.tsMs !== a.tsMs) return b.tsMs - a.tsMs;
        if (tankId) {
          const aTankMatch = a.log.tankId === tankId ? 1 : 0;
          const bTankMatch = b.log.tankId === tankId ? 1 : 0;
          if (bTankMatch !== aTankMatch) return bTankMatch - aTankMatch;
        }
        if (depotId) {
          const aMatch = a.log.depotId === depotId ? 1 : 0;
          const bMatch = b.log.depotId === depotId ? 1 : 0;
          if (bMatch !== aMatch) return bMatch - aMatch;
        }
        return b.log.id.localeCompare(a.log.id);
      });

  // 1. Per-Tank strict WAC resolution whenever tankId is supplied
  if (tankId) {
    const tankDeliveries = extractVerifiedDeliveries(true);
    const prevailingForTank = tankDeliveries.find((entry) => entry.tsMs <= targetMs);
    if (prevailingForTank) {
      return Math.round(prevailingForTank.wacAfter * 10000) / 10000;
    }
    if (tankDeliveries.length > 0 && Number.isFinite(targetMs)) {
      const earliestForTank = tankDeliveries[tankDeliveries.length - 1];
      if (
        typeof earliestForTank.log.weightedAverageCostBefore === 'number' &&
        Number.isFinite(earliestForTank.log.weightedAverageCostBefore) &&
        earliestForTank.log.weightedAverageCostBefore > 0
      ) {
        return Math.round(earliestForTank.log.weightedAverageCostBefore * 10000) / 10000;
      }
    }
    const matchedTank = storageTanks.find((t) => t.id === tankId);
    if (
      matchedTank &&
      typeof matchedTank.currentWacPhp === 'number' &&
      Number.isFinite(matchedTank.currentWacPhp) &&
      matchedTank.currentWacPhp > 0
    ) {
      return Math.round(matchedTank.currentWacPhp * 10000) / 10000;
    }
    // Fall back to the tank's own depot baseline price (do NOT leak another tank's differing delivery price!)
    const tankDepot =
      (matchedTank ? depots.find((d) => d.id === matchedTank.depotId) : undefined) ??
      (depotId ? depots.find((d) => d.id === depotId) : undefined) ??
      depots[0];
    const tankFallback =
      fuelType === 'gasoline'
        ? tankDepot?.gasolinePricePerLiter ?? 64.5
        : tankDepot?.dieselPricePerLiter ?? 58.2;
    return Math.round(tankFallback * 10000) / 10000;
  }

  // 2. Fuel-class / Depot-level fallback when no specific tankId is requested
  const verifiedDeliveries = extractVerifiedDeliveries(false);

  // Latest verified delivery at or before the actual dispensing timestamp
  const prevailingAtOrBefore = verifiedDeliveries.find((entry) => entry.tsMs <= targetMs);
  if (prevailingAtOrBefore) {
    return Math.round(prevailingAtOrBefore.wacAfter * 10000) / 10000;
  }

  // If timestamp predates the earliest delivery log, check earliest log's weightedAverageCostBefore
  if (verifiedDeliveries.length > 0 && Number.isFinite(targetMs)) {
    const earliest = verifiedDeliveries[verifiedDeliveries.length - 1];
    if (
      typeof earliest.log.weightedAverageCostBefore === 'number' &&
      Number.isFinite(earliest.log.weightedAverageCostBefore) &&
      earliest.log.weightedAverageCostBefore > 0
    ) {
      return Math.round(earliest.log.weightedAverageCostBefore * 10000) / 10000;
    }
  }

  // Fall back to depot price or standard baseline
  const matchedDepot = depotId ? depots.find((d) => d.id === depotId) : depots[0];
  const fallback =
    fuelType === 'gasoline'
      ? matchedDepot?.gasolinePricePerLiter ?? depots[0]?.gasolinePricePerLiter ?? 64.5
      : matchedDepot?.dieselPricePerLiter ?? depots[0]?.dieselPricePerLiter ?? 58.2;
  return Math.round(fallback * 10000) / 10000;
}

export function matchTicketToPmcProject(
  ticket: Pick<TripTicket, 'pmcProjectId' | 'projectAip' | 'scheduledDate' | 'createdAt' | 'workPlanId'>,
  project: Pick<PmcProject, 'id' | 'aipCode' | 'approvalYear'>,
  workPlanById?: ReadonlyMap<string, Pick<WorkPlan, 'projectCode' | 'weekStart'>>
): boolean {
  if (ticket.pmcProjectId && ticket.pmcProjectId === project.id) {
    return true;
  }
  const wp = workPlanById?.get(ticket.workPlanId);
  const ticketAip = (ticket.projectAip || wp?.projectCode || '').trim().toUpperCase();
  if (!ticketAip) return false;
  if (ticketAip !== project.aipCode.trim().toUpperCase()) return false;
  const dateRef = ticket.scheduledDate || wp?.weekStart || ticket.createdAt || '';
  const yrStr = dateRef.slice(0, 4);
  if (/^\d{4}$/.test(yrStr) && Number(yrStr) !== project.approvalYear) {
    return false;
  }
  return true;
}

export interface PmcFuelClassLedger {
  fuelType: FuelType;
  capPhp: number;
  requestedLiters: number;
  approvedLiters: number;
  dispensedLiters: number;
  actualDispensedCostPhp: number;
  runningBalancePhp: number;
  pendingAndApprovedCommittedPhp: number;
  availableForNewRequestPhp: number;
  currentPrevailingWacPhp: number;
}

export interface PmcProjectFuelRequestRow {
  ticket: TripTicket;
  workPlanNumber: string;
  equipmentClass?: EquipmentClass;
  prevailingWacPhp: number;
  dispensedCostPhp: number;
}

export interface PmcProjectFuelSummary {
  project: PmcProject;
  diesel: PmcFuelClassLedger;
  gasoline: PmcFuelClassLedger;
  totalCapPhp: number;
  totalActualDispensedCostPhp: number;
  totalRunningBalancePhp: number;
  requestRows: PmcProjectFuelRequestRow[];
}

/**
 * Computes per-fuel-class (Diesel & Gasoline) running balances and detailed fuel request
 * status breakdown for a given PMC Project.
 * Running Balance = Fuel Class POW Cap - SUM(Actual Dispensed Liters * Prevailing WAC at dispensing timestamp).
 */
export function computePmcProjectFuelSummary(params: {
  project: PmcProject;
  tickets: ReadonlyArray<TripTicket>;
  workPlans: ReadonlyArray<WorkPlan>;
  vehicles: ReadonlyArray<FleetVehicle>;
  inventoryLogs: ReadonlyArray<InventoryLog>;
  depots: ReadonlyArray<FuelDepot>;
}): PmcProjectFuelSummary {
  const project = normalizePmcProject(params.project);
  const wpMap = new Map(params.workPlans.map((wp) => [wp.id, wp]));
  const vehMap = new Map(params.vehicles.map((v) => [v.id, v]));

  const currentDieselWac = resolvePrevailingWeightedAverageCost({
    fuelType: 'diesel',
    inventoryLogs: params.inventoryLogs,
    depots: params.depots,
  });
  const currentGasolineWac = resolvePrevailingWeightedAverageCost({
    fuelType: 'gasoline',
    inventoryLogs: params.inventoryLogs,
    depots: params.depots,
  });

  const makeEmpty = (fuelType: FuelType, capPhp: number, wac: number): PmcFuelClassLedger => ({
    fuelType,
    capPhp,
    requestedLiters: 0,
    approvedLiters: 0,
    dispensedLiters: 0,
    actualDispensedCostPhp: 0,
    runningBalancePhp: capPhp,
    pendingAndApprovedCommittedPhp: 0,
    availableForNewRequestPhp: capPhp,
    currentPrevailingWacPhp: wac,
  });

  const diesel = makeEmpty('diesel', project.dieselFuelComponentPhp, currentDieselWac);
  const gasoline = makeEmpty('gasoline', project.gasolineFuelComponentPhp, currentGasolineWac);
  const requestRows: PmcProjectFuelRequestRow[] = [];

  const linkedTickets = params.tickets
    .filter((t) => matchTicketToPmcProject(t, project, wpMap))
    .sort((a, b) => (b.dispensedAt || b.scheduledDate || b.createdAt || '').localeCompare(a.dispensedAt || a.scheduledDate || a.createdAt || ''));

  for (const t of linkedTickets) {
    const ledger = t.fuelType === 'diesel' ? diesel : gasoline;
    const wp = wpMap.get(t.workPlanId);
    const veh = vehMap.get(t.vehicleId);

    ledger.requestedLiters = Math.round((ledger.requestedLiters + (Number(t.requestedLiters) || 0)) * 10) / 10;
    ledger.approvedLiters = Math.round((ledger.approvedLiters + (Number(t.approvedLiters) || 0)) * 10) / 10;
    ledger.dispensedLiters = Math.round((ledger.dispensedLiters + (Number(t.dispensedLiters) || 0)) * 10) / 10;

    // Resolve prevailing WAC vis-a-vis the actual dispensing timestamp
    const prevailingWacPhp = t.servedOnce && t.dispensedAt
      ? resolvePrevailingWeightedAverageCost({
          fuelType: t.fuelType,
          timestampIso: t.dispensedAt,
          inventoryLogs: params.inventoryLogs,
          depots: params.depots,
          depotId: t.depotId,
        })
      : ledger.currentPrevailingWacPhp;

    const dispensedCostPhp =
      t.servedOnce && t.dispensedLiters > 0
        ? Math.round(t.dispensedLiters * prevailingWacPhp * 100) / 100
        : 0;

    ledger.actualDispensedCostPhp = Math.round((ledger.actualDispensedCostPhp + dispensedCostPhp) * 100) / 100;

    // Non-dispensed, non-rejected, non-forfeited tickets represent active aggregate fuel requests
    if (!t.servedOnce && (t.status === 'pending' || t.status === 'approved' || t.status === 'reduced')) {
      const committedLiters = t.status === 'pending' ? t.requestedLiters : t.approvedLiters;
      const committedPhp = Math.round(committedLiters * ledger.currentPrevailingWacPhp * 100) / 100;
      ledger.pendingAndApprovedCommittedPhp =
        Math.round((ledger.pendingAndApprovedCommittedPhp + committedPhp) * 100) / 100;
    }

    requestRows.push({
      ticket: t,
      workPlanNumber: wp ? getWorkPlanDisplayLabel(wp) : t.workPlanId,
      equipmentClass: veh?.equipmentClass,
      prevailingWacPhp,
      dispensedCostPhp,
    });
  }

  for (const ledger of [diesel, gasoline]) {
    ledger.runningBalancePhp = Math.max(
      0,
      Math.round((ledger.capPhp - ledger.actualDispensedCostPhp) * 100) / 100
    );
    ledger.availableForNewRequestPhp = Math.round(
      (ledger.capPhp - ledger.actualDispensedCostPhp - ledger.pendingAndApprovedCommittedPhp) * 100
    ) / 100;
  }

  const totalCapPhp = Math.round((diesel.capPhp + gasoline.capPhp) * 100) / 100;
  const totalActualDispensedCostPhp =
    Math.round((diesel.actualDispensedCostPhp + gasoline.actualDispensedCostPhp) * 100) / 100;
  const totalRunningBalancePhp =
    Math.round((diesel.runningBalancePhp + gasoline.runningBalancePhp) * 100) / 100;

  return {
    project,
    diesel,
    gasoline,
    totalCapPhp,
    totalActualDispensedCostPhp,
    totalRunningBalancePhp,
    requestRows,
  };
}

export interface PmcCapValidationIssue {
  ticketIndex: number;
  pmcProjectId?: string;
  aipCode?: string;
  fuelType?: FuelType;
  message: string;
}

export function validateDraftTicketsAgainstPmcCaps(params: {
  draftTickets: ReadonlyArray<{
    vehicleId: string;
    pmcProjectId?: string;
    projectAip?: string;
    requestedLiters: number;
    depotId?: string;
  }>;
  vehicles: ReadonlyArray<FleetVehicle>;
  pmcProjects: ReadonlyArray<PmcProject>;
  existingTickets: ReadonlyArray<TripTicket>;
  workPlans: ReadonlyArray<WorkPlan>;
  inventoryLogs: ReadonlyArray<InventoryLog>;
  depots: ReadonlyArray<FuelDepot>;
}): { valid: boolean; issues: PmcCapValidationIssue[] } {
  const vehMap = new Map(params.vehicles.map((v) => [v.id, v]));
  const projectMap = new Map(params.pmcProjects.map((p) => [p.id, normalizePmcProject(p)]));
  const issues: PmcCapValidationIssue[] = [];

  // Track aggregated new draft liters per (pmcProjectId, fuelType)
  const draftAgg = new Map<
    string,
    { project: PmcProject; fuelType: FuelType; totalDraftLiters: number; firstIdx: number; depotId?: string }
  >();

  params.draftTickets.forEach((draft, idx) => {
    const veh = vehMap.get(draft.vehicleId);
    if (!veh) return;

    const needsPmc = requiresPmcRegistryReference(veh.equipmentClass);
    const chosenProject = draft.pmcProjectId ? projectMap.get(draft.pmcProjectId) : undefined;

    if (needsPmc && !chosenProject) {
      issues.push({
        ticketIndex: idx,
        fuelType: veh.fuelType,
        message: `Ticket #${idx + 1} (${veh.plateNumber} — ${EQUIPMENT_CLASS_SPECS[veh.equipmentClass].label}) requires selecting a registered AIP & Project Name from the PMC Project Registry.`,
      });
      return;
    }

    if (chosenProject) {
      const aggKey = `${chosenProject.id}::${veh.fuelType}`;
      const existing = draftAgg.get(aggKey);
      const liters = Math.max(0, Number(draft.requestedLiters) || 0);
      if (existing) {
        existing.totalDraftLiters = Math.round((existing.totalDraftLiters + liters) * 10) / 10;
      } else {
        draftAgg.set(aggKey, {
          project: chosenProject,
          fuelType: veh.fuelType,
          totalDraftLiters: liters,
          firstIdx: idx,
          depotId: draft.depotId,
        });
      }
    }
  });

  // Validate each aggregated (project, fuelType) against that fuel class's POW cap
  for (const agg of draftAgg.values()) {
    const summary = computePmcProjectFuelSummary({
      project: agg.project,
      tickets: params.existingTickets,
      workPlans: params.workPlans,
      vehicles: params.vehicles,
      inventoryLogs: params.inventoryLogs,
      depots: params.depots,
    });
    const classLedger = agg.fuelType === 'diesel' ? summary.diesel : summary.gasoline;
    const draftCostPhp =
      Math.round(agg.totalDraftLiters * classLedger.currentPrevailingWacPhp * 100) / 100;
    const projectedTotalPhp =
      Math.round(
        (classLedger.actualDispensedCostPhp +
          classLedger.pendingAndApprovedCommittedPhp +
          draftCostPhp) *
          100
      ) / 100;

    if (projectedTotalPhp > classLedger.capPhp + 0.01) {
      const fuelLabel = agg.fuelType === 'diesel' ? 'Diesel' : 'Gasoline';
      const remainingPhp = Math.max(0, classLedger.availableForNewRequestPhp);
      const approxMaxLiters =
        classLedger.currentPrevailingWacPhp > 0
          ? Math.floor((remainingPhp / classLedger.currentPrevailingWacPhp) * 10) / 10
          : 0;
      issues.push({
        ticketIndex: agg.firstIdx,
        pmcProjectId: agg.project.id,
        aipCode: agg.project.aipCode,
        fuelType: agg.fuelType,
        message: `Project ${agg.project.aipCode} (${agg.project.projectName}) ${fuelLabel} fuel cap exceeded: POW ${fuelLabel} cap is ₱${classLedger.capPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}, already dispensed/committed is ₱${(classLedger.actualDispensedCostPhp + classLedger.pendingAndApprovedCommittedPhp).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, and this request adds ${agg.totalDraftLiters.toFixed(1)} L (₱${draftCostPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })} @ ₱${classLedger.currentPrevailingWacPhp.toFixed(2)}/L). Remaining requestable cap: ₱${remainingPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })} (~${approxMaxLiters.toFixed(1)} L).`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function normalizeOfficeCompareKey(dept: string): string {
  return dept.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isSameOffice(
  a: string,
  b: string,
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): boolean {
  const na = normalizeOfficeCompareKey(a);
  const nb = normalizeOfficeCompareKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return getDepartmentMnemonic(a, vehicles) === getDepartmentMnemonic(b, vehicles);
}

/**
 * Returns the allowed office options for the Sandbox Role Preview selector:
 * - System Administrator & Internal Auditor (User Office roles): ONLY 'Internal Audit Service'.
 * - Tabletop Approver: ONLY "City Mayor's Office".
 * - PMC Staff: 'Project Monitoring Committee (PMC)' (plus any non-IAS RBAC user offices for that role).
 * - GSO Head / GSO Depot Dispenser: 'General Services Office (GSO)' (plus any non-IAS RBAC user offices for that role).
 * - Department Head / Department Requester: operational non-IAS departments from BAIS_DEPARTMENTS
 *   plus any custom non-IAS offices provisioned in RBAC users or Fleet Registry.
 */
export function getSandboxPreviewDepartmentsForRole(
  role: UserRole,
  users: ReadonlyArray<Pick<UserAccount, 'role' | 'department' | 'active'>> = [],
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): string[] {
  if (role === 'admin' || role === 'auditor') {
    return [USER_OFFICE_DEPARTMENT];
  }
  if (role === 'approver') {
    return [TABLETOP_APPROVER_DEPARTMENT];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const addOffice = (office: string) => {
    const trimmed = office.trim();
    if (!trimmed) return;
    if (isSameOffice(trimmed, USER_OFFICE_DEPARTMENT, vehicles)) return;
    const key = normalizeOfficeCompareKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  if (role === 'pmc_staff') {
    addOffice(PMC_OFFICE_DEPARTMENT);
    for (const u of users) {
      if (u.active !== false && u.role === 'pmc_staff') {
        addOffice(u.department);
      }
    }
    return out;
  }

  if (role === 'gso_head' || role === 'gso_dispenser') {
    addOffice(GSO_OFFICE_DEPARTMENT);
    for (const u of users) {
      if (u.active !== false && u.role === role) {
        addOffice(u.department);
      }
    }
    return out;
  }

  for (const dept of BAIS_DEPARTMENTS) {
    addOffice(dept);
  }
  for (const u of users) {
    if (u.active !== false) {
      addOffice(u.department);
    }
  }
  if (vehicles) {
    for (const v of vehicles) {
      addOffice(v.office);
    }
  }
  return out;
}

/**
 * Resolves the active office in Sandbox Role Preview for a selected role.
 * Strictly enforces:
 * - admin / auditor -> 'Internal Audit Service' (User Office)
 * - approver -> "City Mayor's Office" (Tabletop Approver)
 * - Other roles -> prefers a valid office with an active RBAC user of that role, never defaulting to IAS.
 */
export function resolveDefaultSandboxDepartmentForRole(
  role: UserRole,
  currentDepartment: string,
  users: ReadonlyArray<Pick<UserAccount, 'role' | 'department' | 'active' | 'updatedAt'>> = [],
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): string {
  const allowed = getSandboxPreviewDepartmentsForRole(role, users, vehicles);
  if (allowed.length === 1) {
    return allowed[0];
  }

  const findAllowedMatch = (dept: string): string | undefined =>
    allowed.find((opt) => isSameOffice(opt, dept, vehicles));

  const currentValid = findAllowedMatch(currentDepartment);
  const matchingRoleUsers = [...users]
    .filter((u) => u.active !== false && u.role === role && Boolean(findAllowedMatch(u.department)))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (currentValid) {
    const currentHasRbacUser = matchingRoleUsers.some((u) =>
      isSameOffice(u.department, currentValid, vehicles)
    );
    if (currentHasRbacUser || matchingRoleUsers.length === 0) {
      return currentValid;
    }
  }

  if (matchingRoleUsers.length > 0) {
    const matchedDept = findAllowedMatch(matchingRoleUsers[0].department);
    if (matchedDept) return matchedDept;
  }

  return currentValid ?? allowed[0] ?? 'City Engineering Office';
}

/**
 * Finds active RBAC users matching the previewed role and department,
 * sorted by most recently created/updated first so new or edited RBAC accounts take immediate effect.
 */
export function findMatchingRbacUsersForSandboxPreview(
  role: UserRole,
  department: string,
  users: ReadonlyArray<UserAccount>,
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>
): UserAccount[] {
  const activeRoleUsers = users
    .filter((u) => u.active !== false && u.role === role)
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));

  const exactDeptMatches = activeRoleUsers.filter((u) =>
    isSameOffice(u.department, department, vehicles)
  );
  if (exactDeptMatches.length > 0) {
    return exactDeptMatches;
  }

  // For single-office system roles (Tabletop Approver / Internal Auditor), fall back to any active user of that role
  if (role === 'approver' || role === 'auditor') {
    return activeRoleUsers;
  }

  return [];
}

/**
 * Overlays the latest RBAC user record from the registry onto an authenticated session user
 * so edits saved in User Creation & RBAC take immediate effect across the system.
 */
export function resolveActiveUserFromRegistry(
  baseUser: UserAccount,
  users: ReadonlyArray<UserAccount>
): UserAccount {
  const normEmail = baseUser.email.trim().toLowerCase();
  const matched =
    users.find((u) => u.uid === baseUser.uid) ??
    (normEmail
      ? users.find((u) => u.email.trim().toLowerCase() === normEmail)
      : undefined);

  if (!matched) return baseUser;
  const isAdmin = matched.role === 'admin';
  return {
    ...baseUser,
    ...matched,
    canEdit: isAdmin ? true : Boolean(matched.canEdit),
    canDelete: isAdmin ? true : Boolean(matched.canDelete),
    canSwitchToLive: isAdmin ? true : Boolean(matched.canSwitchToLive),
    canRequestSingleTrip: isAdmin ? true : Boolean(matched.canRequestSingleTrip),
  };
}

/**
 * Resolves the effective active UserAccount in Sandbox mode, combining:
 * 1. Latest RBAC permissions from the user registry for the signed-in account.
 * 2. Strict Sandbox Role Preview office matching (User Office = Internal Audit Service, Tabletop Approver = City Mayor's Office).
 * 3. Live RBAC permission lookup for the previewed role + office so newly created or edited RBAC permissions
 *    are immediately effected upon Save without leaking System Administrator privileges.
 */
export function resolveSandboxPreviewUser(params: {
  authenticatedUser: UserAccount;
  sandboxActiveRole: UserRole;
  sandboxActiveDepartment: string;
  users: ReadonlyArray<UserAccount>;
  selectedSandboxUserUid?: string | null;
  vehicles?: ReadonlyArray<Pick<FleetVehicle, 'office' | 'officeMnemonic'>>;
}): UserAccount {
  const resolvedAuth = resolveActiveUserFromRegistry(params.authenticatedUser, params.users);

  if (resolvedAuth.role !== 'admin') {
    return resolvedAuth;
  }

  if (params.sandboxActiveRole === 'admin') {
    return {
      ...resolvedAuth,
      department: USER_OFFICE_DEPARTMENT,
      canEdit: true,
      canDelete: true,
      canSwitchToLive: true,
      canRequestSingleTrip: true,
    };
  }

  const effectiveDept = resolveDefaultSandboxDepartmentForRole(
    params.sandboxActiveRole,
    params.sandboxActiveDepartment,
    params.users,
    params.vehicles
  );

  const matchingUsers = findMatchingRbacUsersForSandboxPreview(
    params.sandboxActiveRole,
    effectiveDept,
    params.users,
    params.vehicles
  );

  const pickedRbacUser =
    (params.selectedSandboxUserUid
      ? matchingUsers.find((u) => u.uid === params.selectedSandboxUserUid)
      : undefined) ?? matchingUsers[0];

  if (pickedRbacUser) {
    return {
      ...pickedRbacUser,
      role: params.sandboxActiveRole,
      department: effectiveDept,
      canEdit: Boolean(pickedRbacUser.canEdit),
      canDelete: Boolean(pickedRbacUser.canDelete),
      canSwitchToLive: Boolean(pickedRbacUser.canSwitchToLive),
      canRequestSingleTrip: Boolean(pickedRbacUser.canRequestSingleTrip),
    };
  }

  return {
    ...resolvedAuth,
    displayName: `${resolvedAuth.displayName} (${ROLE_LABELS[params.sandboxActiveRole]})`,
    role: params.sandboxActiveRole,
    department: effectiveDept,
    canEdit: false,
    canDelete: false,
    canSwitchToLive: false,
    canRequestSingleTrip: false,
  };
}

// ============================================================================
// Immutable Audit Trail Helpers (Latest-First, Secret-Safe, Category Routing)
// ============================================================================

const VALID_AUDIT_CATEGORIES: ReadonlySet<AuditLogCategory> = new Set([
  'credential',
  'transaction',
  'registry',
  'system',
]);

/**
 * Redacts any accidental secret-like key/value tokens (passwords, hashes, GSO verification codes)
 * before storing or displaying audit log summaries and structured details.
 */
export function sanitizeAuditDetails(raw?: string, maxLength = 1200): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const redacted = trimmed
    .replace(
      /\b(passwordHash|password|passcode|gsoVerificationCode|secret|token)\s*[:=]\s*([^\s,;|]+)/gi,
      '$1=[REDACTED]'
    )
    .slice(0, maxLength);
  return redacted.trim() || undefined;
}

export function classifyAuditLogCategory(
  log: Pick<AuditLog, 'action' | 'entityType' | 'category'>
): AuditLogCategory {
  if (log.category && VALID_AUDIT_CATEGORIES.has(log.category)) {
    return log.category;
  }
  const act = (log.action ?? '').toUpperCase();
  const ent = (log.entityType ?? '').toLowerCase();

  if (
    act.startsWith('CREDENTIAL_') ||
    act.startsWith('GOOGLE_SSO_') ||
    act.startsWith('USER_') ||
    act.startsWith('SESSION_') ||
    act.includes('VERIFICATION_REJECTED') ||
    ent === 'session' ||
    ent === 'user'
  ) {
    return 'credential';
  }

  if (
    act.startsWith('WORKPLAN_') ||
    act.startsWith('TABLETOP_') ||
    act.startsWith('FUEL_') ||
    act.startsWith('DEPOT_DELIVERY') ||
    act.startsWith('DEPOT_DISPENSE') ||
    act.startsWith('DEPOT_SHRINKAGE') ||
    act.startsWith('DEPOT_OVERAGE') ||
    act.startsWith('INVENTORY_') ||
    act.startsWith('TANK_DIPSTICK') ||
    ent === 'workplan' ||
    ent === 'tripticket' ||
    ent === 'inventorylog'
  ) {
    return 'transaction';
  }

  if (
    act.startsWith('VEHICLE_') ||
    act.startsWith('PMC_PROJECT_') ||
    act.startsWith('STORAGE_TANK_') ||
    act.startsWith('DEPOT_METADATA_') ||
    ent === 'vehicle' ||
    ent === 'pmcproject' ||
    ent === 'storagetank' ||
    ent === 'depot'
  ) {
    return 'registry';
  }

  return 'system';
}

export function formatAuditTimestamp(iso: string): string {
  const clean = (iso ?? '').trim();
  if (!clean) return '—';
  const match = clean.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  const parsed = Date.parse(clean);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().replace('T', ' ').slice(0, 19);
  }
  return clean.slice(0, 19).replace('T', ' ');
}

export function sortAuditLogsLatestFirst(logs: ReadonlyArray<AuditLog>): AuditLog[] {
  return [...logs].sort((a, b) => {
    const aMs = Date.parse(a.createdAt || '');
    const bMs = Date.parse(b.createdAt || '');
    if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && bMs !== aMs) {
      return bMs - aMs;
    }
    const isoCmp = (b.createdAt || '').localeCompare(a.createdAt || '');
    if (isoCmp !== 0) return isoCmp;
    return (b.id || '').localeCompare(a.id || '');
  });
}

export function filterAuditLogs(
  logs: ReadonlyArray<AuditLog>,
  criteria: { search?: string; category?: AuditLogCategory | 'all' } = {}
): AuditLog[] {
  const q = (criteria.search ?? '').trim().toLowerCase();
  const cat = criteria.category ?? 'all';
  return sortAuditLogsLatestFirst(logs).filter((log) => {
    if (cat !== 'all' && classifyAuditLogCategory(log) !== cat) {
      return false;
    }
    if (!q) return true;
    return (
      log.action.toLowerCase().includes(q) ||
      log.actorEmail.toLowerCase().includes(q) ||
      (log.actorName ?? '').toLowerCase().includes(q) ||
      log.actorRole.toLowerCase().includes(q) ||
      (log.department ?? '').toLowerCase().includes(q) ||
      log.entityType.toLowerCase().includes(q) ||
      log.entityId.toLowerCase().includes(q) ||
      log.summary.toLowerCase().includes(q) ||
      (log.details ?? '').toLowerCase().includes(q) ||
      log.createdAt.toLowerCase().includes(q)
    );
  });
}

export function parseAuditDetailsEntries(details?: string): Array<{ label: string; value: string }> {
  if (!details || !details.trim()) return [];
  const entries: Array<{ label: string; value: string }> = [];
  const rawParts = details
    .split(/\n|\s*\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of rawParts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0 && colonIdx < 48) {
      const label = part.slice(0, colonIdx).trim();
      const value = part.slice(colonIdx + 1).trim();
      if (label && value) {
        entries.push({ label, value });
        continue;
      }
    }
    entries.push({ label: 'Note', value: part });
  }
  return entries;
}

// ============================================================================
// Immutable Per-Fuel-Class Depot Ledger (In / Out / Adjustment + Running Vol & WAC Cost)
// ============================================================================

export function buildFuelClassLedger(params: {
  fuelType: FuelType;
  inventoryLogs: ReadonlyArray<InventoryLog>;
  depots: ReadonlyArray<FuelDepot>;
  storageTanks?: ReadonlyArray<StorageTank>;
  depotId?: string;
  tankId?: string;
  month?: string;
  year?: string;
  movementType?: FuelClassLedgerMovement | 'all';
}): {
  rows: FuelClassLedgerRow[];
  summary: FuelClassLedgerSummary;
} {
  const { fuelType, inventoryLogs, depots, storageTanks = [] } = params;
  const depotFilter = params.depotId && params.depotId !== 'all' ? params.depotId : '';
  const tankFilter = params.tankId && params.tankId !== 'all' ? params.tankId : '';
  const monthFilter = params.month && params.month !== 'all' ? params.month : '';
  const yearFilter = params.year && params.year !== 'all' ? params.year : '';
  const movementFilter = params.movementType && params.movementType !== 'all' ? params.movementType : '';

  const depotById = new Map(depots.map((d) => [d.id, d]));
  const tankById = new Map(storageTanks.map((t) => [t.id, t]));

  const scopedTanks = storageTanks.filter((t) => {
    if (t.mappedFuelType !== fuelType) return false;
    if (depotFilter && t.depotId !== depotFilter) return false;
    if (tankFilter && t.id !== tankFilter) return false;
    return true;
  });

  // Resolve bucket key per log (tankId if known, else depot fallback bucket)
  const resolveBucketKey = (log: InventoryLog): string => {
    if (log.tankId) return log.tankId;
    const defaultTank = storageTanks.find(
      (t) => t.depotId === log.depotId && t.mappedFuelType === fuelType
    );
    return defaultTank ? defaultTank.id : `depot:${log.depotId}`;
  };

  // Scope logs strictly to this fuel class, selected depot, and selected tank (if any)
  const scopedLogs = inventoryLogs
    .filter((log) => {
      if (log.fuelType !== fuelType) return false;
      if (depotFilter && log.depotId !== depotFilter) return false;
      if (tankFilter && resolveBucketKey(log) !== tankFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const aMs = Date.parse(a.createdAt || '');
      const bMs = Date.parse(b.createdAt || '');
      if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && aMs !== bMs) {
        return aMs - bMs;
      }
      const isoCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      if (isoCmp !== 0) return isoCmp;
      return (a.id || '').localeCompare(b.id || '');
    });

  // Track independent per-tank (or per-depot fallback) running volume AND effected WAC
  const verifiedDeltaByBucket = new Map<string, number>();
  for (const log of scopedLogs) {
    if (log.approvalStatus === 'verified') {
      const key = resolveBucketKey(log);
      verifiedDeltaByBucket.set(
        key,
        Math.round(((verifiedDeltaByBucket.get(key) ?? 0) + (Number(log.litersDelta) || 0)) * 10) / 10
      );
    }
  }

  const runningVolByBucket = new Map<string, number>();
  const currentWacByBucket = new Map<string, number>();

  const getFallbackPriceForDepot = (depotId: string): number => {
    const d = depotById.get(depotId) ?? depots[0];
    return fuelType === 'gasoline'
      ? d?.gasolinePricePerLiter ?? 64.5
      : d?.dieselPricePerLiter ?? 58.2;
  };

  const resolveInitialBucketWac = (bucketKey: string, depotId: string): number => {
    const earliestDeliveryForBucket = scopedLogs.find(
      (l) =>
        resolveBucketKey(l) === bucketKey &&
        l.transactionType === 'delivery' &&
        l.approvalStatus === 'verified'
    );
    if (
      earliestDeliveryForBucket &&
      typeof earliestDeliveryForBucket.weightedAverageCostBefore === 'number' &&
      earliestDeliveryForBucket.weightedAverageCostBefore > 0
    ) {
      return Math.round(earliestDeliveryForBucket.weightedAverageCostBefore * 10000) / 10000;
    }
    const tank = tankById.get(bucketKey);
    if (tank && typeof tank.currentWacPhp === 'number' && tank.currentWacPhp > 0) {
      return Math.round(tank.currentWacPhp * 10000) / 10000;
    }
    return Math.round(getFallbackPriceForDepot(depotId) * 10000) / 10000;
  };

  let openingVolumeLiters = 0;

  if (scopedTanks.length > 0) {
    for (const tank of scopedTanks) {
      const verifiedDelta = verifiedDeltaByBucket.get(tank.id) ?? 0;
      const tankOpening = Math.max(
        0,
        Math.round((Number(tank.currentBookVolumeLiters || 0) - verifiedDelta) * 10) / 10
      );
      runningVolByBucket.set(tank.id, tankOpening);
      currentWacByBucket.set(tank.id, resolveInitialBucketWac(tank.id, tank.depotId));
      openingVolumeLiters = Math.round((openingVolumeLiters + tankOpening) * 10) / 10;
    }
  } else {
    const scopedDepots = depotFilter
      ? depots.filter((d) => d.id === depotFilter)
      : [...depots];
    if (scopedDepots.length > 0) {
      for (const d of scopedDepots) {
        const key = `depot:${d.id}`;
        const currentStock =
          fuelType === 'gasoline' ? Number(d.gasolineCurrentLiters) || 0 : Number(d.dieselCurrentLiters) || 0;
        const verifiedDelta = verifiedDeltaByBucket.get(key) ?? 0;
        const depotOpening = Math.max(0, Math.round((currentStock - verifiedDelta) * 10) / 10);
        runningVolByBucket.set(key, depotOpening);
        currentWacByBucket.set(key, resolveInitialBucketWac(key, d.id));
        openingVolumeLiters = Math.round((openingVolumeLiters + depotOpening) * 10) / 10;
      }
    } else if (scopedLogs.length > 0) {
      const firstKey = resolveBucketKey(scopedLogs[0]);
      openingVolumeLiters = Math.max(0, Number(scopedLogs[0].balanceBefore) || 0);
      runningVolByBucket.set(firstKey, openingVolumeLiters);
      currentWacByBucket.set(firstKey, resolveInitialBucketWac(firstKey, scopedLogs[0].depotId));
    }
  }

  const computeTotalRunningVolume = (): number => {
    let total = 0;
    for (const vol of runningVolByBucket.values()) {
      total += vol;
    }
    return Math.round(total * 10) / 10;
  };

  const computeTotalRunningCost = (): number => {
    let total = 0;
    for (const [key, vol] of runningVolByBucket.entries()) {
      const wac = currentWacByBucket.get(key) ?? getFallbackPriceForDepot(depotFilter);
      total += vol * wac;
    }
    return Math.round(total * 100) / 100;
  };

  const chronologicalRows: FuelClassLedgerRow[] = [];

  for (const log of scopedLogs) {
    const isVerified = log.approvalStatus === 'verified';
    const bucketKey = resolveBucketKey(log);
    if (!runningVolByBucket.has(bucketKey)) {
      runningVolByBucket.set(bucketKey, Math.max(0, Number(log.balanceBefore) || 0));
    }
    if (!currentWacByBucket.has(bucketKey)) {
      currentWacByBucket.set(bucketKey, resolveInitialBucketWac(bucketKey, log.depotId));
    }

    const tankObj = tankById.get(bucketKey);
    const refs = resolveInventoryLogDisplayRefs(log);
    const movementKind: FuelClassLedgerMovement =
      log.transactionType === 'delivery'
        ? 'in'
        : log.transactionType === 'dispense'
          ? 'out'
          : 'adjustment';

    const movementLabel =
      log.transactionType === 'delivery'
        ? 'In (Delivery)'
        : log.transactionType === 'dispense'
          ? 'Out (Dispense)'
          : log.transactionType === 'overage_adjustment'
            ? 'Adjustment (Overage)'
            : 'Adjustment (Shrinkage)';

    let inLiters: number | null = null;
    let outLiters: number | null = null;
    let adjustmentLiters: number | null = null;
    const prevBucketVol = runningVolByBucket.get(bucketKey) ?? 0;
    const prevBucketWac = currentWacByBucket.get(bucketKey) ?? getFallbackPriceForDepot(log.depotId);
    let effectedWacPhp = prevBucketWac;
    let transactionCostPhp = 0;

    if (movementKind === 'in') {
      const qty = Math.round(Math.abs(Number(log.litersDelta) || 0) * 10) / 10;
      inLiters = qty;
      const unitCost =
        typeof log.deliveryUnitCostPhp === 'number' && log.deliveryUnitCostPhp > 0
          ? log.deliveryUnitCostPhp
          : prevBucketWac;

      if (isVerified) {
        const computedAfter =
          typeof log.weightedAverageCostAfter === 'number' && log.weightedAverageCostAfter > 0
            ? Math.round(log.weightedAverageCostAfter * 10000) / 10000
            : typeof log.prevailingWeightedAverageCostPhp === 'number' &&
                log.prevailingWeightedAverageCostPhp > 0
              ? Math.round(log.prevailingWeightedAverageCostPhp * 10000) / 10000
              : computeWeightedAverageCostAfterDelivery({
                  currentStockLiters: prevBucketVol,
                  currentWacPhp: prevBucketWac,
                  deliveredLiters: qty,
                  deliveryUnitCostPhp: unitCost,
                });
        runningVolByBucket.set(bucketKey, Math.round((prevBucketVol + qty) * 10) / 10);
        currentWacByBucket.set(bucketKey, computedAfter);
        effectedWacPhp = computedAfter;
      } else {
        effectedWacPhp = prevBucketWac;
      }

      transactionCostPhp =
        typeof log.deliveryTotalAmountPhp === 'number' &&
        Number.isFinite(log.deliveryTotalAmountPhp) &&
        log.deliveryTotalAmountPhp >= 0
          ? Math.round(log.deliveryTotalAmountPhp * 100) / 100
          : Math.round(qty * unitCost * 100) / 100;
    } else if (movementKind === 'out') {
      const qty = Math.round(Math.abs(Number(log.litersDelta) || 0) * 10) / 10;
      outLiters = qty;
      effectedWacPhp =
        typeof log.prevailingWeightedAverageCostPhp === 'number' &&
        log.prevailingWeightedAverageCostPhp > 0
          ? Math.round(log.prevailingWeightedAverageCostPhp * 10000) / 10000
          : prevBucketWac;

      if (isVerified) {
        runningVolByBucket.set(bucketKey, Math.max(0, Math.round((prevBucketVol - qty) * 10) / 10));
      }
      transactionCostPhp = Math.round(qty * effectedWacPhp * 100) / 100;
    } else {
      const signedAdj = Math.round((Number(log.litersDelta) || 0) * 10) / 10;
      adjustmentLiters = signedAdj;
      effectedWacPhp =
        typeof log.prevailingWeightedAverageCostPhp === 'number' &&
        log.prevailingWeightedAverageCostPhp > 0
          ? Math.round(log.prevailingWeightedAverageCostPhp * 10000) / 10000
          : prevBucketWac;

      if (isVerified) {
        runningVolByBucket.set(
          bucketKey,
          Math.max(0, Math.round((prevBucketVol + signedAdj) * 10) / 10)
        );
      }
      transactionCostPhp = Math.round(signedAdj * effectedWacPhp * 100) / 100;
    }

    const runningVolumeLiters = computeTotalRunningVolume();
    const runningCostPhp = computeTotalRunningCost();

    chronologicalRows.push({
      log,
      movementKind,
      movementLabel,
      timestamp: log.createdAt,
      txCode: log.gsoTransactionCode || '—',
      referenceText: refs.referenceText,
      tripTicketNumber: refs.tripTicketNumber,
      tankId: log.tankId ?? tankObj?.id,
      tankCode: tankObj?.tankCode,
      tankName: tankObj?.name,
      pumpId: log.pumpId,
      inLiters,
      outLiters,
      adjustmentLiters,
      runningVolumeLiters,
      effectedWacPhp,
      transactionCostPhp,
      runningCostPhp,
      isVerified,
    });
  }

  // Build per-tank breakdown snapshot for UI monitoring strip
  const tankBreakdown: TankLedgerWacSnapshot[] = scopedTanks.map((tank) => {
    const vol = runningVolByBucket.get(tank.id) ?? tank.currentBookVolumeLiters;
    const wac =
      currentWacByBucket.get(tank.id) ??
      resolvePrevailingWeightedAverageCost({
        fuelType,
        inventoryLogs,
        depots,
        storageTanks,
        depotId: tank.depotId,
        tankId: tank.id,
      });
    return {
      tankId: tank.id,
      tankCode: tank.tankCode,
      tankName: tank.name,
      depotId: tank.depotId,
      depotName: depotById.get(tank.depotId)?.name ?? tank.depotId,
      runningVolumeLiters: Math.round(vol * 10) / 10,
      currentWacPhp: Math.round(wac * 10000) / 10000,
      runningCostPhp: Math.round(vol * wac * 100) / 100,
    };
  });

  // Apply display-level period & movement filters without mutating historical running balances
  const filteredChronological = chronologicalRows.filter((row) => {
    const ts = row.timestamp || '';
    if (yearFilter && ts.slice(0, 4) !== yearFilter) return false;
    if (monthFilter && ts.slice(5, 7) !== monthFilter) return false;
    if (movementFilter && row.movementKind !== movementFilter) return false;
    return true;
  });

  // Compute summary metrics across filtered rows
  let totalInLiters = 0;
  let totalOutLiters = 0;
  let netAdjustmentLiters = 0;
  let totalInCostPhp = 0;
  let totalOutCostPhp = 0;
  let netAdjustmentCostPhp = 0;
  let verifiedCount = 0;
  let pendingCount = 0;

  for (const row of filteredChronological) {
    if (row.isVerified) {
      verifiedCount += 1;
      if (row.movementKind === 'in' && row.inLiters !== null) {
        totalInLiters = Math.round((totalInLiters + row.inLiters) * 10) / 10;
        totalInCostPhp = Math.round((totalInCostPhp + row.transactionCostPhp) * 100) / 100;
      } else if (row.movementKind === 'out' && row.outLiters !== null) {
        totalOutLiters = Math.round((totalOutLiters + row.outLiters) * 10) / 10;
        totalOutCostPhp = Math.round((totalOutCostPhp + row.transactionCostPhp) * 100) / 100;
      } else if (row.movementKind === 'adjustment' && row.adjustmentLiters !== null) {
        netAdjustmentLiters = Math.round((netAdjustmentLiters + row.adjustmentLiters) * 10) / 10;
        netAdjustmentCostPhp = Math.round((netAdjustmentCostPhp + row.transactionCostPhp) * 100) / 100;
      }
    } else {
      pendingCount += 1;
    }
  }

  const latestRowInScope =
    filteredChronological.length > 0
      ? filteredChronological[filteredChronological.length - 1]
      : chronologicalRows.length > 0
        ? chronologicalRows[chronologicalRows.length - 1]
        : null;

  const closingVolumeLiters = latestRowInScope
    ? latestRowInScope.runningVolumeLiters
    : computeTotalRunningVolume();
  const closingInventoryCostPhp = latestRowInScope
    ? latestRowInScope.runningCostPhp
    : computeTotalRunningCost();

  const resolvedCurrentWac =
    tankFilter && currentWacByBucket.has(tankFilter)
      ? Math.round((currentWacByBucket.get(tankFilter) ?? 0) * 10000) / 10000
      : closingVolumeLiters > 0
        ? Math.round((closingInventoryCostPhp / closingVolumeLiters) * 10000) / 10000
        : resolvePrevailingWeightedAverageCost({
            fuelType,
            inventoryLogs,
            depots,
            storageTanks,
            depotId: depotFilter || undefined,
            tankId: tankFilter || undefined,
          });

  return {
    rows: [...filteredChronological].reverse(),
    summary: {
      fuelType,
      openingVolumeLiters,
      totalInLiters,
      totalOutLiters,
      netAdjustmentLiters,
      closingVolumeLiters,
      currentEffectedWacPhp: resolvedCurrentWac,
      closingInventoryCostPhp,
      totalInCostPhp,
      totalOutCostPhp,
      netAdjustmentCostPhp,
      verifiedCount,
      pendingCount,
      tankBreakdown,
    },
  };
}




