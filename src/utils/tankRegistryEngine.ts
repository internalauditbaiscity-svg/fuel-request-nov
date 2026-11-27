import {
  CalibrationHealthStatus,
  DispenserMapping,
  FuelType,
  InventoryLog,
  StorageTank,
  StrappingCurve,
  StrappingPoint,
  TankFuelProduct,
  TankGeometryType,
  TankMaterialType,
} from '../types/fuel';

export interface TankFuelProductStyle {
  product: TankFuelProduct;
  label: string;
  shortLabel: string;
  hex: string;
  topBarClass: string;
  badgeBgClass: string;
  badgeTextClass: string;
  mappedDepotFuelType: FuelType;
}

export const TANK_FUEL_PRODUCT_STYLES: Record<TankFuelProduct, TankFuelProductStyle> = {
  diesel: {
    product: 'diesel',
    label: 'Diesel',
    shortLabel: 'DSL',
    hex: '#F59E0B',
    topBarClass: 'bg-[#F59E0B]',
    badgeBgClass: 'bg-[#FEF3C7] border-[#F59E0B]',
    badgeTextClass: 'text-[#92400E]',
    mappedDepotFuelType: 'diesel',
  },
  regular_91: {
    product: 'regular_91',
    label: 'Regular Unleaded (91)',
    shortLabel: 'UNL 91',
    hex: '#EF4444',
    topBarClass: 'bg-[#EF4444]',
    badgeBgClass: 'bg-[#FEE2E2] border-[#EF4444]',
    badgeTextClass: 'text-[#991B1B]',
    mappedDepotFuelType: 'gasoline',
  },
  mid_grade: {
    product: 'mid_grade',
    label: 'Mid-Grade',
    shortLabel: 'MID',
    hex: '#3B82F6',
    topBarClass: 'bg-[#3B82F6]',
    badgeBgClass: 'bg-[#DBEAFE] border-[#3B82F6]',
    badgeTextClass: 'text-[#1E40AF]',
    mappedDepotFuelType: 'gasoline',
  },
  premium_95: {
    product: 'premium_95',
    label: 'Premium Unleaded (95)',
    shortLabel: 'PREM 95',
    hex: '#10B981',
    topBarClass: 'bg-[#10B981]',
    badgeBgClass: 'bg-[#D1FAE5] border-[#10B981]',
    badgeTextClass: 'text-[#065F46]',
    mappedDepotFuelType: 'gasoline',
  },
  kerosene: {
    product: 'kerosene',
    label: 'Kerosene',
    shortLabel: 'KERO',
    hex: '#8B5CF6',
    topBarClass: 'bg-[#8B5CF6]',
    badgeBgClass: 'bg-[#EDE9FE] border-[#8B5CF6]',
    badgeTextClass: 'text-[#5B21B6]',
    mappedDepotFuelType: 'diesel',
  },
  bio_diesel: {
    product: 'bio_diesel',
    label: 'Bio-Diesel',
    shortLabel: 'BIO-D',
    hex: '#D97706',
    topBarClass: 'bg-[#D97706]',
    badgeBgClass: 'bg-[#FEF3C7] border-[#D97706]',
    badgeTextClass: 'text-[#78350F]',
    mappedDepotFuelType: 'diesel',
  },
};

export const TANK_GEOMETRY_LABELS: Record<TankGeometryType, string> = {
  horizontal_cylinder_flat: 'Horizontal Cylinder (Flat Ends)',
  horizontal_cylinder_dished: 'Horizontal Cylinder (Dished / Hemispherical Ends)',
  vertical_cylinder: 'Vertical Cylinder',
  rectangular_box: 'Rectangular / Box Tank',
};

export const TANK_MATERIAL_LABELS: Record<TankMaterialType, string> = {
  double_wall_fiberglass: 'Double-Wall Fiberglass',
  double_wall_steel: 'Double-Wall Steel',
  single_wall_steel: 'Single-Wall Steel',
};

export interface TankGeometryParams {
  geometry: TankGeometryType;
  diameterCm: number;
  lengthCm: number;
  widthCm?: number;
  heightCm?: number;
  riserOffsetCm?: number;
  tiltAngleDegrees?: number;
  overfillBufferPct?: number;
  deadstockClearanceCm?: number;
  customStrappingPoints?: StrappingPoint[];
}

export interface TankComputedSpecifications {
  maxLiquidHeightCm: number;
  maxRawDipCm: number;
  grossCapacityLiters: number;
  safeFillCapacityLiters: number;
  deadstockVolumeLiters: number;
  netWorkingVolumeLiters: number;
  overfillBufferLiters: number;
  averageLitersPerCm: number;
}

export interface DipVolumeCalculationResult {
  found: boolean;
  tankId: string;
  rawDipCm: number;
  riserOffsetCm: number;
  netHeightCm: number;
  maxLiquidHeightCm: number;
  maxRawDipCm: number;
  exceedsMaxHeight: boolean;
  volumeLiters: number;
  grossCapacityLiters: number;
  safeFillCapacityLiters: number;
  deadstockVolumeLiters: number;
  availableUllageLiters: number;
  usedCustomCurve: boolean;
}

export interface StrappingTableRow {
  heightCm: number;
  rawDipWithRiserCm: number;
  volumeLiters: number;
  percentFull: number;
  isDeadstock: boolean;
  isOverfillZone: boolean;
  zone: 'deadstock' | 'usable' | 'overfill_buffer';
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Maximum internal liquid height (cm) for the selected tank geometry:
 * - Horizontal cylinder (flat or dished): diameterCm
 * - Vertical cylinder: lengthCm (tank height)
 * - Rectangular / box tank: heightCm (fallback to diameterCm)
 */
export function getTankMaxLiquidHeightCm(
  params: Pick<TankGeometryParams, 'geometry' | 'diameterCm' | 'lengthCm' | 'heightCm'>
): number {
  const safeD = Number.isFinite(params.diameterCm) ? Math.max(0, params.diameterCm) : 0;
  const safeL = Number.isFinite(params.lengthCm) ? Math.max(0, params.lengthCm) : 0;
  const safeH =
    params.heightCm !== undefined && Number.isFinite(params.heightCm)
      ? Math.max(0, params.heightCm)
      : safeD;
  if (params.geometry === 'vertical_cylinder') {
    return round2(safeL);
  }
  if (params.geometry === 'rectangular_box') {
    return round2(safeH);
  }
  return round2(safeD);
}

/**
 * Circular segment area in cm² for a circle of radius R filled to depth h (cm).
 */
function circularSegmentAreaCm2(radiusCm: number, heightCm: number): number {
  if (radiusCm <= 0 || heightCm <= 0) return 0;
  if (heightCm >= 2 * radiusCm) return Math.PI * radiusCm * radiusCm;
  const ratio = Math.max(-1, Math.min(1, (radiusCm - heightCm) / radiusCm));
  const term1 = radiusCm * radiusCm * Math.acos(ratio);
  const term2 = (radiusCm - heightCm) * Math.sqrt(Math.max(0, 2 * radiusCm * heightCm - heightCm * heightCm));
  return Math.max(0, term1 - term2);
}

/**
 * Adjusts effective liquid height for minor tank tilt/inclination angle (degrees).
 * For centered dipstick measurement, small inclination slightly reduces end-to-end
 * fill near top/bottom; compensated deterministically and clamped within [0, maxH].
 */
function applyTiltCompensationCm(
  netHeightCm: number,
  maxHeightCm: number,
  lengthCm: number,
  tiltAngleDeg: number
): number {
  if (!Number.isFinite(tiltAngleDeg) || Math.abs(tiltAngleDeg) < 0.01 || maxHeightCm <= 0) {
    return Math.max(0, Math.min(maxHeightCm, netHeightCm));
  }
  const clampedAngle = Math.max(-10, Math.min(10, tiltAngleDeg));
  const rad = (clampedAngle * Math.PI) / 180;
  // Small-angle end-gauge correction factor: +0.25 * L * sin(theta) at fill midpoint taper
  const fillRatio = Math.max(0, Math.min(1, netHeightCm / maxHeightCm));
  const taper = 4 * fillRatio * (1 - fillRatio); // 0 at empty/full, 1 at half-full
  const deltaH = 0.08 * Math.max(0, lengthCm) * Math.sin(rad) * taper;
  return Math.max(0, Math.min(maxHeightCm, netHeightCm + deltaH));
}

/**
 * Pure mathematical formula volume (in Liters) at a given net internal liquid height (cm).
 */
export function computeGeometricVolumeAtHeightLiters(
  params: TankGeometryParams,
  netHeightCm: number
): number {
  const maxH = getTankMaxLiquidHeightCm(params);
  if (maxH <= 0 || !Number.isFinite(netHeightCm) || netHeightCm <= 0) return 0;

  const hRaw = Math.max(0, Math.min(maxH, netHeightCm));
  const safeD = Math.max(0, params.diameterCm || 0);
  const safeL = Math.max(0, params.lengthCm || 0);
  const safeW = Math.max(0, params.widthCm || safeD);
  const h = applyTiltCompensationCm(hRaw, maxH, safeL, params.tiltAngleDegrees ?? 0);

  if (params.geometry === 'horizontal_cylinder_flat') {
    const r = safeD / 2;
    const area = circularSegmentAreaCm2(r, h);
    return round1((area * safeL) / 1000);
  }

  if (params.geometry === 'horizontal_cylinder_dished') {
    const r = safeD / 2;
    if (r <= 0) return 0;
    // Two hemispherical end caps of radius r combine to one sphere of radius r;
    // remaining straight barrel length = max(0, L - 2r).
    const barrelLen = Math.max(0, safeL - 2 * r);
    const barrelCm3 = circularSegmentAreaCm2(r, h) * barrelLen;
    // Spherical cap volume of combined hemispheres filled to height h in [0, 2r]:
    // V_sphere(h) = (pi * h^2 * (3r - h)) / 3
    const sphereCm3 = (Math.PI * h * h * Math.max(0, 3 * r - h)) / 3;
    return round1((barrelCm3 + sphereCm3) / 1000);
  }

  if (params.geometry === 'vertical_cylinder') {
    const r = safeD / 2;
    const volCm3 = Math.PI * r * r * h;
    return round1(volCm3 / 1000);
  }

  // rectangular_box: widthCm * lengthCm * height
  const volCm3 = safeW * safeL * h;
  return round1(volCm3 / 1000);
}

/**
 * Piecewise linear interpolation across a sorted custom strapping point curve.
 */
export function interpolateStrappingCurveLiters(
  points: ReadonlyArray<StrappingPoint>,
  netHeightCm: number
): number {
  if (!points || points.length === 0 || !Number.isFinite(netHeightCm) || netHeightCm <= 0) {
    return 0;
  }
  const sorted = [...points].sort((a, b) => a.heightCm - b.heightCm);
  if (netHeightCm <= sorted[0].heightCm) {
    if (sorted[0].heightCm <= 0) return round1(sorted[0].volumeLiters);
    return round1((netHeightCm / sorted[0].heightCm) * sorted[0].volumeLiters);
  }
  const last = sorted[sorted.length - 1];
  if (netHeightCm >= last.heightCm) {
    return round1(last.volumeLiters);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    if (netHeightCm >= p1.heightCm && netHeightCm <= p2.heightCm) {
      const span = p2.heightCm - p1.heightCm;
      if (span <= 0) return round1(p2.volumeLiters);
      const t = (netHeightCm - p1.heightCm) / span;
      return round1(p1.volumeLiters + t * (p2.volumeLiters - p1.volumeLiters));
    }
  }
  return round1(last.volumeLiters);
}

/**
 * Computes exact volume (L) at a net liquid height (cm), respecting custom CSV strapping
 * override when active, otherwise using the mathematical geometry formula.
 */
export function computeTankVolumeAtNetHeight(
  params: TankGeometryParams,
  netHeightCm: number
): { volumeLiters: number; usedCustomCurve: boolean } {
  if (params.customStrappingPoints && params.customStrappingPoints.length >= 2) {
    return {
      volumeLiters: interpolateStrappingCurveLiters(params.customStrappingPoints, netHeightCm),
      usedCustomCurve: true,
    };
  }
  return {
    volumeLiters: computeGeometricVolumeAtHeightLiters(params, netHeightCm),
    usedCustomCurve: false,
  };
}

/**
 * Computes Gross Geometric Capacity, Max Safe Fill Capacity, Deadstock Volume,
 * and Net Working Volume live from tank specifications.
 */
export function computeTankSpecifications(params: TankGeometryParams): TankComputedSpecifications {
  const maxLiquidHeightCm = getTankMaxLiquidHeightCm(params);
  const riserOffsetCm = Math.max(0, Number(params.riserOffsetCm) || 0);
  const maxRawDipCm = round2(maxLiquidHeightCm + riserOffsetCm);

  const grossCapacityLiters = computeTankVolumeAtNetHeight(params, maxLiquidHeightCm).volumeLiters;

  const overfillPct = Math.max(0, Math.min(30, Number(params.overfillBufferPct ?? 5) || 0));
  const safeFillCapacityLiters = round1(grossCapacityLiters * (1 - overfillPct / 100));
  const overfillBufferLiters = round1(Math.max(0, grossCapacityLiters - safeFillCapacityLiters));

  const deadstockCm = Math.max(0, Math.min(maxLiquidHeightCm, Number(params.deadstockClearanceCm) || 0));
  const deadstockVolumeLiters =
    deadstockCm > 0 ? computeTankVolumeAtNetHeight(params, deadstockCm).volumeLiters : 0;

  const netWorkingVolumeLiters = round1(Math.max(0, safeFillCapacityLiters - deadstockVolumeLiters));
  const averageLitersPerCm =
    maxLiquidHeightCm > 0 ? round2(grossCapacityLiters / maxLiquidHeightCm) : 0;

  return {
    maxLiquidHeightCm,
    maxRawDipCm,
    grossCapacityLiters,
    safeFillCapacityLiters,
    deadstockVolumeLiters,
    netWorkingVolumeLiters,
    overfillBufferLiters,
    averageLitersPerCm,
  };
}

/**
 * Single Source of Truth helper directly consumed by Dipstick Logging and Pre-Delivery modules.
 * Looks up the registered tank by id (or tankCode), subtracts riser pipe offset, validates
 * against the tank's maximum physical height, and returns exact volume + safe-fill ullage.
 */
export function calculateVolumeFromDip(
  tankId: string,
  dipCm: number,
  tanks: ReadonlyArray<StorageTank>
): DipVolumeCalculationResult {
  const tank = tanks.find((t) => t.id === tankId || t.tankCode === tankId);
  if (!tank) {
    return {
      found: false,
      tankId,
      rawDipCm: dipCm,
      riserOffsetCm: 0,
      netHeightCm: 0,
      maxLiquidHeightCm: 0,
      maxRawDipCm: 0,
      exceedsMaxHeight: false,
      volumeLiters: 0,
      grossCapacityLiters: 0,
      safeFillCapacityLiters: 0,
      deadstockVolumeLiters: 0,
      availableUllageLiters: 0,
      usedCustomCurve: false,
    };
  }

  const specs = computeTankSpecifications(tank);
  const safeRawDip = Number.isFinite(dipCm) ? Math.max(0, dipCm) : 0;
  const riserOffsetCm = Math.max(0, tank.riserOffsetCm || 0);
  const netHeightCm = round2(Math.max(0, safeRawDip - riserOffsetCm));
  const exceedsMaxHeight = safeRawDip > specs.maxRawDipCm + 0.01;

  const clampedNet = Math.min(specs.maxLiquidHeightCm, netHeightCm);
  const { volumeLiters, usedCustomCurve } = computeTankVolumeAtNetHeight(tank, clampedNet);

  // Available Ullage = Max Safe Fill Capacity - Current Volume (clamped >= 0)
  const availableUllageLiters = round1(Math.max(0, specs.safeFillCapacityLiters - volumeLiters));

  return {
    found: true,
    tankId: tank.id,
    rawDipCm: round2(safeRawDip),
    riserOffsetCm: round2(riserOffsetCm),
    netHeightCm,
    maxLiquidHeightCm: specs.maxLiquidHeightCm,
    maxRawDipCm: specs.maxRawDipCm,
    exceedsMaxHeight,
    volumeLiters,
    grossCapacityLiters: specs.grossCapacityLiters,
    safeFillCapacityLiters: specs.safeFillCapacityLiters,
    deadstockVolumeLiters: specs.deadstockVolumeLiters,
    availableUllageLiters,
    usedCustomCurve,
  };
}

/**
 * Generates a 5 cm increment strapping chart table from 0 cm up to max internal height.
 */
export function generateStrappingTable(
  params: TankGeometryParams,
  stepCm = 5
): StrappingTableRow[] {
  const specs = computeTankSpecifications(params);
  const maxH = specs.maxLiquidHeightCm;
  if (maxH <= 0) return [];
  const step = Math.max(1, stepCm);
  const riser = Math.max(0, params.riserOffsetCm || 0);
  const deadstockCm = Math.max(0, params.deadstockClearanceCm || 0);

  const heights: number[] = [];
  for (let h = 0; h < maxH; h += step) {
    heights.push(round2(h));
  }
  if (heights.length === 0 || Math.abs(heights[heights.length - 1] - maxH) > 0.01) {
    heights.push(round2(maxH));
  }

  return heights.map((h) => {
    const { volumeLiters } = computeTankVolumeAtNetHeight(params, h);
    const percentFull =
      specs.grossCapacityLiters > 0
        ? round1((volumeLiters / specs.grossCapacityLiters) * 100)
        : 0;
    const isDeadstock = h <= deadstockCm && deadstockCm > 0;
    const isOverfillZone = !isDeadstock && volumeLiters > specs.safeFillCapacityLiters;
    const zone: StrappingTableRow['zone'] = isDeadstock
      ? 'deadstock'
      : isOverfillZone
        ? 'overfill_buffer'
        : 'usable';
    return {
      heightCm: h,
      rawDipWithRiserCm: round2(h + riser),
      volumeLiters,
      percentFull,
      isDeadstock,
      isOverfillZone,
      zone,
    };
  });
}

/**
 * Parses a third-party certified strapping CSV ("height_cm,volume_liters" per row).
 */
export function parseCustomStrappingCsv(csvText: string): {
  ok: boolean;
  points: StrappingPoint[];
  error?: string;
} {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const points: StrappingPoint[] = [];
  for (const line of lines) {
    const parts = line.split(/[,\t;]+/).map((p) => p.trim());
    if (parts.length < 2) continue;
    const h = Number(parts[0]);
    const v = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(v)) {
      // Skip header rows like "height_cm,volume_liters"
      continue;
    }
    if (h < 0 || v < 0) {
      return { ok: false, points: [], error: 'Strapping CSV cannot contain negative heights or volumes.' };
    }
    points.push({ heightCm: round2(h), volumeLiters: round1(v) });
  }

  if (points.length < 2) {
    return {
      ok: false,
      points: [],
      error: 'Custom strapping CSV must include at least 2 valid numeric "height_cm,volume_liters" rows.',
    };
  }

  points.sort((a, b) => a.heightCm - b.heightCm);
  // Deduplicate identical heights keeping latest
  const deduped: StrappingPoint[] = [];
  for (const pt of points) {
    if (deduped.length > 0 && Math.abs(deduped[deduped.length - 1].heightCm - pt.heightCm) < 0.001) {
      deduped[deduped.length - 1] = pt;
    } else {
      deduped.push(pt);
    }
  }

  // Ensure monotonic non-decreasing volume
  for (let i = 1; i < deduped.length; i++) {
    if (deduped[i].volumeLiters < deduped[i - 1].volumeLiters) {
      return {
        ok: false,
        points: [],
        error: `Strapping volume must not decrease as height increases (check row at ${deduped[i].heightCm} cm).`,
      };
    }
  }

  // Cap at 120 points to keep Firestore document payload compact
  const bounded = deduped.slice(0, 120);
  return { ok: true, points: bounded };
}

/**
 * Evaluates regulatory calibration certificate expiry status.
 */
export function getCalibrationHealthStatus(
  expiryDateIso?: string,
  nowIso = new Date().toISOString()
): {
  status: CalibrationHealthStatus;
  daysRemaining: number;
  label: string;
  badgeClass: string;
} {
  if (!expiryDateIso) {
    return {
      status: 'calibration_due',
      daysRemaining: 0,
      label: 'Calibration Due',
      badgeClass: 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]',
    };
  }
  const expMs = new Date(`${expiryDateIso.slice(0, 10)}T23:59:59Z`).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(expMs) || !Number.isFinite(nowMs)) {
    return {
      status: 'calibration_due',
      daysRemaining: 0,
      label: 'Calibration Due',
      badgeClass: 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]',
    };
  }
  const daysRemaining = Math.ceil((expMs - nowMs) / (1000 * 60 * 60 * 24));
  if (daysRemaining <= 0) {
    return {
      status: 'calibration_due',
      daysRemaining,
      label: 'Calibration Due',
      badgeClass: 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]',
    };
  }
  if (daysRemaining <= 30) {
    return {
      status: 'expiring_soon',
      daysRemaining,
      label: 'Expiring Soon',
      badgeClass: 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]',
    };
  }
  return {
    status: 'active',
    daysRemaining,
    label: 'Active',
    badgeClass: 'border-[#059669] bg-[#ECFDF5] text-[#065F46]',
  };
}

/**
 * Validates a planned fuel delivery drop against the target tank's safe-fill ullage
 * AND checks for Cross-Drop Contamination (fuel grade mismatch).
 */
export function validateDeliveryAgainstTank(params: {
  tank: StorageTank;
  deliveryFuelProduct: TankFuelProduct;
  plannedDropLiters: number;
  currentVolumeLiters: number;
}): {
  ok: boolean;
  crossDropContamination: boolean;
  overfillRisk: boolean;
  availableUllageLiters: number;
  excessLiters: number;
  errorMessage: string | null;
} {
  const specs = computeTankSpecifications(params.tank);
  const availableUllageLiters = round1(
    Math.max(0, specs.safeFillCapacityLiters - Math.max(0, params.currentVolumeLiters))
  );
  const crossDropContamination = params.deliveryFuelProduct !== params.tank.fuelProduct;
  const overfillRisk = params.plannedDropLiters > availableUllageLiters;
  const excessLiters = overfillRisk ? round1(params.plannedDropLiters - availableUllageLiters) : 0;

  let errorMessage: string | null = null;
  if (crossDropContamination) {
    const expectedLabel = TANK_FUEL_PRODUCT_STYLES[params.tank.fuelProduct].label;
    const incomingLabel = TANK_FUEL_PRODUCT_STYLES[params.deliveryFuelProduct].label;
    errorMessage = `CROSS-DROP CONTAMINATION BLOCKED: Tank ${params.tank.tankCode} is assigned to ${expectedLabel}, not ${incomingLabel}.`;
  } else if (overfillRisk) {
    errorMessage = `OVERFILL RISK: Planned drop exceeds safe-fill ullage (${availableUllageLiters.toLocaleString()} L) by ${excessLiters.toLocaleString()} L.`;
  }

  return {
    ok: !crossDropContamination && !overfillRisk,
    crossDropContamination,
    overfillRisk,
    availableUllageLiters,
    excessLiters,
    errorMessage,
  };
}

/**
 * Computes Theoretical Book Stock = Opening Dip + Verified Deliveries - Dispensed Volume
 * for a given tank using inventory logs linked by tankId (or fallback depot+fuelType).
 */
export function computeTankTheoreticalBookStock(
  tank: StorageTank,
  inventoryLogs: ReadonlyArray<InventoryLog>,
  allDepotTanks?: ReadonlyArray<StorageTank>
): {
  openingDipLiters: number;
  deliveriesLiters: number;
  dispensedLiters: number;
  adjustmentsLiters: number;
  theoreticalBookLiters: number;
} {
  const openingDipLiters = round1(Math.max(0, tank.openingDipLiters || 0));
  const sameFuelTanksAtDepot = (allDepotTanks ?? [tank]).filter(
    (t) => t.depotId === tank.depotId && t.mappedFuelType === tank.mappedFuelType
  );
  const isPrimaryForGrade =
    sameFuelTanksAtDepot.length <= 1 || sameFuelTanksAtDepot[0]?.id === tank.id;

  let deliveriesLiters = 0;
  let dispensedLiters = 0;
  let adjustmentsLiters = 0;

  for (const log of inventoryLogs) {
    if (log.approvalStatus === 'rejected') continue;
    const explicitMatch = log.tankId === tank.id;
    const fallbackMatch =
      !log.tankId &&
      isPrimaryForGrade &&
      log.depotId === tank.depotId &&
      log.fuelType === tank.mappedFuelType;

    if (!explicitMatch && !fallbackMatch) continue;

    if (log.transactionType === 'delivery' && log.approvalStatus === 'verified') {
      deliveriesLiters += Math.abs(log.litersDelta);
    } else if (log.transactionType === 'dispense') {
      dispensedLiters += Math.abs(log.litersDelta);
    } else if (
      (log.transactionType === 'overage_adjustment' ||
        log.transactionType === 'shrinkage_adjustment') &&
      log.approvalStatus === 'verified'
    ) {
      adjustmentsLiters += log.litersDelta;
    }
  }

  const theoreticalBookLiters = round1(
    Math.max(
      0,
      Math.min(
        tank.grossCapacityLiters,
        openingDipLiters + deliveriesLiters - dispensedLiters + adjustmentsLiters
      )
    )
  );

  return {
    openingDipLiters,
    deliveriesLiters: round1(deliveriesLiters),
    dispensedLiters: round1(dispensedLiters),
    adjustmentsLiters: round1(adjustmentsLiters),
    theoreticalBookLiters,
  };
}

/**
 * Derives flat DispenserMapping records linking pump nozzles to their source storage tank.
 */
export function buildDispenserMappings(tanks: ReadonlyArray<StorageTank>): DispenserMapping[] {
  const mappings: DispenserMapping[] = [];
  for (const tank of tanks) {
    for (const pump of tank.connectedDispensers) {
      const clean = pump.trim();
      if (!clean) continue;
      mappings.push({
        pumpId: clean,
        nozzleLabel: `${clean} (${TANK_FUEL_PRODUCT_STYLES[tank.fuelProduct].shortLabel})`,
        tankId: tank.id,
        depotId: tank.depotId,
        fuelProduct: tank.fuelProduct,
      });
    }
  }
  return mappings;
}

/**
 * Builds a structured StrappingCurve object ready for JSON export or DB persistence.
 */
export function buildStrappingCurveForTank(tank: StorageTank, stepCm = 5): StrappingCurve {
  if (tank.customStrappingPoints && tank.customStrappingPoints.length >= 2) {
    return {
      mode: 'custom_csv',
      sourceName: tank.calibrationCertificateNo || 'Certified Custom Chart',
      points: tank.customStrappingPoints,
    };
  }
  const rows = generateStrappingTable(tank, stepCm);
  return {
    mode: 'formula',
    sourceName: TANK_GEOMETRY_LABELS[tank.geometry],
    points: rows.map((r) => ({ heightCm: r.heightCm, volumeLiters: r.volumeLiters })),
  };
}

/**
 * Normalizes a StorageTank payload, recalculating derived capacities deterministically
 * from dimensions & safety buffers so persisted values always stay synchronized.
 */
export function normalizeStorageTankRecord(
  input: Omit<
    StorageTank,
    | 'mappedFuelType'
    | 'grossCapacityLiters'
    | 'safeFillCapacityLiters'
    | 'deadstockVolumeLiters'
    | 'netWorkingVolumeLiters'
  > &
    Partial<
      Pick<
        StorageTank,
        | 'mappedFuelType'
        | 'grossCapacityLiters'
        | 'safeFillCapacityLiters'
        | 'deadstockVolumeLiters'
        | 'netWorkingVolumeLiters'
      >
    >
): StorageTank {
  const specs = computeTankSpecifications(input);
  const mappedFuelType = TANK_FUEL_PRODUCT_STYLES[input.fuelProduct].mappedDepotFuelType;
  const cleanPumps = Array.from(
    new Set(
      (input.connectedDispensers || [])
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, 32)
    )
  );
  const openingDipLiters = round1(
    Math.max(0, Math.min(specs.grossCapacityLiters, Number(input.openingDipLiters) || 0))
  );
  const currentBookVolumeLiters = round1(
    Math.max(0, Math.min(specs.grossCapacityLiters, Number(input.currentBookVolumeLiters) || 0))
  );

  return {
    ...input,
    tankCode: input.tankCode.trim().toUpperCase(),
    name: input.name.trim(),
    locationZone: input.locationZone.trim(),
    manholeTag: input.manholeTag?.trim() || undefined,
    mappedFuelType,
    connectedDispensers: cleanPumps,
    diameterCm: round2(Math.max(10, Number(input.diameterCm) || 100)),
    lengthCm: round2(Math.max(10, Number(input.lengthCm) || 100)),
    widthCm:
      input.geometry === 'rectangular_box'
        ? round2(Math.max(10, Number(input.widthCm) || Number(input.diameterCm) || 100))
        : undefined,
    heightCm:
      input.geometry === 'rectangular_box'
        ? round2(Math.max(10, Number(input.heightCm) || Number(input.diameterCm) || 100))
        : undefined,
    riserOffsetCm: round2(Math.max(0, Number(input.riserOffsetCm) || 0)),
    tiltAngleDegrees: round2(Math.max(-15, Math.min(15, Number(input.tiltAngleDegrees) || 0))),
    overfillBufferPct: round2(Math.max(0, Math.min(30, Number(input.overfillBufferPct ?? 5)))),
    deadstockClearanceCm: round2(
      Math.max(0, Math.min(specs.maxLiquidHeightCm, Number(input.deadstockClearanceCm) || 0))
    ),
    lowStockAlertLiters: round1(Math.max(0, Number(input.lowStockAlertLiters) || 0)),
    grossCapacityLiters: specs.grossCapacityLiters,
    safeFillCapacityLiters: specs.safeFillCapacityLiters,
    deadstockVolumeLiters: specs.deadstockVolumeLiters,
    netWorkingVolumeLiters: specs.netWorkingVolumeLiters,
    openingDipLiters,
    currentBookVolumeLiters,
    customStrappingPoints:
      input.customStrappingPoints && input.customStrappingPoints.length >= 2
        ? input.customStrappingPoints.slice(0, 400)
        : undefined,
  };
}

/**
 * Recomputes aggregate Diesel and Gasoline tank capacities for a depot from its
 * registered StorageTanks so the existing Depot Ledger & Delivery views stay in sync.
 */
export function computeAggregateDepotCapacitiesFromTanks(
  depotId: string,
  tanks: ReadonlyArray<StorageTank>
): { dieselCapacityLiters: number; gasolineCapacityLiters: number } {
  const depotTanks = tanks.filter((t) => t.depotId === depotId);
  const dieselCapacityLiters = round1(
    depotTanks
      .filter((t) => t.mappedFuelType === 'diesel')
      .reduce((acc, t) => acc + t.grossCapacityLiters, 0)
  );
  const gasolineCapacityLiters = round1(
    depotTanks
      .filter((t) => t.mappedFuelType === 'gasoline')
      .reduce((acc, t) => acc + t.grossCapacityLiters, 0)
  );
  return {
    dieselCapacityLiters,
    gasolineCapacityLiters,
  };
}

export interface PumpReconciliationRow {
  pumpId: string;
  tankId: string;
  tankCode: string;
  depotId: string;
  fuelType: FuelType;
  fuelProduct: TankFuelProduct;
  dispenseCount: number;
  dispensedLiters: number;
  lastDispensedAt?: string;
}

export interface FuelClassReconciliationRow {
  fuelType: FuelType;
  label: string;
  tankCount: number;
  pumpCount: number;
  pumpIds: string[];
  grossCapacityLiters: number;
  bookVolumeLiters: number;
  theoreticalBookLiters: number;
  varianceLiters: number;
  verifiedDeliveriesLiters: number;
  dispensedLiters: number;
  logCount: number;
  isReconciled: boolean;
}

export interface PumpAndFuelClassReconciliation {
  totalRegisteredTanks: number;
  totalRegisteredPumps: number;
  registeredPumpIds: string[];
  registeredFuelClasses: FuelType[];
  inventoryLogFuelClasses: FuelType[];
  fuelClassesReconciled: boolean;
  unmappedPumpIdsInLogs: string[];
  unlinkedLogCount: number;
  byFuelClass: FuelClassReconciliationRow[];
  byPump: PumpReconciliationRow[];
  isFullyReconciled: boolean;
}

/**
 * Reconciles registered StorageTanks, mapped Dispenser Pumps, and Fuel Classes
 * directly against Depot Inventory Logs for a single depot (or system-wide).
 */
export function reconcilePumpsAndFuelClassesWithInventoryLogs(
  tanks: ReadonlyArray<StorageTank>,
  inventoryLogs: ReadonlyArray<InventoryLog>,
  depotId?: string
): PumpAndFuelClassReconciliation {
  const scopedTanks = depotId ? tanks.filter((t) => t.depotId === depotId) : [...tanks];
  const scopedLogs = (
    depotId ? inventoryLogs.filter((l) => l.depotId === depotId) : [...inventoryLogs]
  ).filter((l) => l.approvalStatus !== 'rejected');

  const tankById = new Map(scopedTanks.map((t) => [t.id, t]));
  const pumpRowsMap = new Map<string, PumpReconciliationRow>();
  const registeredPumpIds: string[] = [];

  for (const tank of scopedTanks) {
    for (const rawPump of tank.connectedDispensers) {
      const pumpId = rawPump.trim();
      if (!pumpId) continue;
      const key = `${tank.depotId}::${pumpId}`;
      if (!pumpRowsMap.has(key)) {
        registeredPumpIds.push(pumpId);
        pumpRowsMap.set(key, {
          pumpId,
          tankId: tank.id,
          tankCode: tank.tankCode,
          depotId: tank.depotId,
          fuelType: tank.mappedFuelType,
          fuelProduct: tank.fuelProduct,
          dispenseCount: 0,
          dispensedLiters: 0,
        });
      }
    }
  }

  const unmappedPumpSet = new Set<string>();
  let unlinkedLogCount = 0;

  for (const log of scopedLogs) {
    if (!log.tankId || !tankById.has(log.tankId)) {
      unlinkedLogCount += 1;
    }
    if (log.pumpId && log.pumpId.trim()) {
      const cleanPump = log.pumpId.trim();
      const key = `${log.depotId}::${cleanPump}`;
      const row = pumpRowsMap.get(key);
      if (row) {
        if (log.transactionType === 'dispense') {
          row.dispenseCount += 1;
          row.dispensedLiters = round1(row.dispensedLiters + Math.abs(log.litersDelta));
          if (!row.lastDispensedAt || log.createdAt > row.lastDispensedAt) {
            row.lastDispensedAt = log.createdAt;
          }
        }
      } else {
        unmappedPumpSet.add(cleanPump);
      }
    }
  }

  const registeredFuelClassSet = new Set<FuelType>(scopedTanks.map((t) => t.mappedFuelType));
  const inventoryLogFuelClassSet = new Set<FuelType>(scopedLogs.map((l) => l.fuelType));

  const registeredFuelClasses = Array.from(registeredFuelClassSet).sort();
  const inventoryLogFuelClasses = Array.from(inventoryLogFuelClassSet).sort();

  const fuelClassesReconciled = inventoryLogFuelClasses.every((fc) =>
    registeredFuelClassSet.has(fc)
  );

  const fuelOrder: FuelType[] = ['diesel', 'gasoline'];
  const activeFuelClasses = fuelOrder.filter(
    (fc) => registeredFuelClassSet.has(fc) || inventoryLogFuelClassSet.has(fc)
  );

  const byFuelClass: FuelClassReconciliationRow[] = activeFuelClasses.map((fc) => {
    const classTanks = scopedTanks.filter((t) => t.mappedFuelType === fc);
    const classLogs = scopedLogs.filter((l) => l.fuelType === fc);
    const classPumps = Array.from(
      new Set(
        classTanks.flatMap((t) =>
          t.connectedDispensers.map((p) => p.trim()).filter((p) => p.length > 0)
        )
      )
    );

    const grossCapacityLiters = round1(
      classTanks.reduce((acc, t) => acc + t.grossCapacityLiters, 0)
    );
    const bookVolumeLiters = round1(
      classTanks.reduce((acc, t) => acc + t.currentBookVolumeLiters, 0)
    );

    let theoreticalBookLiters = 0;
    let verifiedDeliveriesLiters = 0;
    let dispensedLiters = 0;

    for (const tank of classTanks) {
      const recon = computeTankTheoreticalBookStock(tank, scopedLogs, scopedTanks);
      theoreticalBookLiters += recon.theoreticalBookLiters;
      verifiedDeliveriesLiters += recon.deliveriesLiters;
      dispensedLiters += recon.dispensedLiters;
    }

    theoreticalBookLiters = round1(theoreticalBookLiters);
    verifiedDeliveriesLiters = round1(verifiedDeliveriesLiters);
    dispensedLiters = round1(dispensedLiters);
    const varianceLiters = round1(bookVolumeLiters - theoreticalBookLiters);

    const isReconciled =
      classTanks.length > 0 &&
      classPumps.length > 0 &&
      Math.abs(varianceLiters) <= 0.1;

    return {
      fuelType: fc,
      label: fc === 'diesel' ? 'Diesel' : 'Gasoline (Regular 91)',
      tankCount: classTanks.length,
      pumpCount: classPumps.length,
      pumpIds: classPumps,
      grossCapacityLiters,
      bookVolumeLiters,
      theoreticalBookLiters,
      varianceLiters,
      verifiedDeliveriesLiters,
      dispensedLiters,
      logCount: classLogs.length,
      isReconciled,
    };
  });

  const unmappedPumpIdsInLogs = Array.from(unmappedPumpSet).sort();
  const isFullyReconciled =
    scopedTanks.length > 0 &&
    unmappedPumpIdsInLogs.length === 0 &&
    unlinkedLogCount === 0 &&
    fuelClassesReconciled &&
    byFuelClass.every((row) => row.isReconciled);

  return {
    totalRegisteredTanks: scopedTanks.length,
    totalRegisteredPumps: registeredPumpIds.length,
    registeredPumpIds,
    registeredFuelClasses,
    inventoryLogFuelClasses,
    fuelClassesReconciled,
    unmappedPumpIdsInLogs,
    unlinkedLogCount,
    byFuelClass,
    byPump: Array.from(pumpRowsMap.values()),
    isFullyReconciled,
  };
}

