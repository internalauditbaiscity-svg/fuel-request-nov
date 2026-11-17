import {
  DailyReconciliationSummary,
  DiscrepancyAlert,
  EfficiencyUnit,
  EnvironmentMode,
  EquipmentClass,
  EQUIPMENT_CLASS_SPECS,
  FleetVehicle,
  FuelDepot,
  FuelType,
  InventoryLog,
  NavSection,
  TripTicket,
  TripTicketStatus,
  UserAccount,
  UserRole,
  WorkPlan,
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

export function addDaysIso(isoDate: string, days: number): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return dt.toISOString().slice(0, 10);
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

// Synchronous deterministic SHA-256 hex digest for credential verification (browser & Node safe)
export function hashPassword(plain: string): string {
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

// RBAC Permission Helpers
const ALL_NAV_SECTIONS: NavSection[] = [
  'dashboard',
  'fleet',
  'work_plans',
  'approvals',
  'dispensing',
  'inventory',
  'users',
  'reports',
  'audit',
];

export function getAllowedNavSections(role: UserRole): NavSection[] {
  switch (role) {
    case 'admin':
      return [...ALL_NAV_SECTIONS];
    case 'department_head':
    case 'requester':
      return ['work_plans'];
    case 'gso_head':
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
  recordDepartment: string
): boolean {
  if (hasCityWideAccess(role)) return true;
  return userDepartment.trim().toLowerCase() === recordDepartment.trim().toLowerCase();
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

export function canPreviewAndDownloadPdf(role: UserRole): boolean {
  return role === 'admin' || role === 'approver' || role === 'auditor' || role === 'department_head' || role === 'requester';
}

export function canPerformTabletopApproval(role: UserRole): boolean {
  return role === 'admin' || role === 'approver';
}

export function canDispenseAtGso(role: UserRole): boolean {
  return role === 'admin' || role === 'gso_head' || role === 'gso_dispenser';
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
    role === 'gso_dispenser' ||
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

export type TicketMandatoryField =
  | 'vehicleId'
  | 'driverName'
  | 'depotId'
  | 'purposeOrProject'
  | 'destination'
  | 'scheduledDate'
  | 'requestedLiters';

export interface TicketMandatoryCheckInput {
  vehicleId: string;
  driverName: string;
  depotId: string;
  purposeOrProject: string;
  destination: string;
  scheduledDate: string;
  requestedLiters: number;
}

export function getMissingTicketMandatoryFields(
  ticket: TicketMandatoryCheckInput
): TicketMandatoryField[] {
  const missing: TicketMandatoryField[] = [];
  if (!ticket.vehicleId || !ticket.vehicleId.trim()) missing.push('vehicleId');
  if (!ticket.driverName || !ticket.driverName.trim()) missing.push('driverName');
  if (!ticket.depotId || !ticket.depotId.trim()) missing.push('depotId');
  if (!ticket.purposeOrProject || !ticket.purposeOrProject.trim()) missing.push('purposeOrProject');
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
        .map((t) => `${t.ticketNumber} ${t.plateNumber} ${t.driverName}`)
        .join(' ');
      const haystack =
        `${wp.controlNumber} ${wp.projectTitle} ${wp.department} ${wp.projectCode} ${ticketHay}`.toLowerCase();
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
    workPlanMap.set(wp.id, wp.controlNumber);
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
        workPlanNumber,
        ticket.plateNumber,
        ticket.driverName,
        ticket.department,
        ticket.purposeOrProject ?? '',
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
  const cleanId = params.identifier.trim().toLowerCase();
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
      (u.username && u.username.trim().toLowerCase() === cleanId) ||
      u.email.trim().toLowerCase() === cleanId
  );

  if (matchingAccounts.length === 0) {
    return {
      ok: false,
      error:
        'Account Name not recognized on this device. If you are using a different Gmail account or Live Cloud profile, click "Sign In with Google (Live Cloud)" below or contact your Administrator.',
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
    return {
      uid: params.uid,
      username: (src.username || emailId).trim().toLowerCase().slice(0, 64),
      ...(src.passwordHash ? { passwordHash: src.passwordHash } : {}),
      email: cleanEmail,
      displayName: (src.displayName || params.displayName || cleanEmail).trim().slice(0, 120) || 'City Staff',
      role,
      department: (src.department || 'City Engineering Office').trim().slice(0, 120),
      positionTitle: (src.positionTitle || 'Staff').trim().slice(0, 120),
      canEdit: isAdminRole ? true : Boolean(src.canEdit),
      canDelete: isAdminRole ? true : Boolean(src.canDelete),
      canSwitchToLive: isAdminRole ? true : Boolean(src.canSwitchToLive),
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
    active: true,
    createdBy: 'self',
    createdAt: now,
    updatedAt: now,
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
      byEmail.set(key, user);
    } else if (!existingIsPlaceholder && currentIsPlaceholder) {
      continue;
    } else if ((user.updatedAt || '') > (existing.updatedAt || '')) {
      byEmail.set(key, user);
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
  const cleanUsername = (user.username || '').trim().toLowerCase();
  const isAdminRole = user.role === 'admin';
  const payload: Record<string, unknown> = {
    id: inviteId,
    email: cleanEmail.slice(0, 254),
    ...(cleanUsername.length >= 2 ? { username: cleanUsername.slice(0, 64) } : {}),
    ...(user.passwordHash ? { passwordHash: user.passwordHash.slice(0, 128) } : {}),
    displayName: (user.displayName || cleanEmail).trim().slice(0, 120) || 'City Staff',
    role: user.role,
    department: (user.department || 'City Engineering Office').trim().slice(0, 120),
    positionTitle: (user.positionTitle || 'Staff').trim().slice(0, 120),
    canEdit: isAdminRole ? true : Boolean(user.canEdit),
    canDelete: isAdminRole ? true : Boolean(user.canDelete),
    canSwitchToLive: isAdminRole ? true : Boolean(user.canSwitchToLive),
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
    if (typeof cleaned.username === 'string' && cleaned.username.trim().length < 2) {
      delete cleaned.username;
    }
    if (typeof cleaned.email === 'string') {
      cleaned.email = cleaned.email.trim().toLowerCase().slice(0, 254);
    }
    if (typeof cleaned.displayName === 'string') {
      cleaned.displayName = cleaned.displayName.trim().slice(0, 120);
    }
    if (typeof cleaned.department === 'string') {
      cleaned.department = cleaned.department.trim().slice(0, 120);
    }
    return cleaned;
  }

  if (options?.collection === 'auditLogs') {
    if (options.isCreate && firebaseUid) {
      cleaned.actorUid = firebaseUid;
    }
    if (typeof cleaned.summary === 'string') {
      const trimmedSummary = cleaned.summary.trim().slice(0, 400);
      cleaned.summary = trimmedSummary.length < 2 ? 'Audit entry' : trimmedSummary;
    }
    return cleaned;
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

