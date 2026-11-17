export type UserRole =
  | 'admin'
  | 'approver'
  | 'gso_head'
  | 'gso_dispenser'
  | 'department_head'
  | 'requester'
  | 'auditor';

export type NavSection =
  | 'dashboard'
  | 'fleet'
  | 'work_plans'
  | 'approvals'
  | 'dispensing'
  | 'inventory'
  | 'users'
  | 'reports'
  | 'audit';

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
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FleetVehicle {
  id: string;
  office: string;
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

export interface FuelDepot {
  id: string;
  name: string;
  location: string;
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

export interface WorkPlan {
  id: string;
  controlNumber: string;
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
  department: string;
  projectTitle: string;
  purposeOrProject?: string;
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
  fuelType: FuelType;
  transactionType: InventoryTransactionType;
  litersDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  physicalDipLiters?: number;
  referenceNumber: string;
  notes?: string;
  approvalStatus: InventoryApprovalStatus;
  gsoApproverName?: string;
  digitalVerificationCode?: string;
  verifiedAt?: string;
  ownerId: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  department?: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
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

export interface SyncQueueItem {
  id: string;
  envMode?: EnvironmentMode;
  collection: 'workPlans' | 'tripTickets' | 'vehicles' | 'depots' | 'inventoryLogs' | 'auditLogs' | 'users';
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
  'City Mayor\'s Office',
  'Internal Audit Service',
] as const;

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
  auditor: 'Internal Auditor',
};
