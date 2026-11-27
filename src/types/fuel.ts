export type UserRole =
  | 'admin'
  | 'approver'
  | 'gso_head'
  | 'gso_dispenser'
  | 'department_head'
  | 'requester'
  | 'pmc_staff'
  | 'auditor';

export type NavSection =
  | 'dashboard'
  | 'registries'
  | 'work_plans'
  | 'approvals'
  | 'dispensing'
  | 'inventory'
  | 'users'
  | 'reports'
  | 'audit';

export type RegistrySubTab = 'fleet' | 'pmc_projects' | 'depot';

export type EnvironmentMode = 'sandbox' | 'live';

export type FuelType = 'gasoline' | 'diesel';

export type EquipmentClass =
  | 'light_utility'
  | 'service_pickup'
  | 'dump_truck'
  | 'heavy_equipment'
  | 'generator_tool'
  | 'emergency_rescue';

export type EfficiencyUnit = 'km_per_liter' | 'liters_per_hour';

export type VehicleStatus =
  | 'operational'
  | 'maintenance'
  | 'dispatched'
  | 'decommissioned';

export type WorkPlanStatus =
  | 'pending_approval'
  | 'approved'
  | 'partially_approved'
  | 'rejected'
  | 'completed';

export type TripTicketStatus =
  | 'pending'
  | 'approved'
  | 'reduced'
  | 'dispensed'
  | 'forfeited'
  | 'rejected';

export type InventoryTransactionType =
  | 'delivery'
  | 'dispense'
  | 'shrinkage_adjustment'
  | 'overage_adjustment';

export type InventoryApprovalStatus =
  | 'pending_gso_approval'
  | 'verified'
  | 'rejected';

export interface UserAccount {
  uid: string;
  username?: string;
  passwordHash?: string;
  email: string;
  displayName: string;
  role: UserRole;
  department: string;
  positionTitle?: string;
  canEdit?: boolean;
  canDelete?: boolean;
  canSwitchToLive?: boolean;
  canRequestSingleTrip?: boolean;
  gsoVerificationCode?: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FleetVehicle {
  id: string;
  office: string;
  officeMnemonic?: string;
  plateNumber: string;
  chassisNumber: string;
  makeModel: string;
  yearAcquired: number;
  equipmentClass: EquipmentClass;
  fuelType: FuelType;
  efficiencyRate: number;
  efficiencyUnit: EfficiencyUnit;
  maxWeeklyLiters: number;
  assignedDriver?: string;
  driverLicense?: string;
  status: VehicleStatus;
  nextMaintenanceDate?: string;
  odometerKm?: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PmcProject {
  id: string;
  department: string;
  approvalYear: number;
  projectName: string;
  aipCode: string;
  dieselFuelComponentPhp: number;
  gasolineFuelComponentPhp: number;
  fuelComponentAmountPhp: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type TankFuelProduct =
  | 'diesel'
  | 'regular_91'
  | 'mid_grade'
  | 'premium_95'
  | 'kerosene'
  | 'bio_diesel';

export type TankInstallationType = 'underground_ust' | 'aboveground_ast';

export type TankMaterialType =
  | 'double_wall_fiberglass'
  | 'double_wall_steel'
  | 'single_wall_steel';

export type TankGeometryType =
  | 'horizontal_cylinder_flat'
  | 'horizontal_cylinder_dished'
  | 'vertical_cylinder'
  | 'rectangular_box';

export type CalibrationHealthStatus = 'active' | 'expiring_soon' | 'calibration_due';

export interface StrappingPoint {
  heightCm: number;
  volumeLiters: number;
}

export interface StrappingCurve {
  mode: 'formula' | 'custom_csv';
  sourceName?: string;
  points: StrappingPoint[];
}

export interface DispenserMapping {
  pumpId: string;
  nozzleLabel: string;
  tankId: string;
  depotId: string;
  fuelProduct: TankFuelProduct;
}

export interface FuelDepot {
  id: string;
  siteCode?: string;
  name: string;
  location: string;
  coordinates?: string;
  permitNumber?: string;
  calibrationExpiryDate?: string;
  stationManager?: string;
  gasolineCapacityLiters: number;
  gasolineCurrentLiters: number;
  gasolinePricePerLiter: number;
  dieselCapacityLiters: number;
  dieselCurrentLiters: number;
  dieselPricePerLiter: number;
  reorderThresholdPct?: number;
  lastDipVerifiedAt?: string;
  lastDipVerifiedBy?: string;
  updatedAt: string;
}

export interface StorageTank {
  id: string;
  depotId: string;
  tankCode: string;
  name: string;
  locationZone: string;
  manholeTag?: string;
  installationType: TankInstallationType;
  material: TankMaterialType;
  fuelProduct: TankFuelProduct;
  mappedFuelType: FuelType;
  connectedDispensers: string[];
  geometry: TankGeometryType;
  diameterCm: number;
  lengthCm: number;
  widthCm?: number;
  heightCm?: number;
  riserOffsetCm: number;
  tiltAngleDegrees: number;
  overfillBufferPct: number;
  deadstockClearanceCm: number;
  lowStockAlertLiters: number;
  grossCapacityLiters: number;
  safeFillCapacityLiters: number;
  deadstockVolumeLiters: number;
  netWorkingVolumeLiters: number;
  calibrationCertificateNo?: string;
  calibrationExpiryDate?: string;
  customStrappingPoints?: StrappingPoint[];
  openingDipLiters: number;
  currentBookVolumeLiters: number;
  currentWacPhp?: number;
  lastDipVolumeLiters?: number;
  lastDipAt?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkPlan {
  id: string;
  controlNumber: string;
  requestType?: 'weekly_work_plan' | 'single_trip';
  preparationDate?: string;
  department: string;
  projectTitle: string;
  projectCode: string;
  weekStart: string;
  weekEnd: string;
  status: WorkPlanStatus;
  totalRequestedLiters: number;
  totalApprovedLiters: number;
  totalDispensedLiters: number;
  preparedBy: string;
  preparedByDesignation?: string;
  reviewedBy: string;
  reviewedByDesignation?: string;
  approvedBy: string;
  approvedByDesignation?: string;
  divisionHead?: string;
  unitLead?: string;
  sectionManager?: string;
  approverNote?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripTicket {
  id: string;
  workPlanId: string;
  ticketNumber: string;
  gsoTransactionCode?: string;
  department: string;
  projectTitle: string;
  purposeOrProject?: string;
  projectAip?: string;
  pmcProjectId?: string;
  vehicleId: string;
  plateNumber: string;
  vehicleLabel?: string;
  driverName: string;
  driverLicense?: string;
  fuelType: FuelType;
  depotId: string;
  scheduledDate: string;
  destination: string;
  estimatedUsage?: number;
  computedLimitLiters: number;
  requestedLiters: number;
  approvedLiters: number;
  dispensedLiters: number;
  forfeitedLiters: number;
  unitPriceAtDispense?: number;
  servedOnce: boolean;
  dispensedAt?: string;
  dispensedBy?: string;
  pumpReadingPhotoDataUrl?: string;
  pumpReadingPhotoName?: string;
  status: TripTicketStatus;
  reductionReason?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLog {
  id: string;
  depotId: string;
  depotName: string;
  tankId?: string;
  pumpId?: string;
  fuelType: FuelType;
  transactionType: InventoryTransactionType;
  litersDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  deliveryUnitCostPhp?: number;
  deliveryTotalAmountPhp?: number;
  weightedAverageCostBefore?: number;
  weightedAverageCostAfter?: number;
  prevailingWeightedAverageCostPhp?: number;
  physicalDipLiters?: number;
  gsoTransactionCode?: string;
  tripTicketNumber?: string;
  referenceNumber: string;
  purchaseOrderRef?: string;
  supplierName?: string;
  deliveryDate?: string;
  notes?: string;
  approvalStatus: InventoryApprovalStatus;
  gsoApproverName?: string;
  digitalVerificationCode?: string;
  verifiedAt?: string;
  ownerId: string;
  createdAt: string;
}

export type AuditLogCategory = 'credential' | 'transaction' | 'registry' | 'system';

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorName?: string;
  actorRole: string;
  department?: string;
  category?: AuditLogCategory;
  environment?: EnvironmentMode;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details?: string;
  createdAt: string;
}

export type FuelClassLedgerMovement = 'in' | 'out' | 'adjustment';

export interface FuelClassLedgerRow {
  log: InventoryLog;
  movementKind: FuelClassLedgerMovement;
  movementLabel: string;
  timestamp: string;
  txCode: string;
  referenceText: string;
  tripTicketNumber: string;
  tankId?: string;
  tankCode?: string;
  tankName?: string;
  pumpId?: string;
  inLiters: number | null;
  outLiters: number | null;
  adjustmentLiters: number | null;
  runningVolumeLiters: number;
  effectedWacPhp: number;
  transactionCostPhp: number;
  runningCostPhp: number;
  isVerified: boolean;
}

export interface TankLedgerWacSnapshot {
  tankId: string;
  tankCode: string;
  tankName: string;
  depotId: string;
  depotName: string;
  runningVolumeLiters: number;
  currentWacPhp: number;
  runningCostPhp: number;
}

export interface FuelClassLedgerSummary {
  fuelType: FuelType;
  openingVolumeLiters: number;
  totalInLiters: number;
  totalOutLiters: number;
  netAdjustmentLiters: number;
  closingVolumeLiters: number;
  currentEffectedWacPhp: number;
  closingInventoryCostPhp: number;
  totalInCostPhp: number;
  totalOutCostPhp: number;
  netAdjustmentCostPhp: number;
  verifiedCount: number;
  pendingCount: number;
  tankBreakdown?: TankLedgerWacSnapshot[];
}

export interface DiscrepancyAlert {
  id: string;
  severity: 'high' | 'medium';
  category:
    | 'forfeited_variance'
    | 'over_limit_request'
    | 'depot_shrinkage'
    | 'low_depot_reserve'
    | 'pending_dip_verification';
  title: string;
  detail: string;
  department?: string;
  referenceId: string;
}

export interface DailyReconciliationSummary {
  date: string;
  totalRequestedLiters: number;
  totalApprovedLiters: number;
  totalDispensedLiters: number;
  totalForfeitedLiters: number;
  gasolineDispensedLiters: number;
  dieselDispensedLiters: number;
  totalDispensedCostPhp: number;
  estimatedSavingsFromReductionsPhp: number;
  ticketsCount: number;
  dispensedTicketsCount: number;
  departmentBreakdown: Array<{
    department: string;
    requestedLiters: number;
    approvedLiters: number;
    dispensedLiters: number;
    forfeitedLiters: number;
    costPhp: number;
  }>;
  alerts: DiscrepancyAlert[];
}

export type WorkPlanReportLayoutVariant = 'for_approval' | 'post_approval_monitoring';

export type ReportUtilitiesTargetKey =
  | 'workplans_preview'
  | 'workplans_full_review'
  | 'workplans_review_tickets'
  | 'workplans_monitoring_review'
  | 'workplans_monitoring_tickets'
  | 'approvals_preview'
  | 'dispensing_approved_preview'
  | 'dispensing_dispensed_preview'
  | 'reports_full_preview'
  | 'reports_dept_table';

export interface ReportFieldConfigItem {
  key: string;
  enabled: boolean;
}

export interface ReportUtilitiesConfig {
  id: 'report_utilities';
  workplans_preview: ReportFieldConfigItem[];
  workplans_full_review: ReportFieldConfigItem[];
  workplans_review_tickets: ReportFieldConfigItem[];
  workplans_monitoring_review: ReportFieldConfigItem[];
  workplans_monitoring_tickets: ReportFieldConfigItem[];
  approvals_preview: ReportFieldConfigItem[];
  dispensing_approved_preview: ReportFieldConfigItem[];
  dispensing_dispensed_preview: ReportFieldConfigItem[];
  reports_full_preview: ReportFieldConfigItem[];
  reports_dept_table: ReportFieldConfigItem[];
  updatedBy: string;
  updatedAt: string;
}

export interface SyncQueueItem {
  id: string;
  envMode?: EnvironmentMode;
  collection:
    | 'workPlans'
    | 'tripTickets'
    | 'vehicles'
    | 'pmcProjects'
    | 'depots'
    | 'storageTanks'
    | 'inventoryLogs'
    | 'auditLogs'
    | 'users'
    | 'settings';
  docId: string;
  operation: 'set' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  createdAt: string;
}

export const BAIS_DEPARTMENTS = [
  'City Engineering Office',
  'General Services Office (GSO)',
  'City Agriculture Office',
  'City Disaster Risk Reduction & Management Office (CDRRMO)',
  'City Health Office',
  'City Environment & Natural Resources Office (CENRO)',
  'Project Monitoring Committee (PMC)',
  'City Mayor\'s Office',
  'Internal Audit Service',
] as const;

export const BAIS_DEPARTMENT_MNEMONICS: Record<(typeof BAIS_DEPARTMENTS)[number], string> = {
  'City Engineering Office': 'CEO',
  'General Services Office (GSO)': 'GSO',
  'City Agriculture Office': 'CAGRO',
  'City Disaster Risk Reduction & Management Office (CDRRMO)': 'DRRMO',
  'City Health Office': 'CHO',
  'City Environment & Natural Resources Office (CENRO)': 'CENRO',
  'Project Monitoring Committee (PMC)': 'PMC',
  "City Mayor's Office": 'CMO',
  'Internal Audit Service': 'IAS',
};

export const EQUIPMENT_CLASS_SPECS: Record<
  EquipmentClass,
  {
    label: string;
    defaultUnit: EfficiencyUnit;
    defaultGasolineRate: number;
    defaultDieselRate: number;
    defaultMaxWeeklyLiters: number;
  }
> = {
  light_utility: {
    label: 'Light Utility / Motorcycle',
    defaultUnit: 'km_per_liter',
    defaultGasolineRate: 22,
    defaultDieselRate: 16,
    defaultMaxWeeklyLiters: 60,
  },
  service_pickup: {
    label: 'Service Pick-up / Utility Van',
    defaultUnit: 'km_per_liter',
    defaultGasolineRate: 9,
    defaultDieselRate: 11,
    defaultMaxWeeklyLiters: 180,
  },
  dump_truck: {
    label: 'Dump Truck (6W / 10W)',
    defaultUnit: 'km_per_liter',
    defaultGasolineRate: 4,
    defaultDieselRate: 4.5,
    defaultMaxWeeklyLiters: 420,
  },
  heavy_equipment: {
    label: 'Heavy Equipment (Backhoe / Grader / Loader)',
    defaultUnit: 'liters_per_hour',
    defaultGasolineRate: 10,
    defaultDieselRate: 14,
    defaultMaxWeeklyLiters: 600,
  },
  generator_tool: {
    label: 'Power Tools / Generator / Brushcutter',
    defaultUnit: 'liters_per_hour',
    defaultGasolineRate: 2.2,
    defaultDieselRate: 4.5,
    defaultMaxWeeklyLiters: 90,
  },
  emergency_rescue: {
    label: 'Emergency / Ambulance / Fire Truck',
    defaultUnit: 'km_per_liter',
    defaultGasolineRate: 6.5,
    defaultDieselRate: 7.5,
    defaultMaxWeeklyLiters: 280,
  },
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'System Administrator',
  approver: 'Tabletop Approver',
  gso_head: 'GSO Head',
  gso_dispenser: 'GSO Depot Dispenser',
  department_head: 'Department Head',
  requester: 'Department Requester',
  pmc_staff: 'PMC Staff',
  auditor: 'Internal Auditor',
};
