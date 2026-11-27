import { FuelDepot, FuelType, InventoryLog, StorageTank, TankFuelProduct } from '../types/fuel';
import {
  calculateVolumeFromDip,
  getCalibrationHealthStatus,
  getTankMaxLiquidHeightCm,
  TANK_FUEL_PRODUCT_STYLES,
  TANK_GEOMETRY_LABELS,
} from './tankRegistryEngine';

export type UstFuelGrade = TankFuelProduct;

export type DipstickLogMode = 'routine_check' | 'pre_delivery_check';

export interface UstFuelGradeStyle {
  label: string;
  shortLabel: string;
  hex: string;
  topBarClass: string;
  badgeBgClass: string;
  badgeTextClass: string;
  ringClass: string;
  mappedDepotFuelType: FuelType;
}

/**
 * API Standard Fuel Grade Color Coding synchronized with Master Tank Registry.
 */
export const UST_FUEL_GRADE_STYLES: Record<UstFuelGrade, UstFuelGradeStyle> = {
  diesel: {
    label: TANK_FUEL_PRODUCT_STYLES.diesel.label,
    shortLabel: TANK_FUEL_PRODUCT_STYLES.diesel.shortLabel,
    hex: TANK_FUEL_PRODUCT_STYLES.diesel.hex,
    topBarClass: TANK_FUEL_PRODUCT_STYLES.diesel.topBarClass,
    badgeBgClass: TANK_FUEL_PRODUCT_STYLES.diesel.badgeBgClass,
    badgeTextClass: TANK_FUEL_PRODUCT_STYLES.diesel.badgeTextClass,
    ringClass: 'focus:ring-[#F59E0B]',
    mappedDepotFuelType: 'diesel',
  },
  regular_91: {
    label: TANK_FUEL_PRODUCT_STYLES.regular_91.label,
    shortLabel: TANK_FUEL_PRODUCT_STYLES.regular_91.shortLabel,
    hex: TANK_FUEL_PRODUCT_STYLES.regular_91.hex,
    topBarClass: TANK_FUEL_PRODUCT_STYLES.regular_91.topBarClass,
    badgeBgClass: TANK_FUEL_PRODUCT_STYLES.regular_91.badgeBgClass,
    badgeTextClass: TANK_FUEL_PRODUCT_STYLES.regular_91.badgeTextClass,
    ringClass: 'focus:ring-[#EF4444]',
    mappedDepotFuelType: 'gasoline',
  },
  mid_grade: {
    label: TANK_FUEL_PRODUCT_STYLES.mid_grade.label,
    shortLabel: TANK_FUEL_PRODUCT_STYLES.mid_grade.shortLabel,
    hex: TANK_FUEL_PRODUCT_STYLES.mid_grade.hex,
    topBarClass: TANK_FUEL_PRODUCT_STYLES.mid_grade.topBarClass,
    badgeBgClass: TANK_FUEL_PRODUCT_STYLES.mid_grade.badgeBgClass,
    badgeTextClass: TANK_FUEL_PRODUCT_STYLES.mid_grade.badgeTextClass,
    ringClass: 'focus:ring-[#3B82F6]',
    mappedDepotFuelType: 'gasoline',
  },
  premium_95: {
    label: TANK_FUEL_PRODUCT_STYLES.premium_95.label,
    shortLabel: TANK_FUEL_PRODUCT_STYLES.premium_95.shortLabel,
    hex: TANK_FUEL_PRODUCT_STYLES.premium_95.hex,
    topBarClass: TANK_FUEL_PRODUCT_STYLES.premium_95.topBarClass,
    badgeBgClass: TANK_FUEL_PRODUCT_STYLES.premium_95.badgeBgClass,
    badgeTextClass: TANK_FUEL_PRODUCT_STYLES.premium_95.badgeTextClass,
    ringClass: 'focus:ring-[#10B981]',
    mappedDepotFuelType: 'gasoline',
  },
  kerosene: {
    label: TANK_FUEL_PRODUCT_STYLES.kerosene.label,
    shortLabel: TANK_FUEL_PRODUCT_STYLES.kerosene.shortLabel,
    hex: TANK_FUEL_PRODUCT_STYLES.kerosene.hex,
    topBarClass: TANK_FUEL_PRODUCT_STYLES.kerosene.topBarClass,
    badgeBgClass: TANK_FUEL_PRODUCT_STYLES.kerosene.badgeBgClass,
    badgeTextClass: TANK_FUEL_PRODUCT_STYLES.kerosene.badgeTextClass,
    ringClass: 'focus:ring-[#8B5CF6]',
    mappedDepotFuelType: 'diesel',
  },
  bio_diesel: {
    label: TANK_FUEL_PRODUCT_STYLES.bio_diesel.label,
    shortLabel: TANK_FUEL_PRODUCT_STYLES.bio_diesel.shortLabel,
    hex: TANK_FUEL_PRODUCT_STYLES.bio_diesel.hex,
    topBarClass: TANK_FUEL_PRODUCT_STYLES.bio_diesel.topBarClass,
    badgeBgClass: TANK_FUEL_PRODUCT_STYLES.bio_diesel.badgeBgClass,
    badgeTextClass: TANK_FUEL_PRODUCT_STYLES.bio_diesel.badgeTextClass,
    ringClass: 'focus:ring-[#D97706]',
    mappedDepotFuelType: 'diesel',
  },
};

export interface UstTankRecord {
  tankId: string;
  storageTankId?: string;
  tankNumber: string;
  stationId: string;
  stationName: string;
  depotId?: string;
  locationZone?: string;
  fuelGrade: UstFuelGrade;
  capacityLiters: number;
  safeFillCapacityLiters?: number;
  deadstockVolumeLiters?: number;
  maxDipHeightCm: number;
  riserOffsetCm?: number;
  maxRawDipCm?: number;
  strappingLitersPerCm: number;
  geometryLabel?: string;
  usingCustomStrapping?: boolean;
  connectedDispensers?: string[];
  calibrationStatus?: 'active' | 'expiring_soon' | 'calibration_due';
  bookVolumeLiters: number;
  lastRecordedVolumeLiters: number;
  lastRecordedAt: string;
  deliveryUllageThresholdLiters: number;
}

export const OVERFILL_SAFETY_BUFFER_LITERS = 500;
export const WATER_ALERT_THRESHOLD_CM = 0.5;
export const VARIANCE_REDIP_THRESHOLD_PCT = 0.5;

/**
 * Projects live Master Registry StorageTank records into UstTankRecord view models
 * consumed by the Dipstick Logging & Pre-Delivery Check module.
 */
export function buildUstTanksFromMasterRegistry(
  storageTanks: ReadonlyArray<StorageTank>,
  depots: ReadonlyArray<FuelDepot>
): UstTankRecord[] {
  const depotById = new Map(depots.map((d) => [d.id, d]));

  return storageTanks.map((tank) => {
    const depot = depotById.get(tank.depotId);
    const maxLiquidHeightCm = getTankMaxLiquidHeightCm(tank);
    const riserOffsetCm = Math.max(0, tank.riserOffsetCm || 0);
    const maxRawDipCm = Math.round((maxLiquidHeightCm + riserOffsetCm) * 10) / 10;
    const avgLitersPerCm =
      maxLiquidHeightCm > 0
        ? Math.round((tank.grossCapacityLiters / maxLiquidHeightCm) * 10) / 10
        : 0;
    const calHealth = getCalibrationHealthStatus(tank.calibrationExpiryDate);

    return {
      tankId: tank.tankCode,
      storageTankId: tank.id,
      tankNumber: tank.name,
      stationId: depot?.siteCode || `STA-${tank.depotId.toUpperCase()}`,
      stationName: depot?.name || 'Bais City Fuel Depot',
      depotId: tank.depotId,
      locationZone: tank.locationZone,
      fuelGrade: tank.fuelProduct,
      capacityLiters: tank.grossCapacityLiters,
      safeFillCapacityLiters: tank.safeFillCapacityLiters,
      deadstockVolumeLiters: tank.deadstockVolumeLiters,
      maxDipHeightCm: maxLiquidHeightCm,
      riserOffsetCm,
      maxRawDipCm,
      strappingLitersPerCm: avgLitersPerCm,
      geometryLabel: TANK_GEOMETRY_LABELS[tank.geometry],
      usingCustomStrapping: Boolean(
        tank.customStrappingPoints && tank.customStrappingPoints.length >= 2
      ),
      connectedDispensers: tank.connectedDispensers,
      calibrationStatus: calHealth.status,
      bookVolumeLiters: tank.currentBookVolumeLiters,
      lastRecordedVolumeLiters: tank.lastDipVolumeLiters ?? tank.currentBookVolumeLiters,
      lastRecordedAt: tank.lastDipAt || tank.updatedAt,
      deliveryUllageThresholdLiters: Math.max(2000, tank.lowStockAlertLiters),
    };
  });
}

/**
 * Fallback builder when no StorageTank Master Registry records are available.
 */
export function buildInitialUstTanks(depots: ReadonlyArray<FuelDepot>): UstTankRecord[] {
  const primaryDepot = depots[0];
  const secondaryDepot = depots[1];
  const stationId =
    primaryDepot?.siteCode ||
    (primaryDepot?.id ? `STA-${primaryDepot.id.toUpperCase()}` : 'STA-BAIS-01');
  const stationName = primaryDepot?.name || 'Bais City GSO Central Depot';
  const defaultTs =
    primaryDepot?.lastDipVerifiedAt || primaryDepot?.updatedAt || '2026-11-12T08:15:00Z';

  const dieselCap = primaryDepot?.dieselCapacityLiters ?? 25000;
  const dieselBook = primaryDepot?.dieselCurrentLiters ?? 21850;
  const regularCap = primaryDepot?.gasolineCapacityLiters ?? 15000;
  const regularBook = primaryDepot?.gasolineCurrentLiters ?? 10420;
  const midCap = secondaryDepot?.gasolineCapacityLiters ?? 12000;
  const midBook = secondaryDepot?.gasolineCurrentLiters ?? 7200;
  const premCap = 15000;
  const premBook = 12800;

  return [
    {
      tankId: 'UST-01',
      tankNumber: 'Tank 1',
      stationId,
      stationName,
      depotId: primaryDepot?.id,
      fuelGrade: 'diesel',
      capacityLiters: dieselCap,
      maxDipHeightCm: Math.round((dieselCap / 115) * 10) / 10,
      strappingLitersPerCm: 115,
      bookVolumeLiters: dieselBook,
      lastRecordedVolumeLiters: dieselBook,
      lastRecordedAt: defaultTs,
      deliveryUllageThresholdLiters: 4000,
    },
    {
      tankId: 'UST-02',
      tankNumber: 'Tank 2',
      stationId,
      stationName,
      depotId: primaryDepot?.id,
      fuelGrade: 'regular_91',
      capacityLiters: regularCap,
      maxDipHeightCm: Math.round((regularCap / 80) * 10) / 10,
      strappingLitersPerCm: 80,
      bookVolumeLiters: regularBook,
      lastRecordedVolumeLiters: regularBook,
      lastRecordedAt: defaultTs,
      deliveryUllageThresholdLiters: 3500,
    },
    {
      tankId: 'UST-03',
      tankNumber: 'Tank 3',
      stationId,
      stationName,
      depotId: secondaryDepot?.id ?? primaryDepot?.id,
      fuelGrade: 'mid_grade',
      capacityLiters: midCap,
      maxDipHeightCm: Math.round((midCap / 70) * 10) / 10,
      strappingLitersPerCm: 70,
      bookVolumeLiters: midBook,
      lastRecordedVolumeLiters: midBook,
      lastRecordedAt: secondaryDepot?.lastDipVerifiedAt || defaultTs,
      deliveryUllageThresholdLiters: 3000,
    },
    {
      tankId: 'UST-04',
      tankNumber: 'Tank 4',
      stationId,
      stationName,
      depotId: primaryDepot?.id,
      fuelGrade: 'premium_95',
      capacityLiters: premCap,
      maxDipHeightCm: Math.round((premCap / 80) * 10) / 10,
      strappingLitersPerCm: 80,
      bookVolumeLiters: premBook,
      lastRecordedVolumeLiters: premBook,
      lastRecordedAt: defaultTs,
      deliveryUllageThresholdLiters: 3500,
    },
  ];
}

/**
 * Legacy linear strapping fallback when no Master Registry StorageTank is attached.
 */
export function convertDipHeightCmToLiters(params: {
  dipHeightCm: number;
  strappingLitersPerCm: number;
  capacityLiters: number;
}): number {
  const safeDip = Number.isFinite(params.dipHeightCm) ? Math.max(0, params.dipHeightCm) : 0;
  const safeMult = Number.isFinite(params.strappingLitersPerCm)
    ? Math.max(0, params.strappingLitersPerCm)
    : 0;
  const safeCap = Number.isFinite(params.capacityLiters) ? Math.max(0, params.capacityLiters) : 0;
  const rawLiters = safeDip * safeMult;
  return Math.round(Math.min(safeCap, Math.max(0, rawLiters)) * 10) / 10;
}

export interface UstDipstickEvaluation {
  hasValidDipHeight: boolean;
  exceedsMaxHeight: boolean;
  maxRawDipCm: number;
  riserOffsetCm: number;
  netLiquidHeightCm: number;
  strappingSource: 'custom_csv' | 'geometric_formula' | 'linear_fallback';
  calculatedVolumeLiters: number;
  bookVolumeLiters: number;
  varianceLiters: number;
  variancePct: number;
  reDipRecommended: boolean;
  safeFillCapacityLiters: number;
  ullageLiters: number;
  maxSafeDropLiters: number;
  overfillStatus: 'idle' | 'safe' | 'overfill_risk';
  overfillExcessLiters: number;
  crossDropMismatch: boolean;
  crossDropError: string | null;
  waterAlertTriggered: boolean;
  waterConfirmationSatisfied: boolean;
  canSubmit: boolean;
  blockingReason: string | null;
}

export function evaluateUstDipstickCalculation(params: {
  tank: Pick<
    UstTankRecord,
    'capacityLiters' | 'strappingLitersPerCm' | 'bookVolumeLiters'
  > &
    Partial<
      Pick<
        UstTankRecord,
        | 'tankId'
        | 'storageTankId'
        | 'fuelGrade'
        | 'safeFillCapacityLiters'
        | 'riserOffsetCm'
        | 'maxDipHeightCm'
        | 'maxRawDipCm'
      >
    >;
  storageTanks?: ReadonlyArray<StorageTank>;
  deliveryFuelProduct?: TankFuelProduct;
  mode: DipstickLogMode;
  dipHeightCmInput: string;
  waterHeightCmInput: string;
  bolNumber: string;
  plannedDropLitersInput: string;
  notes: string;
  hasPhoto: boolean;
}): UstDipstickEvaluation {
  const trimmedDip = params.dipHeightCmInput.trim();
  const parsedDip = trimmedDip !== '' ? Number(trimmedDip) : Number.NaN;
  const hasRawDipNumber = Number.isFinite(parsedDip) && parsedDip >= 0 && trimmedDip !== '';

  const masterLookupId = params.tank.storageTankId ?? params.tank.tankId;
  const hasMasterTank = Boolean(
    params.storageTanks &&
      masterLookupId &&
      params.storageTanks.some((t) => t.id === masterLookupId || t.tankCode === masterLookupId)
  );

  let calculatedVolumeLiters = 0;
  let exceedsMaxHeight = false;
  let riserOffsetCm = params.tank.riserOffsetCm ?? 0;
  let maxRawDipCm =
    params.tank.maxRawDipCm ??
    (params.tank.maxDipHeightCm !== undefined
      ? Math.round((params.tank.maxDipHeightCm + riserOffsetCm) * 10) / 10
      : 0);
  let netLiquidHeightCm = hasRawDipNumber ? Math.max(0, parsedDip - riserOffsetCm) : 0;
  let strappingSource: UstDipstickEvaluation['strappingSource'] = 'linear_fallback';
  let safeFillCapacityLiters = params.tank.safeFillCapacityLiters ?? params.tank.capacityLiters;
  let masterUllageLiters: number | null = null;

  if (hasMasterTank && params.storageTanks && masterLookupId) {
    const dipRes = calculateVolumeFromDip(
      masterLookupId,
      hasRawDipNumber ? parsedDip : 0,
      params.storageTanks
    );
    riserOffsetCm = dipRes.riserOffsetCm;
    maxRawDipCm = dipRes.maxRawDipCm;
    safeFillCapacityLiters = dipRes.safeFillCapacityLiters;
    strappingSource = dipRes.usedCustomCurve ? 'custom_csv' : 'geometric_formula';

    if (hasRawDipNumber) {
      exceedsMaxHeight = dipRes.exceedsMaxHeight;
      netLiquidHeightCm = dipRes.netHeightCm;
      calculatedVolumeLiters = exceedsMaxHeight ? 0 : dipRes.volumeLiters;
      masterUllageLiters = dipRes.availableUllageLiters;
    }
  } else if (hasRawDipNumber) {
    calculatedVolumeLiters = convertDipHeightCmToLiters({
      dipHeightCm: parsedDip,
      strappingLitersPerCm: params.tank.strappingLitersPerCm,
      capacityLiters: params.tank.capacityLiters,
    });
  }

  const hasValidDipHeight = hasRawDipNumber && !exceedsMaxHeight;

  const bookVolumeLiters = Math.max(0, Math.round(params.tank.bookVolumeLiters * 10) / 10);
  const varianceLiters = hasValidDipHeight
    ? Math.round((calculatedVolumeLiters - bookVolumeLiters) * 10) / 10
    : 0;
  const variancePct =
    hasValidDipHeight && bookVolumeLiters > 0
      ? Math.round((varianceLiters / bookVolumeLiters) * 10000) / 100
      : hasValidDipHeight && varianceLiters !== 0
        ? 100
        : 0;

  const reDipRecommended =
    hasValidDipHeight && Math.abs(variancePct) > VARIANCE_REDIP_THRESHOLD_PCT;

  const ullageBaseCapacity = hasMasterTank ? safeFillCapacityLiters : params.tank.capacityLiters;
  const ullageLiters =
    hasValidDipHeight && masterUllageLiters !== null
      ? masterUllageLiters
      : hasValidDipHeight
        ? Math.max(0, Math.round((ullageBaseCapacity - calculatedVolumeLiters) * 10) / 10)
        : Math.max(0, Math.round((ullageBaseCapacity - bookVolumeLiters) * 10) / 10);

  // For Master Registry tanks, safeFillCapacityLiters already reserves the tank's Overfill Protection Buffer (%).
  // We still enforce the operational 500 L delivery safety buffer when evaluating tanker offload clearance.
  const maxSafeDropLiters = Math.max(
    0,
    Math.round((ullageLiters - OVERFILL_SAFETY_BUFFER_LITERS) * 10) / 10
  );

  // Cross-Drop Contamination check (Pre-Delivery mode)
  const crossDropMismatch = Boolean(
    params.mode === 'pre_delivery_check' &&
      params.deliveryFuelProduct &&
      params.tank.fuelGrade &&
      params.deliveryFuelProduct !== params.tank.fuelGrade
  );
  const crossDropError = crossDropMismatch
    ? `STOP: CROSS-DROP CONTAMINATION RISK — Delivery product (${UST_FUEL_GRADE_STYLES[params.deliveryFuelProduct!].label}) does not match tank's assigned grade (${UST_FUEL_GRADE_STYLES[params.tank.fuelGrade!].label}).`
    : null;

  const trimmedWater = params.waterHeightCmInput.trim();
  const parsedWater = trimmedWater !== '' ? Number(trimmedWater) : 0;
  const waterHeightCm = Number.isFinite(parsedWater) && parsedWater >= 0 ? parsedWater : 0;
  const waterAlertTriggered = waterHeightCm > WATER_ALERT_THRESHOLD_CM;
  const waterConfirmationSatisfied =
    !waterAlertTriggered || params.notes.trim().length > 0 || params.hasPhoto;

  const trimmedDrop = params.plannedDropLitersInput.trim();
  const parsedDrop = trimmedDrop !== '' ? Number(trimmedDrop) : Number.NaN;
  const hasValidDrop = Number.isFinite(parsedDrop) && parsedDrop > 0;

  let overfillStatus: 'idle' | 'safe' | 'overfill_risk' = 'idle';
  let overfillExcessLiters = 0;

  if (params.mode === 'pre_delivery_check' && hasValidDipHeight && hasValidDrop) {
    if (parsedDrop <= maxSafeDropLiters) {
      overfillStatus = 'safe';
      overfillExcessLiters = 0;
    } else {
      overfillStatus = 'overfill_risk';
      overfillExcessLiters = Math.round((parsedDrop - maxSafeDropLiters) * 10) / 10;
    }
  }

  let blockingReason: string | null = null;
  if (exceedsMaxHeight) {
    blockingReason = `Impossible dip reading: exceeds maximum tank dip height of ${maxRawDipCm} cm (tank depth + ${riserOffsetCm} cm riser offset).`;
  } else if (!hasValidDipHeight) {
    blockingReason = 'Enter Fuel Dip Height (cm) to calculate tank volume and ullage.';
  } else if (crossDropMismatch && crossDropError) {
    blockingReason = crossDropError;
  } else if (params.mode === 'pre_delivery_check' && !params.bolNumber.trim()) {
    blockingReason = 'BOL / Delivery Ticket Number is required for Pre-Delivery Checks.';
  } else if (params.mode === 'pre_delivery_check' && !hasValidDrop) {
    blockingReason = 'Planned Drop Volume (Liters) must be greater than 0.';
  } else if (params.mode === 'pre_delivery_check' && overfillStatus === 'overfill_risk') {
    blockingReason = `STOP: OVERFILL RISK — Exceeds safe capacity by ${overfillExcessLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Liters.`;
  } else if (waterAlertTriggered && !waterConfirmationSatisfied) {
    blockingReason =
      'Water paste level exceeds 0.5 cm. Enter a note or attach a dipstick photo to confirm before submitting.';
  }

  return {
    hasValidDipHeight,
    exceedsMaxHeight,
    maxRawDipCm,
    riserOffsetCm,
    netLiquidHeightCm,
    strappingSource,
    calculatedVolumeLiters,
    bookVolumeLiters,
    varianceLiters,
    variancePct,
    reDipRecommended,
    safeFillCapacityLiters,
    ullageLiters,
    maxSafeDropLiters,
    overfillStatus,
    overfillExcessLiters,
    crossDropMismatch,
    crossDropError,
    waterAlertTriggered,
    waterConfirmationSatisfied,
    canSubmit: blockingReason === null,
    blockingReason,
  };
}

export interface DipstickSubmissionPayload {
  stationId: string;
  tankId: string;
  logType: DipstickLogMode;
  bolNumber: string | null;
  plannedDropLiters: number | null;
  dipHeightCm: number;
  netLiquidHeightCm?: number;
  riserOffsetCm?: number;
  waterHeightCm: number;
  calculatedVolumeLiters: number;
  varianceLiters: number;
  ullageLiters: number;
  operatorId: string;
  timestamp: string;
}

export function buildDipstickSubmissionPayload(params: {
  tank: UstTankRecord;
  mode: DipstickLogMode;
  bolNumber: string;
  plannedDropLiters: number | null;
  dipHeightCm: number;
  waterHeightCm: number;
  evaluation: UstDipstickEvaluation;
  operatorId: string;
  timestamp: string;
}): DipstickSubmissionPayload {
  return {
    stationId: params.tank.stationId,
    tankId: params.tank.tankId,
    logType: params.mode,
    bolNumber:
      params.mode === 'pre_delivery_check' && params.bolNumber.trim()
        ? params.bolNumber.trim().toUpperCase()
        : null,
    plannedDropLiters:
      params.mode === 'pre_delivery_check' &&
      typeof params.plannedDropLiters === 'number' &&
      Number.isFinite(params.plannedDropLiters)
        ? Math.round(params.plannedDropLiters * 10) / 10
        : null,
    dipHeightCm: Math.round(Math.max(0, params.dipHeightCm) * 100) / 100,
    ...(params.evaluation.riserOffsetCm > 0
      ? {
          riserOffsetCm: params.evaluation.riserOffsetCm,
          netLiquidHeightCm: params.evaluation.netLiquidHeightCm,
        }
      : {}),
    waterHeightCm: Math.round(Math.max(0, params.waterHeightCm) * 100) / 100,
    calculatedVolumeLiters: params.evaluation.calculatedVolumeLiters,
    varianceLiters: params.evaluation.varianceLiters,
    ullageLiters: params.evaluation.ullageLiters,
    operatorId: params.operatorId,
    timestamp: params.timestamp,
  };
}

export interface PreDeliveryPostingFormInput {
  volumeLitersInput: string;
  totalAmountPhpInput: string;
  deliveryReceiptRef: string;
  purchaseOrderRef: string;
  supplierName: string;
  deliveryDate: string;
  gsoVerificationCode?: string;
  remarks?: string;
  maxSafeDropLiters?: number;
}

export interface PreDeliveryPostingSanitized {
  deliveredVolumeLiters: number;
  totalAmountPhp: number;
  unitCostPhp: number;
  deliveryReceiptRef: string;
  purchaseOrderRef: string;
  supplierName: string;
  deliveryDate: string;
  gsoVerificationCode?: string;
  remarks: string;
}

export interface PreDeliveryPostingEvaluation {
  valid: boolean;
  missingFields: string[];
  overfillExceeded: boolean;
  unitCostPhp: number | null;
  blockingReason: string | null;
  sanitized: PreDeliveryPostingSanitized | null;
}

/**
 * Pure validator & unit-cost engine for the Post-Pre-Delivery floating delivery
 * recording modal. Enforces mandatory Volume, Total Amount, Delivery Receipt #,
 * Purchase Order #, Supplier, and Delivery Date, and auto-derives Unit Cost (₱/L)
 * for Weighted Average Cost (WAC) posting.
 */
export function evaluatePreDeliveryPostingForm(
  input: PreDeliveryPostingFormInput
): PreDeliveryPostingEvaluation {
  const missingFields: string[] = [];

  const parsedVolume = Number(input.volumeLitersInput.trim());
  const hasValidVolume =
    input.volumeLitersInput.trim() !== '' && Number.isFinite(parsedVolume) && parsedVolume > 0;
  if (!hasValidVolume) {
    missingFields.push('Delivered Volume (L)');
  }

  const parsedAmount = Number(input.totalAmountPhpInput.trim());
  const hasValidAmount =
    input.totalAmountPhpInput.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  if (!hasValidAmount) {
    missingFields.push('Total Amount (₱)');
  }

  const drRef = input.deliveryReceiptRef.trim().toUpperCase().slice(0, 64);
  if (drRef.length < 2) {
    missingFields.push('Delivery Receipt Ref #');
  }

  const poRef = input.purchaseOrderRef.trim().toUpperCase().slice(0, 64);
  if (poRef.length < 2) {
    missingFields.push('Purchase Order Ref #');
  }

  const supplier = input.supplierName.trim().slice(0, 120);
  if (supplier.length < 2) {
    missingFields.push('Supplier / Hauler');
  }

  const deliveryDate = input.deliveryDate.trim().slice(0, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    missingFields.push('Delivery Date');
  }

  const overfillExceeded = Boolean(
    hasValidVolume &&
      typeof input.maxSafeDropLiters === 'number' &&
      Number.isFinite(input.maxSafeDropLiters) &&
      input.maxSafeDropLiters > 0 &&
      parsedVolume > input.maxSafeDropLiters
  );

  const unitCostPhp =
    hasValidVolume && hasValidAmount
      ? Math.round((parsedAmount / parsedVolume) * 10000) / 10000
      : null;

  let blockingReason: string | null = null;
  if (overfillExceeded) {
    blockingReason = `Delivered volume (${parsedVolume.toLocaleString('en-US', { maximumFractionDigits: 1 })} L) exceeds verified Max Safe Drop (${input.maxSafeDropLiters!.toLocaleString('en-US', { maximumFractionDigits: 1 })} L).`;
  } else if (missingFields.length > 0) {
    blockingReason = `Complete required fields: ${missingFields.join(', ')}.`;
  }

  if (blockingReason !== null || unitCostPhp === null) {
    return {
      valid: false,
      missingFields,
      overfillExceeded,
      unitCostPhp,
      blockingReason,
      sanitized: null,
    };
  }

  const cleanCode = (input.gsoVerificationCode ?? '').trim().slice(0, 64);
  const cleanRemarks = (input.remarks ?? '').trim().slice(0, 240);

  return {
    valid: true,
    missingFields: [],
    overfillExceeded: false,
    unitCostPhp,
    blockingReason: null,
    sanitized: {
      deliveredVolumeLiters: Math.round(parsedVolume * 10) / 10,
      totalAmountPhp: Math.round(parsedAmount * 100) / 100,
      unitCostPhp,
      deliveryReceiptRef: drRef,
      purchaseOrderRef: poRef,
      supplierName: supplier,
      deliveryDate,
      gsoVerificationCode: cleanCode.length > 0 ? cleanCode : undefined,
      remarks: cleanRemarks,
    },
  };
}

/**
 * Finds the matching delivery entry in the Depot Ledger Register (`inventoryLogs`)
 * for a Pre-Delivery Dipstick submission so the UI can verify recording status
 * and offer one-click recovery if an older reading was never posted to the ledger.
 */
export function findMatchingLedgerDeliveryForDipstick(params: {
  inventoryLogs: ReadonlyArray<InventoryLog>;
  inventoryLogId?: string;
  deliveryReceiptRef?: string;
  bolNumber?: string | null;
  depotId?: string;
}): InventoryLog | null {
  const deliveries = params.inventoryLogs.filter((l) => l.transactionType === 'delivery');
  if (deliveries.length === 0) return null;

  if (params.inventoryLogId) {
    const byId = deliveries.find((l) => l.id === params.inventoryLogId);
    if (byId) return byId;
  }

  const cleanDr = (params.deliveryReceiptRef ?? '').trim().toUpperCase();
  if (cleanDr) {
    const byDr = deliveries.find(
      (l) =>
        l.referenceNumber.trim().toUpperCase() === cleanDr &&
        (!params.depotId || l.depotId === params.depotId)
    );
    if (byDr) return byDr;
  }

  const cleanBol = (params.bolNumber ?? '').trim().toUpperCase();
  if (cleanBol) {
    const byBol = deliveries.find(
      (l) =>
        (!params.depotId || l.depotId === params.depotId) &&
        (l.referenceNumber.trim().toUpperCase() === cleanBol ||
          (l.notes ?? '').toUpperCase().includes(`BOL: ${cleanBol}`))
    );
    if (byBol) return byBol;
  }

  return null;
}

