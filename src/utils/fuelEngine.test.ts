import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysIso,
  authenticateLocalUserCredentials,
  buildCredentialLoginPayloadsFromUser,
  buildDailyReconciliationReport,
  buildDispensingCsvContent,
  buildFuelClassLedger,
  buildInvitePayloadFromUser,
  buildPreDeliveryDipVarianceAdjustment,
  calculateFuelLimit,
  canAccessDepartmentRecord,
  canAccessDepotLedgerRegister,
  canAccessDepotRegistry,
  canAccessFleetRegistry,
  canAccessNavSection,
  canAccessPmcProjectRegistry,
  canDispenseAtGso,
  canEditOrDeleteRecords,
  canExportDispensingRecords,
  canManagePmcProjects,
  canManageReportUtilities,
  canManageUsers,
  canPreviewAndDownloadPdf,
  canPreviewDispensingFullRecord,
  canRegisterFleetUnit,
  canUserDeleteRecords,
  canUserEditRecords,
  canUserEditWorkPlanRecord,
  canUserRequestSingleTrip,
  canUserSwitchToLive,
  canViewAuditLogs,
  canViewDailyReconciliation,
  categorizeAndFilterApprovals,
  categorizeAndFilterDispensingTickets,
  categorizeDepartmentWorkPlans,
  checkDepartmentMnemonicCollision,
  computeAggregateDepotWacFromTanks,
  computeCredentialProofId,
  computeSingleDispenseOutcome,
  computeWorkPlanFuelTotals,
  createDefaultReportUtilitiesConfig,
  deduplicateUsersByEmail,
  deriveDepartmentMnemonic,
  evaluateDipstickReading,
  evaluateInventoryLogDipstick,
  evaluateSingleTripTicketWindow,
  evaluateTabletopApproval,
  evaluateWorkPlanWeekStart,
  filterAndCategorizeWorkPrograms,
  filterAndSummarizePmcProjects,
  filterDepotInventoryLogs,
  filterVehiclesForTicket,
  findDispensingTicketByNumber,
  formatDepartmentWithMnemonic,
  formatWorkPlanPreparedTimestamp,
  generateDistinctGsoVerificationCode,
  generateNextGsoTransactionCode,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getActiveReportUtilityKeys,
  getAllowedNavSections,
  getAllowedRegistrySubTabs,
  getCompactMobileReportSections,
  getDefaultNavSection,
  getDepartmentMnemonic,
  getDynamicProgressiveYearOptions,
  getGsoTransactionPrefix,
  getInventoryDeltaColorClass,
  getInventoryDeltaTone,
  getLocalIsoDate,
  getMissingTicketMandatoryFields,
  getOrderedWorkPlanFullReportSections,
  getRemainingInactivityMs,
  getVehicleClassificationLabel,
  getVehicleFuelTypeFromRegistry,
  getWorkPlanDepartmentSignOffs,
  getWorkPlanDisplayLabel,
  getWorkPlanFullReportSummaryItems,
  getWorkPlanReportTargetsForVariant,
  getWorkPlansForPeriod,
  getWorkPlanVehicleClassifications,
  SINGLE_REQUEST_TICKET_LABEL,
  hashPassword,
  hasValidPumpReadingProof,
  INACTIVITY_TIMEOUT_MS,
  isAipCodeMandatory,
  isGsoDispenserOnlyMode,
  isProjectAipOptionalDepartment,
  isSessionExpired,
  isWorkPlanInactive,
  mergeClaimedUserProfile,
  normalizeEmailToId,
  normalizeReportUtilitiesConfig,
  findMatchingRbacUsersForSandboxPreview,
  getSandboxPreviewDepartmentsForRole,
  parsePersistedSession,
  prepareFirestoreRecordPayload,
  reconcileCollectionRecords,
  resolveDepotTransactionVerification,
  reorderReportUtilityItems,
  replaceYearInProjectCode,
  REPORT_UTILITIES_TARGET_KEYS,
  REPORT_UTILITIES_TARGET_SPECS,
  requiresWorkPlanSignOffs,
  resolveActiveUserFromRegistry,
  resolveDefaultSandboxDepartmentForRole,
  resolveEffectiveEnvironmentAfterGoogleAuth,
  resolveInventoryLogDisplayRefs,
  resolveReportPreviewMode,
  resolveSandboxPreviewUser,
  resolveTopEscapeHandlerId,
  resolveWorkPlanReportLayoutVariant,
  shiftIsoDateToYear,
  shouldDisplayWorkPlanSignOffs,
  shouldRenderDispensingSection,
  shouldRenderWorkProgramFolder,
  shouldShowWorkPlanNumberField,
  stripUndefinedFields,
  buildWeightedAverageCostLedger,
  classifyAuditLogCategory,
  computePmcProjectFuelSummary,
  computeWeightedAverageCostAfterDelivery,
  filterAuditLogs,
  formatAuditTimestamp,
  parseAuditDetailsEntries,
  sanitizeAuditDetails,
  sortAuditLogsLatestFirst,
  matchGsoHeadVerificationCode,
  matchTicketToPmcProject,
  normalizeGsoVerificationCode,
  normalizePmcProject,
  PMC_OFFICE_DEPARTMENT,
  requiresPmcRegistryReference,
  resolvePrevailingWeightedAverageCost,
  TABLETOP_APPROVER_DEPARTMENT,
  toggleReportUtilityItem,
  USER_OFFICE_DEPARTMENT,
  validateDepartmentMnemonic,
  validateDraftTicketsAgainstPmcCaps,
  validateGsoHeadVerificationCode,
  validatePmcProjectInput,
  validateWorkProgramMandatoryFilters,
} from './fuelEngine';
import { generateWorkPlanPdf } from './pdfGenerator';
import {
  BAIS_DEPARTMENT_MNEMONICS,
  BAIS_DEPARTMENTS,
  FleetVehicle,
  FuelDepot,
  InventoryLog,
  StorageTank,
  PmcProject,
  TripTicket,
  UserAccount,
  WorkPlan,
} from '../types/fuel';

test('calculateFuelLimit computes km/L vehicles and L/hr heavy equipment accurately', () => {
  const truckLimit = calculateFuelLimit({
    equipmentClass: 'dump_truck',
    fuelType: 'diesel',
    efficiencyRate: 4.5,
    efficiencyUnit: 'km_per_liter',
    estimatedUsage: 180,
    maxWeeklyLiters: 420,
    terrainFactor: 1.1,
  });
  // (180 / 4.5) * 1.1 = 44 L
  assert.equal(truckLimit.computedLimitLiters, 44);
  assert.equal(truckLimit.exceedsWeeklyCap, false);

  const backhoeLimit = calculateFuelLimit({
    equipmentClass: 'heavy_equipment',
    fuelType: 'diesel',
    efficiencyRate: 14,
    efficiencyUnit: 'liters_per_hour',
    estimatedUsage: 30,
    maxWeeklyLiters: 600,
    terrainFactor: 1.0,
  });
  // 30 * 14 = 420 L
  assert.equal(backhoeLimit.computedLimitLiters, 420);
});

test('evaluateTabletopApproval allows approver latitude to reduce or reject requested fuel', () => {
  const reduced = evaluateTabletopApproval(100, 72.5);
  assert.equal(reduced.approvedLiters, 72.5);
  assert.equal(reduced.reductionLiters, 27.5);
  assert.equal(reduced.reductionPct, 27.5);
  assert.equal(reduced.status, 'reduced');

  const clampedOver = evaluateTabletopApproval(80, 120);
  assert.equal(clampedOver.approvedLiters, 80);
  assert.equal(clampedOver.status, 'approved');

  const rejected = evaluateTabletopApproval(50, 0);
  assert.equal(rejected.approvedLiters, 0);
  assert.equal(rejected.status, 'rejected');
});

test('computeSingleDispenseOutcome enforces once-per-day dispensing and forfeits unserved balance', () => {
  const depot: FuelDepot = {
    id: 'depot_gso',
    name: 'GSO Central Depot',
    location: 'Bais City Hall',
    gasolineCapacityLiters: 10000,
    gasolineCurrentLiters: 5000,
    gasolinePricePerLiter: 64.5,
    dieselCapacityLiters: 20000,
    dieselCurrentLiters: 12000,
    dieselPricePerLiter: 58.0,
    updatedAt: '2026-11-12T08:00:00Z',
  };

  const approvedTicket: TripTicket = {
    id: 'tt_1',
    workPlanId: 'wp_1',
    ticketNumber: '0000001',
    department: 'City Engineering Office',
    projectTitle: 'Coastal Road Rehab',
    purposeOrProject: 'Hauling aggregates',
    vehicleId: 'veh_1',
    plateNumber: 'SGV-402',
    driverName: 'Ramon Villanueva',
    fuelType: 'diesel',
    depotId: 'depot_gso',
    scheduledDate: '2026-11-12',
    destination: 'Brgy. Olympia',
    computedLimitLiters: 80,
    requestedLiters: 80,
    approvedLiters: 60,
    dispensedLiters: 0,
    forfeitedLiters: 0,
    servedOnce: false,
    status: 'reduced',
    ownerId: 'u1',
    createdAt: '2026-11-12T07:00:00Z',
    updatedAt: '2026-11-12T07:30:00Z',
  };

  const firstDispense = computeSingleDispenseOutcome({
    ticket: approvedTicket,
    actualDispensedLiters: 45,
    depot,
  });

  assert.equal(firstDispense.ok, true);
  assert.equal(firstDispense.dispensedLiters, 45);
  assert.equal(firstDispense.forfeitedLiters, 15);
  assert.equal(firstDispense.newDepotBalance, 11955);
  assert.equal(firstDispense.totalCostPhp, 2610);

  const secondDispense = computeSingleDispenseOutcome({
    ticket: { ...approvedTicket, servedOnce: true, dispensedLiters: 45, forfeitedLiters: 15, status: 'dispensed' },
    actualDispensedLiters: 15,
    depot,
  });
  assert.equal(secondDispense.ok, false);
});

test('buildDailyReconciliationReport generates discrepancy alerts for shrinkage, low reserve, and high forfeiture', () => {
  const depot: FuelDepot = {
    id: 'depot_gso',
    name: 'GSO Central Depot',
    location: 'Bais City Hall',
    gasolineCapacityLiters: 10000,
    gasolineCurrentLiters: 2000,
    gasolinePricePerLiter: 65,
    dieselCapacityLiters: 20000,
    dieselCurrentLiters: 15000,
    dieselPricePerLiter: 58,
    reorderThresholdPct: 25,
    updatedAt: '2026-11-12T08:00:00Z',
  };

  const ticket: TripTicket = {
    id: 'tt_2',
    workPlanId: 'wp_1',
    ticketNumber: '0000002',
    department: 'City Agriculture Office',
    projectTitle: 'Farm-to-Market Grading',
    purposeOrProject: 'Seed distribution',
    vehicleId: 'veh_2',
    plateNumber: 'Bais-09',
    driverName: 'Elena Ramos',
    fuelType: 'diesel',
    depotId: 'depot_gso',
    scheduledDate: '2026-11-12',
    destination: 'Brgy. Sab-ahan',
    computedLimitLiters: 50,
    requestedLiters: 70,
    approvedLiters: 50,
    dispensedLiters: 30,
    forfeitedLiters: 20,
    unitPriceAtDispense: 58,
    servedOnce: true,
    dispensedAt: '2026-11-12T09:15:00Z',
    status: 'dispensed',
    ownerId: 'u2',
    createdAt: '2026-11-12T07:00:00Z',
    updatedAt: '2026-11-12T09:15:00Z',
  };

  const shrinkLog: InventoryLog = {
    id: 'log_1',
    depotId: 'depot_gso',
    depotName: 'GSO Central Depot',
    fuelType: 'diesel',
    transactionType: 'shrinkage_adjustment',
    litersDelta: -350,
    balanceBefore: 15000,
    balanceAfter: 14650,
    referenceNumber: 'DIP-2026-1112',
    approvalStatus: 'pending_gso_approval',
    ownerId: 'u3',
    createdAt: '2026-11-12T08:00:00Z',
  };

  const report = buildDailyReconciliationReport({
    date: '2026-11-12',
    workPlans: [] as WorkPlan[],
    tickets: [ticket],
    depots: [depot],
    inventoryLogs: [shrinkLog],
  });

  assert.equal(report.totalDispensedLiters, 30);
  assert.equal(report.totalForfeitedLiters, 20);
  assert.equal(report.totalDispensedCostPhp, 1740);
  const categories = report.alerts.map((a) => a.category);
  assert.ok(categories.includes('over_limit_request'));
  assert.ok(categories.includes('forfeited_variance'));
  assert.ok(categories.includes('low_depot_reserve'));
  assert.ok(categories.includes('pending_dip_verification'));
  assert.ok(categories.includes('depot_shrinkage'));
});

test('sequential work plan and 7-digit trip ticket generators enforce uniqueness and 12-ticket max', () => {
  const existingPlans = [
    { controlNumber: 'WP-2026-0001' },
    { controlNumber: 'WP-2026-0003' },
  ] as WorkPlan[];
  assert.equal(generateNextWorkPlanNumber(existingPlans, 2026), 'WP-2026-0004');
  assert.equal(generateNextWorkPlanNumber([], 2026), 'WP-2026-0001');

  const existingTickets = [
    { ticketNumber: '0000001' },
    { ticketNumber: '0000004' },
  ] as TripTicket[];
  const generated = generateNextTripTicketNumbers(existingTickets, 15);
  assert.equal(generated.length, 12); // capped at max 12 trip tickets
  assert.equal(generated[0], '0000005');
  assert.equal(generated[11], '0000016');
  assert.ok(generated.every((num) => /^\d{7}$/.test(num)));
});

test('isWorkPlanInactive moves untouched >30 day pending work plans to inactive folder and computes fuel totals', () => {
  const ref = new Date('2026-11-15T00:00:00Z');
  const stalePending = {
    status: 'pending_approval',
    createdAt: '2026-10-05T08:00:00Z',
    updatedAt: '2026-10-05T08:00:00Z',
  } as WorkPlan;
  const freshPending = {
    status: 'pending_approval',
    createdAt: '2026-11-10T08:00:00Z',
    updatedAt: '2026-11-10T08:00:00Z',
  } as WorkPlan;
  const oldApproved = {
    status: 'approved',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-02T08:00:00Z',
  } as WorkPlan;

  assert.equal(isWorkPlanInactive(stalePending, ref), true);
  assert.equal(isWorkPlanInactive(freshPending, ref), false);
  assert.equal(isWorkPlanInactive(oldApproved, ref), false);

  const totals = computeWorkPlanFuelTotals([
    { fuelType: 'diesel', requestedLiters: 45.5 },
    { fuelType: 'diesel', requestedLiters: 20 },
    { fuelType: 'gasoline', requestedLiters: 15.2 },
  ] as TripTicket[]);
  assert.equal(totals.totalDiesel, 65.5);
  assert.equal(totals.totalGasoline, 15.2);
  assert.equal(totals.ticketCount, 3);
});

test('RBAC helpers and hashPassword enforce admin-only views and granular edit/delete permissions', () => {
  assert.equal(canManageUsers('admin'), true);
  assert.equal(canManageUsers('approver'), false);
  assert.equal(canViewAuditLogs('admin'), true);
  assert.equal(canViewAuditLogs('auditor'), false);
  assert.equal(canViewDailyReconciliation('admin'), true);
  assert.equal(canViewDailyReconciliation('approver'), false);

  assert.equal(canEditOrDeleteRecords('admin'), true);
  assert.equal(canUserEditRecords({ role: 'requester', canEdit: true }), true);
  assert.equal(canUserEditRecords({ role: 'requester', canEdit: false }), false);
  assert.equal(canUserDeleteRecords({ role: 'department_head', canDelete: true }), true);
  assert.equal(canUserDeleteRecords({ role: 'department_head', canDelete: false }), false);

  assert.equal(canPreviewAndDownloadPdf('admin'), true);
  assert.equal(canPreviewAndDownloadPdf('requester'), true);
  assert.equal(
    canAccessDepartmentRecord('requester', 'City Engineering Office', 'City Health Office'),
    false
  );
  assert.equal(
    canAccessDepartmentRecord('requester', 'City Engineering Office', 'City Engineering Office'),
    true
  );

  // Verify SHA-256 hex digest is deterministic and 64 hex chars
  const h1 = hashPassword('BaisAdmin2026!');
  const h2 = hashPassword('BaisAdmin2026!');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, hashPassword('wrongpass'));
});

test('filterVehiclesForTicket narrows fleet units by search, office, equipment class, and fuel grade', () => {
  const sampleFleet: FleetVehicle[] = [
    {
      id: 'v1',
      office: 'City Engineering Office',
      plateNumber: 'SGV-042',
      chassisNumber: 'CH-1',
      makeModel: 'Isuzu Giga Dump Truck',
      yearAcquired: 2022,
      equipmentClass: 'dump_truck',
      fuelType: 'diesel',
      efficiencyRate: 4.5,
      efficiencyUnit: 'km_per_liter',
      maxWeeklyLiters: 420,
      status: 'operational',
      ownerId: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'v2',
      office: 'City Engineering Office',
      plateNumber: 'GEN-019',
      chassisNumber: 'CH-2',
      makeModel: 'Honda Brushcutter & Generator',
      yearAcquired: 2024,
      equipmentClass: 'generator_tool',
      fuelType: 'gasoline',
      efficiencyRate: 2.2,
      efficiencyUnit: 'liters_per_hour',
      maxWeeklyLiters: 90,
      status: 'operational',
      ownerId: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'v3',
      office: 'City Health Office',
      plateNumber: 'SLF-210',
      chassisNumber: 'CH-3',
      makeModel: 'Toyota Hiace Ambulance',
      yearAcquired: 2023,
      equipmentClass: 'emergency_rescue',
      fuelType: 'diesel',
      efficiencyRate: 9.0,
      efficiencyUnit: 'km_per_liter',
      maxWeeklyLiters: 260,
      status: 'maintenance',
      ownerId: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  assert.equal(filterVehiclesForTicket(sampleFleet, {}).length, 3);
  assert.deepEqual(
    filterVehiclesForTicket(sampleFleet, { fuelType: 'diesel', office: 'City Engineering Office' }).map((v) => v.id),
    ['v1']
  );
  assert.deepEqual(
    filterVehiclesForTicket(sampleFleet, { equipmentClass: 'generator_tool' }).map((v) => v.id),
    ['v2']
  );
  assert.deepEqual(
    filterVehiclesForTicket(sampleFleet, { search: 'hiace' }).map((v) => v.id),
    ['v3']
  );
});

test('getMissingTicketMandatoryFields detects missing mandatory fields including Project AIP unless City Mayor Office', () => {
  const incomplete = getMissingTicketMandatoryFields({
    vehicleId: 'v1',
    driverName: '   ',
    depotId: 'd1',
    purposeOrProject: '',
    projectAip: '  ',
    destination: '',
    scheduledDate: '2026-11-13',
    requestedLiters: 0,
  });
  assert.deepEqual(incomplete, [
    'driverName',
    'purposeOrProject',
    'projectAip',
    'destination',
    'requestedLiters',
  ]);

  const missingOnlyAip = getMissingTicketMandatoryFields({
    vehicleId: 'v1',
    driverName: 'Juan Dela Cruz',
    depotId: 'd1',
    purposeOrProject: 'Road grading maintenance',
    projectAip: '',
    destination: 'Brgy. Mabunao to City Hall',
    scheduledDate: '2026-11-13',
    requestedLiters: 30,
  });
  assert.deepEqual(missingOnlyAip, ['projectAip']);

  // City Mayor's Office makes Project AIP optional
  assert.equal(isProjectAipOptionalDepartment("City Mayor's Office"), true);
  assert.equal(isProjectAipOptionalDepartment("  city mayor's   office "), true);
  assert.equal(isProjectAipOptionalDepartment('City Engineering Office'), false);

  const mayorOfficeOptional = getMissingTicketMandatoryFields(
    {
      vehicleId: 'v1',
      driverName: 'Juan Dela Cruz',
      depotId: 'd1',
      purposeOrProject: 'Official city coordination',
      projectAip: '',
      destination: 'City Hall to Dumaguete',
      scheduledDate: '2026-11-13',
      requestedLiters: 30,
    },
    { projectAipOptional: isProjectAipOptionalDepartment("City Mayor's Office") }
  );
  assert.deepEqual(mayorOfficeOptional, []);

  const completeWithAip = getMissingTicketMandatoryFields({
    vehicleId: 'v1',
    driverName: 'Juan Dela Cruz',
    depotId: 'd1',
    purposeOrProject: 'Road grading maintenance',
    projectAip: 'AIP-2026-101-04',
    destination: 'Brgy. Mabunao to City Hall',
    scheduledDate: '2026-11-13',
    requestedLiters: 30,
  });
  assert.deepEqual(completeWithAip, []);
});

test('categorizeDepartmentWorkPlans splits records into Pending and Approved and flags undispensed approved fuel', () => {
  const plans = [
    {
      id: 'wp1',
      status: 'pending_approval',
      totalApprovedLiters: 0,
      totalDispensedLiters: 0,
    },
    {
      id: 'wp2',
      status: 'approved',
      totalApprovedLiters: 120,
      totalDispensedLiters: 60,
    },
    {
      id: 'wp3',
      status: 'partially_approved',
      totalApprovedLiters: 40,
      totalDispensedLiters: 40,
    },
  ] as WorkPlan[];

  const tickets = [
    { id: 't1', workPlanId: 'wp1', status: 'pending', approvedLiters: 0, dispensedLiters: 0, servedOnce: false },
    { id: 't2', workPlanId: 'wp2', status: 'dispensed', approvedLiters: 70, dispensedLiters: 60, servedOnce: true },
    { id: 't3', workPlanId: 'wp2', status: 'approved', approvedLiters: 50, dispensedLiters: 0, servedOnce: false },
    { id: 't4', workPlanId: 'wp3', status: 'dispensed', approvedLiters: 40, dispensedLiters: 40, servedOnce: true },
  ] as TripTicket[];

  const result = categorizeDepartmentWorkPlans(plans, tickets);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].workPlan.id, 'wp1');
  assert.equal(result.approved.length, 2);
  assert.equal(result.approved[0].hasUndispensedApproved, true);
  assert.equal(result.approved[0].undispensedTicketCount, 1);
  assert.equal(result.approved[0].undispensedApprovedLiters, 50);
  assert.equal(result.approved[1].hasUndispensedApproved, false);
  assert.equal(result.approved[1].dispensedLiters, 40);
});

test('hasValidPumpReadingProof enforces base64 image data URLs and rejects empty or non-image inputs', () => {
  assert.equal(hasValidPumpReadingProof(undefined), false);
  assert.equal(hasValidPumpReadingProof(''), false);
  assert.equal(hasValidPumpReadingProof('data:text/plain;base64,SGVsbG8gd29ybGQhMTIzNDU2'), false);
  assert.equal(
    hasValidPumpReadingProof('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='),
    true
  );
});

test('categorizeAndFilterDispensingTickets separates Approved vs Dispensed with Work Plan numbers and filters by search query', () => {
  const workPlans = [
    { id: 'wp1', controlNumber: 'WP-2026-0001' },
    { id: 'wp2', controlNumber: 'WP-2026-0002' },
  ] as WorkPlan[];

  const tickets = [
    {
      id: 't1',
      workPlanId: 'wp1',
      ticketNumber: '0000001',
      department: 'City Engineering Office',
      projectTitle: 'Coastal Road',
      plateNumber: 'SGV-042',
      driverName: 'Ramon Villanueva',
      destination: 'Brgy. Olympia',
      status: 'dispensed',
      approvedLiters: 75,
      dispensedLiters: 60,
      servedOnce: true,
      createdAt: '2026-11-09T07:30:00Z',
    },
    {
      id: 't2',
      workPlanId: 'wp1',
      ticketNumber: '0000002',
      department: 'City Engineering Office',
      projectTitle: 'Drainage Desilting',
      plateNumber: 'HEQ-011',
      driverName: 'Danilo Mercado',
      destination: 'Brgy. Okiot',
      status: 'reduced',
      approvedLiters: 90,
      dispensedLiters: 0,
      servedOnce: false,
      createdAt: '2026-11-11T14:00:00Z',
    },
    {
      id: 't3',
      workPlanId: 'wp2',
      ticketNumber: '0000004',
      department: 'CENRO',
      projectTitle: 'Baywalk Cleanup',
      plateNumber: 'GEN-019',
      driverName: 'Nestor Magallanes',
      destination: 'Bais Baywalk',
      status: 'approved',
      approvedLiters: 35,
      dispensedLiters: 0,
      servedOnce: false,
      createdAt: '2026-11-10T09:00:00Z',
    },
    {
      id: 't4',
      workPlanId: 'wp2',
      ticketNumber: '0000005',
      department: 'City Health Office',
      projectTitle: 'Mobile Clinic',
      plateNumber: 'SLM-007',
      driverName: 'Victorino Dela Cruz',
      destination: 'Brgy. Cabanlutan',
      status: 'pending',
      approvedLiters: 0,
      dispensedLiters: 0,
      servedOnce: false,
      createdAt: '2026-11-08T08:00:00Z',
    },
  ] as TripTicket[];

  const all = categorizeAndFilterDispensingTickets(tickets, workPlans, '');
  assert.equal(all.approved.length, 2);
  assert.equal(all.dispensed.length, 1);
  assert.equal(all.approved[0].workPlanNumber, 'WP-2026-0001');
  assert.equal(all.dispensed[0].workPlanNumber, 'WP-2026-0001');

  const byTicket = categorizeAndFilterDispensingTickets(tickets, workPlans, '0000004');
  assert.equal(byTicket.approved.length, 1);
  assert.equal(byTicket.approved[0].ticket.ticketNumber, '0000004');
  assert.equal(byTicket.dispensed.length, 0);
  assert.equal(byTicket.totalApprovedCount, 2);
  assert.equal(byTicket.totalDispensedCount, 1);

  const byWorkPlan = categorizeAndFilterDispensingTickets(tickets, workPlans, 'WP-2026-0001');
  assert.equal(byWorkPlan.approved.length, 1);
  assert.equal(byWorkPlan.dispensed.length, 1);
});

test('categorizeAndFilterDispensingTickets sorts latest created topmost and filters by fuelType, department, month, and year', () => {
  const workPlans = [
    { id: 'wp1', controlNumber: 'WP-2026-0001' },
    { id: 'wp2', controlNumber: 'WP-2026-0002' },
  ] as WorkPlan[];

  const tickets = [
    {
      id: 't_old',
      workPlanId: 'wp1',
      ticketNumber: '0000010',
      department: 'City Engineering Office',
      projectTitle: 'Road Grading',
      plateNumber: 'SGV-042',
      driverName: 'Ramon',
      fuelType: 'diesel',
      destination: 'Brgy. 1',
      status: 'approved',
      approvedLiters: 80,
      dispensedLiters: 0,
      servedOnce: false,
      createdAt: '2026-10-05T08:00:00Z',
    },
    {
      id: 't_new',
      workPlanId: 'wp2',
      ticketNumber: '0000011',
      department: 'CENRO',
      projectTitle: 'Coastal Cleanup',
      plateNumber: 'GEN-019',
      driverName: 'Nestor',
      fuelType: 'gasoline',
      destination: 'Baywalk',
      status: 'approved',
      approvedLiters: 35,
      dispensedLiters: 0,
      servedOnce: false,
      createdAt: '2026-11-12T09:00:00Z',
    },
    {
      id: 't_disp_old',
      workPlanId: 'wp1',
      ticketNumber: '0000008',
      department: 'City Engineering Office',
      projectTitle: 'Drainage',
      plateNumber: 'HEQ-011',
      driverName: 'Danilo',
      fuelType: 'diesel',
      destination: 'Brgy. 2',
      status: 'dispensed',
      approvedLiters: 60,
      dispensedLiters: 55,
      dispensedAt: '2025-11-02T10:00:00Z',
      servedOnce: true,
      createdAt: '2025-11-01T08:00:00Z',
    },
    {
      id: 't_disp_new',
      workPlanId: 'wp2',
      ticketNumber: '0000009',
      department: 'CENRO',
      projectTitle: 'Park Clearing',
      plateNumber: 'GEN-020',
      driverName: 'Luis',
      fuelType: 'gasoline',
      destination: 'Park',
      status: 'dispensed',
      approvedLiters: 25,
      dispensedLiters: 25,
      dispensedAt: '2026-11-13T11:30:00Z',
      servedOnce: true,
      createdAt: '2026-11-12T07:00:00Z',
    },
  ] as TripTicket[];

  const sorted = categorizeAndFilterDispensingTickets(tickets, workPlans, {});
  assert.equal(sorted.approved[0].ticket.ticketNumber, '0000011');
  assert.equal(sorted.approved[1].ticket.ticketNumber, '0000010');
  assert.equal(sorted.dispensed[0].ticket.ticketNumber, '0000009');
  assert.equal(sorted.dispensed[1].ticket.ticketNumber, '0000008');

  const dieselOnly = categorizeAndFilterDispensingTickets(tickets, workPlans, {
    fuelType: 'diesel',
  });
  assert.deepEqual(dieselOnly.approved.map((x) => x.ticket.ticketNumber), ['0000010']);
  assert.deepEqual(dieselOnly.dispensed.map((x) => x.ticket.ticketNumber), ['0000008']);

  const nov2026Cenro = categorizeAndFilterDispensingTickets(tickets, workPlans, {
    department: 'CENRO',
    month: '11',
    year: '2026',
  });
  assert.deepEqual(nov2026Cenro.approved.map((x) => x.ticket.ticketNumber), ['0000011']);
  assert.deepEqual(nov2026Cenro.dispensed.map((x) => x.ticket.ticketNumber), ['0000009']);
});

test('GSO dispensing full record preview and PDF/CSV export enforce role permissions and build valid CSV', () => {
  assert.equal(canPreviewDispensingFullRecord('admin'), true);
  assert.equal(canPreviewDispensingFullRecord('gso_dispenser'), true);
  assert.equal(canPreviewDispensingFullRecord('approver'), true);
  assert.equal(canPreviewDispensingFullRecord('auditor'), true);
  assert.equal(canPreviewDispensingFullRecord('department_head'), false);
  assert.equal(canPreviewDispensingFullRecord('requester'), false);

  assert.equal(canExportDispensingRecords('admin'), true);
  assert.equal(canExportDispensingRecords('gso_head'), true);
  assert.equal(canExportDispensingRecords('gso_dispenser'), false);
  assert.equal(canExportDispensingRecords('approver'), true);
  assert.equal(canExportDispensingRecords('auditor'), true);
  assert.equal(canExportDispensingRecords('department_head'), false);
  assert.equal(canExportDispensingRecords('requester'), false);

  const csv = buildDispensingCsvContent(
    [
      {
        workPlanNumber: 'WP-2026-0001',
        ticket: {
          id: 't1',
          workPlanId: 'wp1',
          ticketNumber: '0000001',
          gsoTransactionCode: 'DS00001',
          department: 'City Engineering, "North" Office',
          projectTitle: 'Coastal Road',
          vehicleId: 'v1',
          plateNumber: 'SGV-042',
          driverName: 'Ramon Villanueva',
          fuelType: 'diesel',
          depotId: 'depot_1',
          scheduledDate: '2026-11-12',
          destination: 'Brgy. Olympia',
          computedLimitLiters: 60,
          requestedLiters: 75,
          approvedLiters: 75,
          dispensedLiters: 60,
          forfeitedLiters: 15,
          servedOnce: true,
          dispensedAt: '2026-11-12T08:15:00Z',
          dispensedBy: 'Mario Santos',
          pumpReadingPhotoName: 'pump-001.jpg',
          status: 'dispensed',
          ownerId: 'u1',
          createdAt: '2026-11-09T07:30:00Z',
          updatedAt: '2026-11-12T08:15:00Z',
        },
      },
    ],
    [{ id: 'depot_1', name: 'GSO Central Fuel Depot' } as FuelDepot]
  );

  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Ticket Number,Work Plan Number,Category,Department,GSO Transaction Code'));
  assert.ok(lines[1].includes('0000001,WP-2026-0001,Dispensed,"City Engineering, ""North"" Office",DS00001'));
  assert.ok(lines[1].includes('DIESEL,75.0,60.0,15.0,2026-11-12,2026-11-12T08:15:00Z,Mario Santos,pump-001.jpg'));
});

test('10-minute inactivity window preserves session across refreshes within window and expires after 10 minutes idle', () => {
  assert.equal(INACTIVITY_TIMEOUT_MS, 600_000);
  const t0 = 1_700_000_000_000;

  assert.equal(isSessionExpired(t0, t0 + 9 * 60 * 1000 + 59_000), false);
  assert.equal(getRemainingInactivityMs(t0, t0 + 9 * 60 * 1000 + 59_000), 1000);
  assert.equal(isSessionExpired(t0, t0 + 10 * 60 * 1000), true);
  assert.equal(getRemainingInactivityMs(t0, t0 + 10 * 60 * 1000), 0);

  const rawValid = JSON.stringify({
    uid: 'user_admin',
    envMode: 'sandbox',
    sandboxActiveRole: 'admin',
    sandboxActiveDepartment: 'Internal Audit Service',
    activeSection: 'dispensing',
    lastActivityAt: t0,
  });

  const activeRefresh = parsePersistedSession(rawValid, t0 + 4 * 60 * 1000);
  assert.equal(activeRefresh.expired, false);
  assert.equal(activeRefresh.session?.uid, 'user_admin');
  assert.equal(activeRefresh.session?.activeSection, 'dispensing');

  const expiredRefresh = parsePersistedSession(rawValid, t0 + 10 * 60 * 1000 + 1);
  assert.equal(expiredRefresh.expired, true);
  assert.equal(expiredRefresh.session, null);
});

test('canUserSwitchToLive restricts live environment switching to admin or explicitly permitted users', () => {
  assert.equal(canUserSwitchToLive({ role: 'admin', canSwitchToLive: false }), true);
  assert.equal(canUserSwitchToLive({ role: 'approver', canSwitchToLive: false }), false);
  assert.equal(canUserSwitchToLive({ role: 'gso_dispenser', canSwitchToLive: undefined }), false);
  assert.equal(canUserSwitchToLive({ role: 'requester', canSwitchToLive: false }), false);
  assert.equal(canUserSwitchToLive({ role: 'approver', canSwitchToLive: true }), true);
  assert.equal(canUserSwitchToLive({ role: 'gso_dispenser', canSwitchToLive: true }), true);
});

test('role-based menu visibility, initial landing section, gso_head permissions, and department scoping', () => {
  assert.deepEqual(getAllowedNavSections('department_head'), ['work_plans']);
  assert.deepEqual(getAllowedNavSections('requester'), ['work_plans']);
  assert.equal(getDefaultNavSection('department_head'), 'work_plans');
  assert.equal(getDefaultNavSection('requester'), 'work_plans');

  assert.deepEqual(getAllowedNavSections('gso_head'), ['dispensing', 'inventory', 'registries']);
  assert.deepEqual(getAllowedNavSections('gso_dispenser'), ['dispensing', 'inventory']);
  assert.equal(getDefaultNavSection('gso_head'), 'dispensing');
  assert.equal(getDefaultNavSection('gso_dispenser'), 'dispensing');

  assert.deepEqual(getAllowedNavSections('approver'), ['approvals']);
  assert.equal(getDefaultNavSection('approver'), 'approvals');

  assert.deepEqual(getAllowedNavSections('admin'), [
    'dashboard',
    'registries',
    'work_plans',
    'approvals',
    'dispensing',
    'inventory',
    'users',
    'reports',
    'audit',
  ]);
  assert.equal(getDefaultNavSection('admin'), 'dashboard');

  // Strict unified Master Registries sub-tab RBAC across all 8 roles
  assert.deepEqual(getAllowedRegistrySubTabs('admin'), ['fleet', 'pmc_projects', 'depot']);
  assert.deepEqual(getAllowedRegistrySubTabs('gso_head'), ['fleet', 'depot']);
  assert.deepEqual(getAllowedRegistrySubTabs('pmc_staff'), ['pmc_projects']);
  assert.deepEqual(getAllowedRegistrySubTabs('gso_dispenser'), []);
  assert.deepEqual(getAllowedRegistrySubTabs('department_head'), []);
  assert.deepEqual(getAllowedRegistrySubTabs('requester'), []);
  assert.deepEqual(getAllowedRegistrySubTabs('approver'), []);
  assert.deepEqual(getAllowedRegistrySubTabs('auditor'), []);

  // Fleet Registry access & fleet unit registration: ONLY admin and gso_head
  assert.equal(canAccessFleetRegistry('admin'), true);
  assert.equal(canAccessFleetRegistry('gso_head'), true);
  assert.equal(canAccessFleetRegistry('pmc_staff'), false);
  assert.equal(canAccessFleetRegistry('gso_dispenser'), false);
  assert.equal(canAccessFleetRegistry('department_head'), false);
  assert.equal(canAccessFleetRegistry('requester'), false);
  assert.equal(canAccessFleetRegistry('approver'), false);
  assert.equal(canAccessFleetRegistry('auditor'), false);

  assert.equal(canRegisterFleetUnit('admin'), true);
  assert.equal(canRegisterFleetUnit('gso_head'), true);
  assert.equal(canRegisterFleetUnit('pmc_staff'), false);
  assert.equal(canRegisterFleetUnit('gso_dispenser'), false);
  assert.equal(canRegisterFleetUnit('department_head'), false);
  assert.equal(canRegisterFleetUnit('requester'), false);
  assert.equal(canRegisterFleetUnit('approver'), false);
  assert.equal(canRegisterFleetUnit('auditor'), false);

  // Depot Registry: ONLY admin and gso_head
  assert.equal(canAccessDepotRegistry('admin'), true);
  assert.equal(canAccessDepotRegistry('gso_head'), true);
  assert.equal(canAccessDepotRegistry('pmc_staff'), false);
  assert.equal(canAccessDepotRegistry('gso_dispenser'), false);
  assert.equal(canAccessDepotRegistry('department_head'), false);
  assert.equal(canAccessDepotRegistry('requester'), false);
  assert.equal(canAccessDepotRegistry('approver'), false);
  assert.equal(canAccessDepotRegistry('auditor'), false);

  // PMC Project Registry: ONLY admin and pmc_staff
  assert.equal(canAccessPmcProjectRegistry('admin'), true);
  assert.equal(canAccessPmcProjectRegistry('pmc_staff'), true);
  assert.equal(canAccessPmcProjectRegistry('gso_head'), false);
  assert.equal(canAccessPmcProjectRegistry('gso_dispenser'), false);
  assert.equal(canAccessPmcProjectRegistry('department_head'), false);
  assert.equal(canAccessPmcProjectRegistry('requester'), false);
  assert.equal(canAccessPmcProjectRegistry('approver'), false);
  assert.equal(canAccessPmcProjectRegistry('auditor'), false);

  assert.equal(canAccessNavSection('department_head', 'dashboard'), false);
  assert.equal(canAccessNavSection('department_head', 'work_plans'), true);
  assert.equal(canAccessNavSection('department_head', 'registries'), false);
  assert.equal(canAccessNavSection('gso_head', 'dispensing'), true);
  assert.equal(canAccessNavSection('gso_head', 'inventory'), true);
  assert.equal(canAccessNavSection('gso_head', 'registries'), true);
  assert.equal(canAccessNavSection('gso_head', 'approvals'), false);
  assert.equal(canAccessNavSection('gso_dispenser', 'registries'), false);
  assert.equal(canAccessNavSection('approver', 'approvals'), true);
  assert.equal(canAccessNavSection('approver', 'dispensing'), false);
  assert.equal(canAccessNavSection('approver', 'registries'), false);

  assert.equal(canDispenseAtGso('gso_head'), true);
  assert.equal(canPreviewDispensingFullRecord('gso_head'), true);
  assert.equal(canExportDispensingRecords('gso_head'), true);
  assert.equal(
    canAccessDepartmentRecord('department_head', 'City Engineering Office', 'City Health Office'),
    false
  );
  assert.equal(
    canAccessDepartmentRecord('department_head', 'City Engineering Office', 'City Engineering Office'),
    true
  );
  assert.equal(
    canAccessDepartmentRecord('gso_head', 'General Services Office (GSO)', 'City Engineering Office'),
    true
  );
});

test('filterAndCategorizeWorkPrograms routes 3 folders, computes Diesel/Gasoline metrics, and enforces mandatory Month/Year', () => {
  const missingBoth = validateWorkProgramMandatoryFilters({ month: '', year: '' });
  assert.equal(missingBoth.valid, false);
  assert.deepEqual(missingBoth.missingFields, ['month', 'year']);

  const missingMonth = validateWorkProgramMandatoryFilters({ month: '', year: '2026' });
  assert.equal(missingMonth.valid, false);
  assert.deepEqual(missingMonth.missingFields, ['month']);

  const validDate = validateWorkProgramMandatoryFilters({ month: '11', year: '2026' });
  assert.equal(validDate.valid, true);

  const plans: WorkPlan[] = [
    {
      id: 'wp_disp_all',
      controlNumber: 'WP-2026-0010',
      department: 'CENRO',
      projectTitle: 'Coastal Cleanup',
      projectCode: 'ENRO-1',
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      status: 'approved',
      totalRequestedLiters: 90,
      totalApprovedLiters: 85,
      totalDispensedLiters: 80,
      preparedBy: 'Gina',
      reviewedBy: 'Arturo',
      approvedBy: 'Roberto',
      ownerId: 'u1',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 'wp_undisp',
      controlNumber: 'WP-2026-0011',
      department: 'City Engineering Office',
      projectTitle: 'Road Grading',
      projectCode: 'ENG-1',
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      status: 'partially_approved',
      totalRequestedLiters: 150,
      totalApprovedLiters: 120,
      totalDispensedLiters: 50,
      preparedBy: 'Clarissa',
      reviewedBy: 'Noel',
      approvedBy: 'Roberto',
      ownerId: 'u2',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 'wp_pending',
      controlNumber: 'WP-2026-0012',
      department: 'City Agriculture Office',
      projectTitle: 'Seed Haul',
      projectCode: 'AGRI-1',
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      status: 'pending_approval',
      totalRequestedLiters: 60,
      totalApprovedLiters: 0,
      totalDispensedLiters: 0,
      preparedBy: 'Lucia',
      reviewedBy: 'Tomas',
      approvedBy: 'Roberto',
      ownerId: 'u3',
      createdAt: '2026-11-12T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 'wp_sept',
      controlNumber: 'WP-2026-0005',
      department: 'City Health Office',
      projectTitle: 'Sept Outreach',
      projectCode: 'HLTH-1',
      weekStart: '2026-09-20',
      weekEnd: '2026-09-26',
      status: 'pending_approval',
      totalRequestedLiters: 40,
      totalApprovedLiters: 0,
      totalDispensedLiters: 0,
      preparedBy: 'Marisol',
      reviewedBy: 'Carmela',
      approvedBy: 'Roberto',
      ownerId: 'u4',
      createdAt: '2026-09-20T08:00:00Z',
      updatedAt: '2026-09-20T08:00:00Z',
    },
  ];

  const tickets: TripTicket[] = [
    {
      id: 't1',
      workPlanId: 'wp_disp_all',
      ticketNumber: '0000101',
      department: 'CENRO',
      projectTitle: 'Coastal Cleanup',
      vehicleId: 'v1',
      plateNumber: 'CEN-1',
      driverName: 'Nestor',
      fuelType: 'diesel',
      depotId: 'd1',
      scheduledDate: '2026-11-10',
      destination: 'Baywalk',
      computedLimitLiters: 50,
      requestedLiters: 50,
      approvedLiters: 50,
      dispensedLiters: 45,
      forfeitedLiters: 5,
      servedOnce: true,
      status: 'dispensed',
      ownerId: 'u1',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 't2',
      workPlanId: 'wp_disp_all',
      ticketNumber: '0000102',
      department: 'CENRO',
      projectTitle: 'Coastal Cleanup',
      vehicleId: 'v2',
      plateNumber: 'GEN-1',
      driverName: 'Luis',
      fuelType: 'gasoline',
      depotId: 'd1',
      scheduledDate: '2026-11-10',
      destination: 'Mangrove',
      computedLimitLiters: 35,
      requestedLiters: 40,
      approvedLiters: 35,
      dispensedLiters: 35,
      forfeitedLiters: 0,
      servedOnce: true,
      status: 'dispensed',
      ownerId: 'u1',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 't3',
      workPlanId: 'wp_undisp',
      ticketNumber: '0000103',
      department: 'City Engineering Office',
      projectTitle: 'Road Grading',
      vehicleId: 'v3',
      plateNumber: 'SGV-1',
      driverName: 'Ramon',
      fuelType: 'diesel',
      depotId: 'd1',
      scheduledDate: '2026-11-11',
      destination: 'Brgy. 1',
      computedLimitLiters: 60,
      requestedLiters: 60,
      approvedLiters: 50,
      dispensedLiters: 50,
      forfeitedLiters: 0,
      servedOnce: true,
      status: 'dispensed',
      ownerId: 'u2',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 't4',
      workPlanId: 'wp_undisp',
      ticketNumber: '0000104',
      department: 'City Engineering Office',
      projectTitle: 'Road Grading',
      vehicleId: 'v4',
      plateNumber: 'HEQ-1',
      driverName: 'Danilo',
      fuelType: 'diesel',
      depotId: 'd1',
      scheduledDate: '2026-11-11',
      destination: 'Brgy. 2',
      computedLimitLiters: 90,
      requestedLiters: 90,
      approvedLiters: 70,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'reduced',
      ownerId: 'u2',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 't5',
      workPlanId: 'wp_pending',
      ticketNumber: '0000105',
      department: 'City Agriculture Office',
      projectTitle: 'Seed Haul',
      vehicleId: 'v5',
      plateNumber: 'SHX-1',
      driverName: 'Elena',
      fuelType: 'diesel',
      depotId: 'd1',
      scheduledDate: '2026-11-12',
      destination: 'Upland',
      computedLimitLiters: 60,
      requestedLiters: 60,
      approvedLiters: 0,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'pending',
      ownerId: 'u3',
      createdAt: '2026-11-12T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
  ];

  // Missing mandatory Month blocks results
  const blocked = filterAndCategorizeWorkPrograms(plans, tickets, { month: '', year: '2026' });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.totalCount, 0);

  // Nov 2026 routes into all 3 folders accurately
  const nov = filterAndCategorizeWorkPrograms(plans, tickets, { month: '11', year: '2026' });
  assert.equal(nov.valid, true);
  assert.equal(nov.approvedDispensed.length, 1);
  assert.equal(nov.approvedWithUndispensed.length, 1);
  assert.equal(nov.pendingApproval.length, 1);

  const dispRow = nov.approvedDispensed[0];
  assert.equal(dispRow.workPlan.controlNumber, 'WP-2026-0010');
  assert.equal(dispRow.ticketsApprovedCount, 2);
  assert.equal(dispRow.ticketsDispensedCount, 2);
  assert.equal(dispRow.totalDieselApproved, 50);
  assert.equal(dispRow.totalDieselDispensed, 45);
  assert.equal(dispRow.totalGasApproved, 35);
  assert.equal(dispRow.totalGasDispensed, 35);

  const undispRow = nov.approvedWithUndispensed[0];
  assert.equal(undispRow.workPlan.controlNumber, 'WP-2026-0011');
  assert.equal(undispRow.ticketsApprovedCount, 2);
  assert.equal(undispRow.ticketsDispensedCount, 1);
  assert.equal(undispRow.totalDieselApproved, 120);
  assert.equal(undispRow.totalDieselDispensed, 50);
  assert.equal(undispRow.totalGasApproved, 0);
  assert.equal(undispRow.totalGasDispensed, 0);

  // Filter by Trip Ticket Status = 'reduced' narrows to WP-2026-0011 only
  const reducedOnly = filterAndCategorizeWorkPrograms(plans, tickets, {
    month: '11',
    year: '2026',
    ticketStatus: 'reduced',
  });
  assert.equal(reducedOnly.approvedDispensed.length, 0);
  assert.equal(reducedOnly.approvedWithUndispensed.length, 1);
  assert.equal(reducedOnly.pendingApproval.length, 0);

  // Filter by specific Work Plan
  const specificWp = filterAndCategorizeWorkPrograms(plans, tickets, {
    month: '11',
    year: '2026',
    workPlanId: 'wp_disp_all',
  });
  assert.equal(specificWp.totalCount, 1);
  assert.equal(specificWp.approvedDispensed[0].workPlan.controlNumber, 'WP-2026-0010');

  // Sept 2026 shows WP-2026-0005 in Pending Approval
  const sept = filterAndCategorizeWorkPrograms(plans, tickets, { month: '09', year: '2026' });
  assert.equal(sept.pendingApproval.length, 1);
  assert.equal(sept.pendingApproval[0].workPlan.controlNumber, 'WP-2026-0005');
});

test('dynamic progressive years support future work plan & trip ticket creation and filtering', () => {
  const baseYears = getDynamicProgressiveYearOptions({
    referenceYear: 2026,
    yearsAhead: 5,
    workPlans: [{ controlNumber: 'WP-2026-0001', weekStart: '2026-11-09', createdAt: '2026-11-09T08:00:00Z' }],
    tickets: [{ scheduledDate: '2026-11-12', createdAt: '2026-11-09T08:00:00Z' }],
  });
  assert.deepEqual(baseYears, ['2026', '2027', '2028', '2029', '2030', '2031']);

  // Progressive horizon expands dynamically when a later year record is added
  const expandedYears = getDynamicProgressiveYearOptions({
    referenceYear: 2026,
    yearsAhead: 5,
    workPlans: [{ controlNumber: 'WP-2030-0001', weekStart: '2030-03-10', createdAt: '2026-11-16T08:00:00Z' }],
    tickets: [{ scheduledDate: '2031-01-15', createdAt: '2026-11-16T08:00:00Z' }],
  });
  assert.ok(expandedYears.includes('2031'));
  assert.ok(expandedYears.includes('2036'));

  // Per-year sequence restarts at 0001 for progressive years without colliding with 2026 plans
  const existingPlans = [
    { controlNumber: 'WP-2026-0001' },
    { controlNumber: 'WP-2026-0002' },
    { controlNumber: 'WP-2026-0003' },
  ] as WorkPlan[];
  assert.equal(generateNextWorkPlanNumber(existingPlans, 2026), 'WP-2026-0004');
  assert.equal(generateNextWorkPlanNumber(existingPlans, 2027), 'WP-2027-0001');
  assert.equal(
    generateNextWorkPlanNumber([...existingPlans, { controlNumber: 'WP-2027-0001' } as WorkPlan], 2027),
    'WP-2027-0002'
  );

  // Date & project code shifting handles leap-day clamping and progressive year tokens
  assert.equal(shiftIsoDateToYear('2028-02-29', '2029'), '2029-02-28');
  assert.equal(shiftIsoDateToYear('2026-11-16', '2027'), '2027-11-16');
  assert.equal(addDaysIso('2027-12-28', 6), '2028-01-03');
  assert.equal(replaceYearInProjectCode('INFRA-2026-014', '2028'), 'INFRA-2028-014');

  // Work plan created in 2026 for progressive year 2027 appears under 2027 filter
  const futurePlan: WorkPlan = {
    id: 'wp_future_2027',
    controlNumber: 'WP-2027-0001',
    department: 'City Engineering Office',
    projectTitle: '2027 Road Paving',
    projectCode: 'INFRA-2027-001',
    weekStart: '2027-02-01',
    weekEnd: '2027-02-07',
    status: 'pending_approval',
    totalRequestedLiters: 40,
    totalApprovedLiters: 0,
    totalDispensedLiters: 0,
    preparedBy: 'Clarissa',
    reviewedBy: 'Noel',
    approvedBy: 'Roberto',
    ownerId: 'u1',
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };
  const futureTicket: TripTicket = {
    id: 'tt_future_2027',
    workPlanId: 'wp_future_2027',
    ticketNumber: '0000010',
    department: 'City Engineering Office',
    projectTitle: '2027 Road Paving',
    vehicleId: 'v1',
    plateNumber: 'SGV-042',
    driverName: 'Ramon',
    fuelType: 'diesel',
    depotId: 'd1',
    scheduledDate: '2027-02-02',
    destination: 'Brgy. 1',
    computedLimitLiters: 40,
    requestedLiters: 40,
    approvedLiters: 0,
    dispensedLiters: 0,
    forfeitedLiters: 0,
    servedOnce: false,
    status: 'pending',
    ownerId: 'u1',
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
  };
  const filtered2027 = filterAndCategorizeWorkPrograms([futurePlan], [futureTicket], {
    month: '02',
    year: '2027',
  });
  assert.equal(filtered2027.valid, true);
  assert.equal(filtered2027.pendingApproval.length, 1);
  assert.equal(filtered2027.pendingApproval[0].workPlan.controlNumber, 'WP-2027-0001');
});

test('All Months filter and period-scoped getWorkPlansForPeriod support month=all and empty-period detection', () => {
  assert.equal(validateWorkProgramMandatoryFilters({ month: 'all', year: '2026' }).valid, true);

  const plans: WorkPlan[] = [
    {
      id: 'wp_nov',
      controlNumber: 'WP-2026-0001',
      department: 'City Engineering Office',
      projectTitle: 'Nov Paving',
      projectCode: 'INFRA-2026-01',
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      status: 'approved',
      totalRequestedLiters: 80,
      totalApprovedLiters: 80,
      totalDispensedLiters: 0,
      preparedBy: 'Clarissa',
      reviewedBy: 'Noel',
      approvedBy: 'Roberto',
      ownerId: 'u1',
      createdAt: '2026-11-09T08:00:00Z',
      updatedAt: '2026-11-09T08:00:00Z',
    },
    {
      id: 'wp_sep',
      controlNumber: 'WP-2026-0004',
      department: 'City Health Office',
      projectTitle: 'Sept Outreach',
      projectCode: 'HLTH-2026-04',
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      status: 'pending_approval',
      totalRequestedLiters: 40,
      totalApprovedLiters: 0,
      totalDispensedLiters: 0,
      preparedBy: 'Marisol',
      reviewedBy: 'Carmela',
      approvedBy: 'Roberto',
      ownerId: 'u2',
      createdAt: '2026-09-25T08:00:00Z',
      updatedAt: '2026-09-25T08:00:00Z',
    },
  ];

  const tickets: TripTicket[] = [
    {
      id: 't_nov',
      workPlanId: 'wp_nov',
      ticketNumber: '0000001',
      department: 'City Engineering Office',
      projectTitle: 'Nov Paving',
      vehicleId: 'v1',
      plateNumber: 'SGV-042',
      driverName: 'Ramon',
      fuelType: 'diesel',
      depotId: 'd1',
      scheduledDate: '2026-11-12',
      destination: 'Brgy. 1',
      computedLimitLiters: 80,
      requestedLiters: 80,
      approvedLiters: 80,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'approved',
      ownerId: 'u1',
      createdAt: '2026-11-09T08:00:00Z',
      updatedAt: '2026-11-09T08:00:00Z',
    },
    {
      id: 't_sep',
      workPlanId: 'wp_sep',
      ticketNumber: '0000005',
      department: 'City Health Office',
      projectTitle: 'Sept Outreach',
      vehicleId: 'v2',
      plateNumber: 'SLF-210',
      driverName: 'Victorino',
      fuelType: 'diesel',
      depotId: 'd1',
      scheduledDate: '2026-09-29',
      destination: 'Brgy. Cabanlutan',
      computedLimitLiters: 40,
      requestedLiters: 40,
      approvedLiters: 0,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'pending',
      ownerId: 'u2',
      createdAt: '2026-09-25T08:00:00Z',
      updatedAt: '2026-09-25T08:00:00Z',
    },
  ];

  // All Months in 2026 returns both Sept and Nov plans
  const all2026 = filterAndCategorizeWorkPrograms(plans, tickets, { month: 'all', year: '2026' });
  assert.equal(all2026.valid, true);
  assert.equal(all2026.totalCount, 2);

  // Work plan filter options scoped strictly to selected Month + Year
  assert.deepEqual(
    getWorkPlansForPeriod(plans, tickets, { month: 'all', year: '2026' }).map((w) => w.controlNumber),
    ['WP-2026-0001', 'WP-2026-0004']
  );
  assert.deepEqual(
    getWorkPlansForPeriod(plans, tickets, { month: '09', year: '2026' }).map((w) => w.controlNumber),
    ['WP-2026-0004']
  );
  // Empty period returns 0 work plans (Preview disabled)
  assert.equal(getWorkPlansForPeriod(plans, tickets, { month: '02', year: '2026' }).length, 0);
  assert.equal(getWorkPlansForPeriod(plans, tickets, { month: 'all', year: '2027' }).length, 0);
});

test('categorizeAndFilterApprovals routes into 4 folders and strictly excludes non-matching filtered records', () => {
  const refDate = new Date('2026-11-16T00:00:00Z');
  const plans = [
    {
      id: 'wp_for_appr',
      controlNumber: 'WP-2026-0002',
      department: 'City Agriculture Office',
      weekStart: '2026-11-09',
      status: 'pending_approval',
      totalRequestedLiters: 95,
      totalApprovedLiters: 0,
      createdAt: '2026-11-12T06:45:00Z',
      updatedAt: '2026-11-12T06:45:00Z',
    },
    {
      id: 'wp_partial',
      controlNumber: 'WP-2026-0001',
      department: 'City Engineering Office',
      weekStart: '2026-11-09',
      status: 'approved',
      totalRequestedLiters: 190,
      totalApprovedLiters: 165,
      createdAt: '2026-11-09T07:30:00Z',
      updatedAt: '2026-11-12T08:15:00Z',
    },
    {
      id: 'wp_full',
      controlNumber: 'WP-2026-0003',
      department: 'CENRO',
      weekStart: '2026-11-09',
      status: 'approved',
      totalRequestedLiters: 35,
      totalApprovedLiters: 35,
      createdAt: '2026-11-11T14:00:00Z',
      updatedAt: '2026-11-12T07:10:00Z',
    },
    {
      id: 'wp_inactive',
      controlNumber: 'WP-2026-0004',
      department: 'City Health Office',
      weekStart: '2026-09-28',
      status: 'pending_approval',
      totalRequestedLiters: 48,
      totalApprovedLiters: 0,
      createdAt: '2026-09-25T08:00:00Z',
      updatedAt: '2026-09-25T08:00:00Z',
    },
  ] as WorkPlan[];

  const tickets = [
    { id: 't1', workPlanId: 'wp_partial', status: 'dispensed', requestedLiters: 75, approvedLiters: 75 },
    { id: 't2', workPlanId: 'wp_partial', status: 'reduced', requestedLiters: 115, approvedLiters: 90 },
    { id: 't3', workPlanId: 'wp_for_appr', status: 'pending', requestedLiters: 95, approvedLiters: 0 },
    { id: 't4', workPlanId: 'wp_full', status: 'approved', requestedLiters: 35, approvedLiters: 35 },
    { id: 't5', workPlanId: 'wp_inactive', status: 'pending', requestedLiters: 48, approvedLiters: 0 },
  ] as TripTicket[];

  const all = categorizeAndFilterApprovals(plans, tickets, { referenceDate: refDate });
  assert.deepEqual(all.forApproval.map((w) => w.controlNumber), ['WP-2026-0002']);
  assert.deepEqual(all.partiallyApproved.map((w) => w.controlNumber), ['WP-2026-0001']);
  assert.deepEqual(all.fullyApproved.map((w) => w.controlNumber), ['WP-2026-0003']);
  assert.deepEqual(all.inactive.map((w) => w.controlNumber), ['WP-2026-0004']);

  // Filtering by Department strictly excludes non-matching records from ALL folders
  const engOnly = categorizeAndFilterApprovals(plans, tickets, {
    department: 'City Engineering Office',
    referenceDate: refDate,
  });
  assert.equal(engOnly.forApproval.length, 0);
  assert.deepEqual(engOnly.partiallyApproved.map((w) => w.controlNumber), ['WP-2026-0001']);
  assert.equal(engOnly.fullyApproved.length, 0);
  assert.equal(engOnly.inactive.length, 0);

  // Filtering by Month = 09 strictly shows only Sept record in Inactive Folder
  const septOnly = categorizeAndFilterApprovals(plans, tickets, {
    month: '09',
    year: '2026',
    referenceDate: refDate,
  });
  assert.equal(septOnly.forApproval.length, 0);
  assert.equal(septOnly.partiallyApproved.length, 0);
  assert.equal(septOnly.fullyApproved.length, 0);
  assert.deepEqual(septOnly.inactive.map((w) => w.controlNumber), ['WP-2026-0004']);
});

test('authenticateLocalUserCredentials resolves Gmail emails and usernames across live/sandbox/seed without stale shadowing', () => {
  const seedUser: UserAccount = {
    uid: 'usr_eng',
    username: 'eng_head',
    passwordHash: hashPassword('OldPass123!'),
    email: 'Engineering.Req@Gmail.com',
    displayName: 'Clarissa Mendoza',
    role: 'department_head',
    department: 'City Engineering Office',
    positionTitle: 'City Engineer',
    canEdit: true,
    canDelete: false,
    canSwitchToLive: false,
    active: true,
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const liveUpdatedUser: UserAccount = {
    ...seedUser,
    uid: 'firebase_uid_999',
    passwordHash: hashPassword('NewGmailPass!'),
    canSwitchToLive: true,
    updatedAt: '2026-11-16T00:00:00Z',
  };

  const suspendedUser: UserAccount = {
    uid: 'usr_susp',
    username: 'suspended_gmail',
    passwordHash: hashPassword('Secret1!'),
    email: 'suspended.user@gmail.com',
    displayName: 'Suspended User',
    role: 'requester',
    department: 'CENRO',
    canEdit: false,
    canDelete: false,
    canSwitchToLive: false,
    active: false,
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  // Case-insensitive Gmail match succeeds with updated live password even when seed has older hash
  const okLive = authenticateLocalUserCredentials({
    liveUsers: [liveUpdatedUser],
    sandboxUsers: [seedUser],
    seedUsers: [seedUser],
    identifier: '  engineering.req@gmail.com  ',
    password: 'NewGmailPass!',
  });
  assert.equal(okLive.ok, true);
  assert.equal(okLive.user?.uid, 'firebase_uid_999');
  assert.equal(okLive.user?.canSwitchToLive, true);

  // Username login also works
  const okUsername = authenticateLocalUserCredentials({
    liveUsers: [liveUpdatedUser],
    sandboxUsers: [seedUser],
    identifier: 'ENG_HEAD',
    password: 'NewGmailPass!',
  });
  assert.equal(okUsername.ok, true);
  assert.equal(okUsername.user?.uid, 'firebase_uid_999');

  // Suspended account rejected cleanly
  const suspended = authenticateLocalUserCredentials({
    liveUsers: [suspendedUser],
    identifier: 'suspended.user@gmail.com',
    password: 'Secret1!',
  });
  assert.equal(suspended.ok, false);
  assert.match(suspended.error ?? '', /suspended/i);

  // Unknown Gmail guides user to Google Sign-In
  const missing = authenticateLocalUserCredentials({
    liveUsers: [liveUpdatedUser],
    identifier: 'another.gmail@gmail.com',
    password: 'AnyPassword1!',
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? '', /Sign In with Google/i);
});

test('mergeClaimedUserProfile & deduplicateUsersByEmail handle invite claiming, self-registration, and UID deduplication', () => {
  assert.equal(normalizeEmailToId('User.Name+01@Gmail.COM'), 'user_name_01_gmail_com');
  assert.deepEqual(stripUndefinedFields({ a: 1, b: undefined, c: 'ok' }), { a: 1, c: 'ok' });

  // 1. Admin-invited different Gmail claims assigned role, department, and permissions into Firebase Auth UID
  const claimed = mergeClaimedUserProfile({
    uid: 'fb_uid_12345',
    email: 'MayorApprover@Gmail.com',
    displayName: 'Roberto',
    sourceProfile: {
      username: 'mayor_approver',
      passwordHash: hashPassword('Pass123!'),
      role: 'approver',
      department: 'Office of the City Mayor',
      positionTitle: 'City Administrator',
      canEdit: true,
      canDelete: false,
      canSwitchToLive: true,
      active: true,
    },
    nowIso: '2026-11-16T08:00:00Z',
  });
  assert.equal(claimed.uid, 'fb_uid_12345');
  assert.equal(claimed.email, 'mayorapprover@gmail.com');
  assert.equal(claimed.role, 'approver');
  assert.equal(claimed.department, 'Office of the City Mayor');
  assert.equal(claimed.canSwitchToLive, true);
  assert.equal(claimed.active, true);

  // 2. Uninvited Gmail user safely self-registers as unprivileged requester
  const selfReg = mergeClaimedUserProfile({
    uid: 'fb_uid_uninvited',
    email: 'field.staff@gmail.com',
    displayName: 'Field Staff',
    sourceProfile: null,
    nowIso: '2026-11-16T08:00:00Z',
  });
  assert.equal(selfReg.uid, 'fb_uid_uninvited');
  assert.equal(selfReg.role, 'requester');
  assert.equal(selfReg.canEdit, false);
  assert.equal(selfReg.canDelete, false);
  assert.equal(selfReg.canSwitchToLive, false);
  assert.equal(selfReg.createdBy, 'self');

  // 3. Deduplication prefers real Firebase UID over email-derived placeholder document
  const placeholder: UserAccount = {
    ...claimed,
    uid: normalizeEmailToId('MayorApprover@Gmail.com'),
    updatedAt: '2026-11-16T09:00:00Z',
  };
  const deduped = deduplicateUsersByEmail([placeholder, claimed]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].uid, 'fb_uid_12345');
});

test('buildInvitePayloadFromUser and prepareFirestoreRecordPayload sanitize user, audit, and transaction payloads', () => {
  const user: UserAccount = {
    uid: 'usr_gso_1',
    username: '  GSO_Head_Test ',
    passwordHash: hashPassword('Secret123!'),
    email: '  GSO.Test@Gmail.com ',
    displayName: '  Engr. Mario Santos  ',
    role: 'gso_head',
    department: 'General Services Office (GSO)',
    positionTitle: undefined,
    canEdit: true,
    canDelete: false,
    canSwitchToLive: true,
    active: true,
    createdBy: 'seed_admin_1',
    createdAt: '2026-11-16T08:00:00Z',
    updatedAt: '2026-11-16T08:00:00Z',
  };

  const invite = buildInvitePayloadFromUser(user, 'fb_admin_uid');
  assert.ok(invite);
  assert.equal(invite.id, 'gso_test_gmail_com');
  assert.equal(invite.email, 'gso.test@gmail.com');
  assert.equal(invite.username, 'gso_head_test');
  assert.equal(invite.canEdit, true);
  assert.equal(invite.canDelete, false);
  assert.equal(invite.canSwitchToLive, true);

  // Admin role always enforces edit/delete/live permissions
  const adminInvite = buildInvitePayloadFromUser(
    { ...user, role: 'admin', canEdit: false, canDelete: false, canSwitchToLive: false },
    'fb_admin_uid'
  );
  assert.equal(adminInvite?.canEdit, true);
  assert.equal(adminInvite?.canDelete, true);
  assert.equal(adminInvite?.canSwitchToLive, true);

  // Short username stripped cleanly to satisfy rules (>= 2 chars)
  const sanitizedUser = prepareFirestoreRecordPayload(
    { ...user, username: 'a' } as unknown as Record<string, unknown>,
    'fb_admin_uid',
    { isCreate: true, collection: 'users' }
  );
  assert.equal('username' in sanitizedUser, false);
  assert.equal(sanitizedUser.email, 'gso.test@gmail.com');

  // WorkPlan create normalizes ownerId to firebaseUid; update preserves provided fields
  const wpCreate = prepareFirestoreRecordPayload(
    { id: 'wp_1', ownerId: 'seed_admin_1', status: 'approved' },
    'fb_admin_uid',
    { isCreate: true, collection: 'workPlans' }
  );
  assert.equal(wpCreate.ownerId, 'fb_admin_uid');

  const wpUpdate = prepareFirestoreRecordPayload(
    { ownerId: 'seed_admin_1', status: 'completed' },
    'fb_admin_uid',
    { isCreate: false, collection: 'workPlans' }
  );
  assert.equal(wpUpdate.ownerId, 'seed_admin_1');

  // Audit log create normalizes actorUid and clamps summary
  const audCreate = prepareFirestoreRecordPayload(
    { id: 'aud_1', actorUid: 'seed_admin_1', summary: 'x' },
    'fb_admin_uid',
    { isCreate: true, collection: 'auditLogs' }
  );
  assert.equal(audCreate.actorUid, 'fb_admin_uid');
  assert.equal(audCreate.summary, 'Audit entry');
});

test('reconcileCollectionRecords merges AI Studio local records with cloud while respecting purges and untouched seeds', () => {
  type Rec = { id: string; label: string; createdAt?: string; updatedAt?: string };
  const seedTs = new Map<string, string>([['seed_1', '2026-11-09T08:00:00Z']]);

  const localItems: Rec[] = [
    // Untouched seed item deleted in cloud -> should NOT be resurrected when cloud has records
    { id: 'seed_1', label: 'Seed Baseline', updatedAt: '2026-11-09T08:00:00Z' },
    // Pre-purge local item -> should NOT be pushed after cloudPurgeAt
    { id: 'old_local', label: 'Pre-Purge Local', updatedAt: '2026-11-10T08:00:00Z' },
    // New local AI Studio transaction created after purge -> MUST be created in cloud
    { id: 'new_local', label: 'AI Studio New TX', updatedAt: '2026-11-16T10:00:00Z' },
    // Modified locally more recently than cloud -> MUST update cloud
    { id: 'shared_1', label: 'Updated Locally', updatedAt: '2026-11-16T12:00:00Z' },
    // Older locally than cloud -> Cloud wins
    { id: 'shared_2', label: 'Stale Local', updatedAt: '2026-11-14T08:00:00Z' },
  ];

  const cloudItems: Rec[] = [
    { id: 'shared_1', label: 'Older Cloud', updatedAt: '2026-11-15T08:00:00Z' },
    { id: 'shared_2', label: 'Newer Cloud', updatedAt: '2026-11-16T11:00:00Z' },
    { id: 'cloud_only', label: 'Deployed App TX', updatedAt: '2026-11-16T09:00:00Z' },
  ];

  const rec = reconcileCollectionRecords({
    localItems,
    cloudItems,
    keyField: 'id',
    cloudPurgeAt: '2026-11-12T00:00:00Z',
    seedUpdatedAtByKey: seedTs,
  });

  assert.deepEqual(rec.toCreate.map((r) => r.id), ['new_local']);
  assert.deepEqual(rec.toUpdate.map((r) => r.id), ['shared_1']);

  const mergedById = new Map(rec.merged.map((r) => [r.id, r]));
  assert.equal(mergedById.has('seed_1'), false);
  assert.equal(mergedById.has('old_local'), false);
  assert.equal(mergedById.get('new_local')?.label, 'AI Studio New TX');
  assert.equal(mergedById.get('shared_1')?.label, 'Updated Locally');
  assert.equal(mergedById.get('shared_2')?.label, 'Newer Cloud');
  assert.equal(mergedById.get('cloud_only')?.label, 'Deployed App TX');
});

test('resolveEffectiveEnvironmentAfterGoogleAuth keeps Sandbox when linking for sync and enforces live permissions otherwise', () => {
  assert.equal(
    resolveEffectiveEnvironmentAfterGoogleAuth({
      preserveEnvMode: 'sandbox',
      user: { role: 'admin', canSwitchToLive: true },
    }),
    'sandbox'
  );
  assert.equal(
    resolveEffectiveEnvironmentAfterGoogleAuth({
      preserveEnvMode: null,
      user: { role: 'admin', canSwitchToLive: true },
    }),
    'live'
  );
  assert.equal(
    resolveEffectiveEnvironmentAfterGoogleAuth({
      preserveEnvMode: 'live',
      user: { role: 'requester', canSwitchToLive: false },
    }),
    'sandbox'
  );
  assert.equal(
    resolveEffectiveEnvironmentAfterGoogleAuth({
      preserveEnvMode: null,
      user: { role: 'approver', canSwitchToLive: true },
    }),
    'live'
  );
});

test('computeCredentialProofId and buildCredentialLoginPayloadsFromUser produce proof-keyed docs without passwordHash and strip leading @', () => {
  const passHash = hashPassword('BaisTest2026!');
  const proofPlain = computeCredentialProofId('jdelacruz', passHash);
  const proofWithAt = computeCredentialProofId('  @JDelaCruz  ', passHash);
  const proofEmail = computeCredentialProofId('juan.delacruz@baiscity.gov.ph', passHash);
  const proofWrongPass = computeCredentialProofId('jdelacruz', hashPassword('WrongPass'));

  assert.match(proofPlain, /^[a-f0-9]{64}$/);
  assert.equal(proofPlain, proofWithAt);
  assert.notEqual(proofPlain, proofEmail);
  assert.notEqual(proofPlain, proofWrongPass);

  const user: UserAccount = {
    uid: 'juan_delacruz_baiscity_gov_ph',
    username: '@JDelaCruz',
    passwordHash: passHash,
    email: 'Juan.DelaCruz@baiscity.gov.ph',
    displayName: 'Juan Dela Cruz',
    role: 'department_head',
    department: 'City Engineering Office',
    positionTitle: 'Division Head',
    canEdit: true,
    canDelete: false,
    canSwitchToLive: false,
    active: true,
    createdBy: 'fb_admin_uid',
    createdAt: '2026-11-17T00:00:00Z',
    updatedAt: '2026-11-17T00:00:00Z',
  };

  const payloads = buildCredentialLoginPayloadsFromUser(user, 'fb_admin_uid');
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].id, proofPlain);
  assert.equal(payloads[1].id, proofEmail);
  for (const p of payloads) {
    assert.equal('passwordHash' in p, false);
    assert.equal(p.username, 'jdelacruz');
    assert.equal(p.email, 'juan.delacruz@baiscity.gov.ph');
    assert.equal(p.role, 'department_head');
    assert.equal(p.active, true);
  }

  // Leading @ accepted by authenticateLocalUserCredentials
  const authAt = authenticateLocalUserCredentials({
    sandboxUsers: [user],
    identifier: '@jdelacruz',
    password: 'BaisTest2026!',
  });
  assert.equal(authAt.ok, true);
  assert.equal(authAt.user?.uid, 'juan_delacruz_baiscity_gov_ph');

  // Deduplication preserves username & passwordHash when real Firebase UID lacks them
  const placeholderWithPass: UserAccount = { ...user, username: 'jdelacruz' };
  const fbDocWithoutPass: UserAccount = {
    ...user,
    uid: 'fb_uid_juan',
    username: undefined,
    passwordHash: undefined,
  };
  const deduped = deduplicateUsersByEmail([placeholderWithPass, fbDocWithoutPass]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].uid, 'fb_uid_juan');
  assert.equal(deduped[0].username, 'jdelacruz');
  assert.equal(deduped[0].passwordHash, passHash);
});

test('generateNextGsoTransactionCode assigns distinct sequenced 7-alphanumeric codes per transaction type', () => {
  assert.equal(getGsoTransactionPrefix('dispense'), 'DS');
  assert.equal(getGsoTransactionPrefix('delivery'), 'DL');
  assert.equal(getGsoTransactionPrefix('overage_adjustment'), 'OV');
  assert.equal(getGsoTransactionPrefix('shrinkage_adjustment'), 'SH');

  const existingLogs: Array<Pick<InventoryLog, 'gsoTransactionCode'>> = [
    { gsoTransactionCode: 'DL00001' },
    { gsoTransactionCode: 'SH00001' },
    { gsoTransactionCode: 'SH00003' },
  ];
  const existingTickets: Array<Pick<TripTicket, 'gsoTransactionCode'>> = [
    { gsoTransactionCode: 'DS00001' },
    { gsoTransactionCode: 'DS00002' },
  ];

  const nextDisp = generateNextGsoTransactionCode('dispense', existingLogs, existingTickets);
  const nextDel = generateNextGsoTransactionCode('delivery', existingLogs, existingTickets);
  const nextOvr = generateNextGsoTransactionCode('overage_adjustment', existingLogs, existingTickets);
  const nextShr = generateNextGsoTransactionCode('shrinkage_adjustment', existingLogs, existingTickets);

  assert.match(nextDisp, /^[A-Z0-9]{7}$/);
  assert.match(nextDel, /^[A-Z0-9]{7}$/);
  assert.match(nextOvr, /^[A-Z0-9]{7}$/);
  assert.match(nextShr, /^[A-Z0-9]{7}$/);

  assert.equal(nextDisp, 'DS00003');
  assert.equal(nextDel, 'DL00002');
  assert.equal(nextOvr, 'OV00001');
  assert.equal(nextShr, 'SH00004');
  assert.equal(new Set([nextDisp, nextDel, nextOvr, nextShr]).size, 4);
});

test('Depot Inventory log filtering, reference columns, and blue/green/red color coding behave accurately', () => {
  const logs: InventoryLog[] = [
    {
      id: 'l_del',
      depotId: 'depot_gso_central',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 8000,
      balanceBefore: 10000,
      balanceAfter: 18000,
      gsoTransactionCode: 'DL00001',
      referenceNumber: 'DR-2026-001',
      approvalStatus: 'verified',
      ownerId: 'u1',
      createdAt: '2026-11-11T10:15:00Z',
    },
    {
      id: 'l_disp',
      depotId: 'depot_gso_central',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'diesel',
      transactionType: 'dispense',
      litersDelta: -60,
      balanceBefore: 18000,
      balanceAfter: 17940,
      gsoTransactionCode: 'DS00001',
      tripTicketNumber: '0000001',
      referenceNumber: '0000001',
      approvalStatus: 'verified',
      ownerId: 'u1',
      createdAt: '2026-11-12T08:15:00Z',
    },
    {
      id: 'l_ovr',
      depotId: 'depot_motorpool_talungon',
      depotName: 'Motorpool Annex Depot',
      fuelType: 'gasoline',
      transactionType: 'overage_adjustment',
      litersDelta: 25,
      balanceBefore: 1800,
      balanceAfter: 1825,
      gsoTransactionCode: 'OV00001',
      referenceNumber: 'DIP-OVR-2026-01',
      approvalStatus: 'verified',
      ownerId: 'u1',
      createdAt: '2026-12-03T09:00:00Z',
    },
    {
      id: 'l_shr',
      depotId: 'depot_motorpool_talungon',
      depotName: 'Motorpool Annex Depot',
      fuelType: 'gasoline',
      transactionType: 'shrinkage_adjustment',
      litersDelta: -42,
      balanceBefore: 1825,
      balanceAfter: 1783,
      gsoTransactionCode: 'SH00001',
      referenceNumber: 'DIP-SHG-2027-01',
      approvalStatus: 'pending_gso_approval',
      ownerId: 'u1',
      createdAt: '2027-01-05T07:30:00Z',
    },
  ];

  // Deliveries are blue; overage additions are green; dispense/shortage deductions are red
  assert.equal(getInventoryDeltaTone(logs[0]), 'delivery');
  assert.equal(getInventoryDeltaColorClass(logs[0]), 'text-blue-700');

  assert.equal(getInventoryDeltaTone(logs[2]), 'addition');
  assert.equal(getInventoryDeltaColorClass(logs[2]), 'text-emerald-700');

  assert.equal(getInventoryDeltaTone(logs[1]), 'deduction');
  assert.equal(getInventoryDeltaColorClass(logs[1]), 'text-red-700');

  assert.equal(getInventoryDeltaTone(logs[3]), 'deduction');
  assert.equal(getInventoryDeltaColorClass(logs[3]), 'text-red-700');

  // Separated Trip Ticket Number vs Reference columns
  assert.deepEqual(resolveInventoryLogDisplayRefs(logs[1]), {
    tripTicketNumber: '0000001',
    referenceText: '—',
  });
  assert.deepEqual(resolveInventoryLogDisplayRefs(logs[0]), {
    tripTicketNumber: '—',
    referenceText: 'DR-2026-001',
  });
  assert.deepEqual(resolveInventoryLogDisplayRefs(logs[2]), {
    tripTicketNumber: '—',
    referenceText: 'DIP-OVR-2026-01',
  });

  // Filters: Month, Year, Fuel Type, Depot Area + newest first sorting
  const allSorted = filterDepotInventoryLogs(logs);
  assert.deepEqual(allSorted.map((l) => l.id), ['l_shr', 'l_ovr', 'l_disp', 'l_del']);

  const novDieselCentral = filterDepotInventoryLogs(logs, {
    month: '11',
    year: '2026',
    fuelType: 'diesel',
    depotId: 'depot_gso_central',
  });
  assert.deepEqual(novDieselCentral.map((l) => l.id), ['l_disp', 'l_del']);

  const year2027 = filterDepotInventoryLogs(logs, { year: '2027' });
  assert.deepEqual(year2027.map((l) => l.id), ['l_shr']);

  const gasAnnex = filterDepotInventoryLogs(logs, {
    fuelType: 'gasoline',
    depotId: 'depot_motorpool_talungon',
  });
  assert.deepEqual(gasAnnex.map((l) => l.id), ['l_shr', 'l_ovr']);

  const years = getDynamicProgressiveYearOptions({ inventoryLogs: logs, referenceYear: 2026 });
  assert.ok(years.includes('2027'));
});

test('Dipstick evaluation computes variance and assigns blue for overage and red for shortage', () => {
  // Adjustment: Dipstick above book stock => Overage (Blue)
  const formOverage = evaluateDipstickReading({
    bookStockLiters: 21850,
    transactionType: 'overage_adjustment',
    litersAmount: 50,
    dipstickLiters: 21900,
  });
  assert.equal(formOverage.status, 'overage');
  assert.equal(formOverage.varianceLiters, 50);
  assert.equal(formOverage.expectedBookLiters, 21850);
  assert.ok(formOverage.textClass.includes('blue'));
  assert.ok(formOverage.badgeClass.includes('blue'));

  // Adjustment: Dipstick below book stock => Shortage (Red)
  const formShortage = evaluateDipstickReading({
    bookStockLiters: 1882,
    transactionType: 'shrinkage_adjustment',
    litersAmount: 42,
    dipstickLiters: 1840,
  });
  assert.equal(formShortage.status, 'shortage');
  assert.equal(formShortage.varianceLiters, -42);
  assert.ok(formShortage.textClass.includes('red'));
  assert.ok(formShortage.badgeClass.includes('red'));

  // Delivery: Dipstick compared against book + delivered liters
  const deliveryOverage = evaluateDipstickReading({
    bookStockLiters: 10000,
    transactionType: 'delivery',
    litersAmount: 5000,
    dipstickLiters: 15025,
  });
  assert.equal(deliveryOverage.status, 'overage');
  assert.equal(deliveryOverage.expectedBookLiters, 15000);
  assert.equal(deliveryOverage.varianceLiters, 25);

  const deliveryShortage = evaluateDipstickReading({
    bookStockLiters: 10000,
    transactionType: 'delivery',
    litersAmount: 5000,
    dipstickLiters: 14970,
  });
  assert.equal(deliveryShortage.status, 'shortage');
  assert.equal(deliveryShortage.varianceLiters, -30);

  // Saved logs evaluation
  const logShortage = evaluateInventoryLogDipstick({
    transactionType: 'shrinkage_adjustment',
    balanceBefore: 1882,
    litersDelta: -42,
    physicalDipLiters: 1840,
  });
  assert.equal(logShortage?.status, 'shortage');
  assert.equal(logShortage?.varianceLiters, -42);
  assert.ok(logShortage?.badgeClass.includes('red'));

  const logOverage = evaluateInventoryLogDipstick({
    transactionType: 'overage_adjustment',
    balanceBefore: 1840,
    litersDelta: 35,
    physicalDipLiters: 1875,
  });
  assert.equal(logOverage?.status, 'overage');
  assert.equal(logOverage?.varianceLiters, 35);
  assert.ok(logOverage?.badgeClass.includes('blue'));

  const logDeliveryMatched = evaluateInventoryLogDipstick({
    transactionType: 'delivery',
    balanceBefore: 13910,
    litersDelta: 8000,
    physicalDipLiters: 21910,
  });
  assert.equal(logDeliveryMatched?.status, 'matched');
  assert.equal(logDeliveryMatched?.varianceLiters, 0);

  assert.equal(
    evaluateInventoryLogDipstick({
      transactionType: 'dispense',
      balanceBefore: 21910,
      litersDelta: -60,
      physicalDipLiters: undefined,
    }),
    null
  );
});

test('resolveTopEscapeHandlerId closes topmost priority layer first and breaks ties by latest order', () => {
  assert.equal(resolveTopEscapeHandlerId([]), null);

  // Full record preview (priority 1) alone closes itself
  assert.equal(
    resolveTopEscapeHandlerId([{ id: 'workplan-full-review', priority: 1, order: 1 }]),
    'workplan-full-review'
  );

  // 4-tier stack: Floating table preview (1) < Full record review (2) < Sub-modal (3) < PDF preview (4)
  assert.equal(
    resolveTopEscapeHandlerId([
      { id: 'floating-table-preview', priority: 1, order: 1 },
      { id: 'workplan-full-review', priority: 2, order: 2 },
    ]),
    'workplan-full-review'
  );

  assert.equal(
    resolveTopEscapeHandlerId([
      { id: 'floating-table-preview', priority: 1, order: 1 },
      { id: 'workplan-full-review', priority: 2, order: 2 },
      { id: 'edit-modal', priority: 3, order: 3 },
      { id: 'pdf-preview', priority: 4, order: 4 },
    ]),
    'pdf-preview'
  );

  // Equal priority breaks tie by most recently opened (highest order)
  assert.equal(
    resolveTopEscapeHandlerId([
      { id: 'modal-a', priority: 3, order: 4 },
      { id: 'modal-b', priority: 3, order: 7 },
    ]),
    'modal-b'
  );
});

test('prepareFirestoreRecordPayload trims projectAip on tripTickets and strips empty projectAip', () => {
  const cleanedWithAip = prepareFirestoreRecordPayload(
    {
      id: 'tt_1',
      projectAip: '  AIP-2026-09  ',
      ownerId: 'old',
    },
    'uid_123',
    { isCreate: true, collection: 'tripTickets' }
  );
  assert.equal(cleanedWithAip.projectAip, 'AIP-2026-09');
  assert.equal(cleanedWithAip.ownerId, 'uid_123');

  const cleanedEmptyAip = prepareFirestoreRecordPayload(
    {
      id: 'tt_2',
      projectAip: '   ',
      ownerId: 'old',
    },
    'uid_123',
    { isCreate: true, collection: 'tripTickets' }
  );
  assert.equal('projectAip' in cleanedEmptyAip, false);
});

test('getVehicleFuelTypeFromRegistry retrieves fuel grade from Fleet Registry once a vehicle is chosen', () => {
  const fleet = [
    { id: 'veh_1', fuelType: 'diesel' },
    { id: 'veh_2', fuelType: 'gasoline' },
  ] as FleetVehicle[];

  assert.equal(getVehicleFuelTypeFromRegistry(fleet, ''), '');
  assert.equal(getVehicleFuelTypeFromRegistry(fleet, 'unknown_id'), '');
  assert.equal(getVehicleFuelTypeFromRegistry(fleet, 'veh_1'), 'DIESEL');
  assert.equal(getVehicleFuelTypeFromRegistry(fleet, 'veh_2'), 'GASOLINE');
});

test('isAipCodeMandatory exempts ONLY requester role under City Mayors Office', () => {
  assert.equal(isAipCodeMandatory('requester', "City Mayor's Office"), false);
  assert.equal(isAipCodeMandatory('requester', "  city mayors   office "), false);
  assert.equal(isAipCodeMandatory('requester', 'City Engineering Office'), true);
  assert.equal(isAipCodeMandatory('admin', "City Mayor's Office"), true);
  assert.equal(isAipCodeMandatory('department_head', "City Mayor's Office"), true);
  assert.equal(isAipCodeMandatory('approver', "City Mayor's Office"), true);

  const baseTicket = {
    vehicleId: 'v1',
    driverName: 'Juan Dela Cruz',
    depotId: 'd1',
    purposeOrProject: 'Official dispatch',
    projectAip: '',
    destination: 'City Hall',
    scheduledDate: '2026-11-18',
    requestedLiters: 25,
  };

  assert.deepEqual(
    getMissingTicketMandatoryFields(baseTicket, {
      aipCodeMandatory: isAipCodeMandatory('requester', "City Mayor's Office"),
    }),
    []
  );
  assert.deepEqual(
    getMissingTicketMandatoryFields(baseTicket, {
      aipCodeMandatory: isAipCodeMandatory('admin', "City Mayor's Office"),
    }),
    ['projectAip']
  );
  assert.deepEqual(
    getMissingTicketMandatoryFields(baseTicket, {
      aipCodeMandatory: isAipCodeMandatory('requester', 'City Engineering Office'),
    }),
    ['projectAip']
  );
});

test('evaluateSingleTripTicketWindow enforces strictly < 3 days from pre-assigned preparationDate', () => {
  const prep = '2026-11-18';
  const sameDay = evaluateSingleTripTicketWindow(prep, '2026-11-18');
  assert.equal(sameDay.allowed, true);
  assert.equal(sameDay.daysFromPreparation, 0);
  assert.equal(sameDay.maxAllowedDate, '2026-11-20');

  const plusOne = evaluateSingleTripTicketWindow(prep, '2026-11-19');
  assert.equal(plusOne.allowed, true);
  assert.equal(plusOne.daysFromPreparation, 1);

  const plusTwo = evaluateSingleTripTicketWindow(prep, '2026-11-20');
  assert.equal(plusTwo.allowed, true);
  assert.equal(plusTwo.daysFromPreparation, 2);

  const plusThreeBlocked = evaluateSingleTripTicketWindow(prep, '2026-11-21');
  assert.equal(plusThreeBlocked.allowed, false);
  assert.equal(plusThreeBlocked.daysFromPreparation, 3);
  assert.ok(plusThreeBlocked.reason?.includes('less than 3 days'));

  const pastBlocked = evaluateSingleTripTicketWindow(prep, '2026-11-17');
  assert.equal(pastBlocked.allowed, false);
  assert.equal(pastBlocked.daysFromPreparation, -1);

  assert.match(getLocalIsoDate(new Date(2026, 10, 5, 14, 30)), /^2026-11-05$/);
});

test('requiresWorkPlanSignOffs and shouldDisplayWorkPlanSignOffs exempt single_trip from mandatory sign-offs and designations', () => {
  assert.equal(requiresWorkPlanSignOffs('single_trip'), false);
  assert.equal(requiresWorkPlanSignOffs('weekly_work_plan'), true);
  assert.equal(requiresWorkPlanSignOffs(undefined), true);

  assert.equal(
    shouldDisplayWorkPlanSignOffs({
      requestType: 'single_trip',
      preparedBy: '',
      reviewedBy: '',
      approvedBy: '',
    }),
    false
  );
  assert.equal(
    shouldDisplayWorkPlanSignOffs({
      requestType: 'single_trip',
      preparedBy: 'Legacy Name',
      reviewedBy: 'Legacy Reviewer',
      approvedBy: 'Legacy Approver',
    }),
    false
  );
  assert.equal(
    shouldDisplayWorkPlanSignOffs({
      requestType: 'weekly_work_plan',
      preparedBy: 'Clarissa',
      reviewedBy: 'Noel',
      approvedBy: 'Roberto',
    }),
    true
  );
  assert.equal(
    shouldDisplayWorkPlanSignOffs({
      requestType: undefined,
      preparedBy: 'Clarissa',
      reviewedBy: 'Noel',
      approvedBy: 'Roberto',
    }),
    true
  );
});

test('shouldShowWorkPlanNumberField hides WP Request No in single_trip form and shows it in weekly_work_plan', () => {
  assert.equal(shouldShowWorkPlanNumberField('single_trip'), false);
  assert.equal(shouldShowWorkPlanNumberField('weekly_work_plan'), true);
  assert.equal(shouldShowWorkPlanNumberField(undefined), true);
});

test('canUserRequestSingleTrip and canUserEditWorkPlanRecord enforce RBAC Single Trip permission and preclude edit when deactivated', () => {
  assert.equal(canUserRequestSingleTrip({ role: 'admin', canRequestSingleTrip: false }), true);
  assert.equal(canUserRequestSingleTrip({ role: 'requester', canRequestSingleTrip: true }), true);
  assert.equal(canUserRequestSingleTrip({ role: 'requester', canRequestSingleTrip: false }), false);
  assert.equal(canUserRequestSingleTrip({ role: 'department_head', canRequestSingleTrip: undefined }), false);

  // Weekly work plan edits depend only on canEdit
  assert.equal(
    canUserEditWorkPlanRecord(
      { role: 'department_head', canEdit: true, canRequestSingleTrip: false },
      { requestType: 'weekly_work_plan' }
    ),
    true
  );

  // Single trip ticket edits require BOTH canEdit and active canRequestSingleTrip
  assert.equal(
    canUserEditWorkPlanRecord(
      { role: 'department_head', canEdit: true, canRequestSingleTrip: true },
      { requestType: 'single_trip' }
    ),
    true
  );
  assert.equal(
    canUserEditWorkPlanRecord(
      { role: 'department_head', canEdit: true, canRequestSingleTrip: false },
      { requestType: 'single_trip' }
    ),
    false
  );
  assert.equal(
    canUserEditWorkPlanRecord(
      { role: 'requester', canEdit: false, canRequestSingleTrip: true },
      { requestType: 'single_trip' }
    ),
    false
  );
  assert.equal(
    canUserEditWorkPlanRecord(
      { role: 'admin', canEdit: false, canRequestSingleTrip: false },
      { requestType: 'single_trip' }
    ),
    true
  );
});

test('formatWorkPlanPreparedTimestamp and vehicle classification helpers resolve Date Prepared timestamp and Fleet Registry classes', () => {
  const withCreatedOnly = formatWorkPlanPreparedTimestamp({
    createdAt: '2026-11-12T06:45:00Z',
  });
  assert.match(withCreatedOnly, /2026/);
  assert.match(withCreatedOnly, /\d{1,2}:\d{2}/);

  const withPrepAndCreated = formatWorkPlanPreparedTimestamp({
    preparationDate: '2026-11-18',
    createdAt: '2026-11-12T06:45:00Z',
  });
  assert.match(withPrepAndCreated, /Nov 18, 2026/);
  assert.match(withPrepAndCreated, /\d{1,2}:\d{2}/);

  const withPrepOnly = formatWorkPlanPreparedTimestamp({
    preparationDate: '2026-11-20',
    createdAt: '',
  });
  assert.match(withPrepOnly, /Nov 20, 2026/);

  const registry = [
    { id: 'veh_1', plateNumber: 'SGV-042', equipmentClass: 'dump_truck' as const },
    { id: 'veh_2', plateNumber: 'HEQ-011', equipmentClass: 'heavy_equipment' as const },
    { id: 'veh_3', plateNumber: 'BDR-911', equipmentClass: 'emergency_rescue' as const },
  ];

  // Match by vehicleId
  assert.equal(
    getVehicleClassificationLabel(registry, { vehicleId: 'veh_1', plateNumber: 'SGV-042' }),
    'Dump Truck (6W / 10W)'
  );
  // Fallback match by normalized plateNumber when vehicleId is stale/missing
  assert.equal(
    getVehicleClassificationLabel(registry, { vehicleId: '', plateNumber: ' heq-011 ' }),
    'Heavy Equipment (Backhoe / Grader / Loader)'
  );
  // Unknown vehicle falls back safely
  assert.equal(
    getVehicleClassificationLabel(registry, { vehicleId: 'missing', plateNumber: 'XXX-000' }),
    'Unclassified'
  );

  // Deduplicated, ordered classifications across work plan tickets
  const classes = getWorkPlanVehicleClassifications(
    [
      { vehicleId: 'veh_1', plateNumber: 'SGV-042' },
      { vehicleId: 'veh_2', plateNumber: 'HEQ-011' },
      { vehicleId: 'veh_1', plateNumber: 'SGV-042' },
      { vehicleId: '', plateNumber: 'BDR-911' },
    ],
    registry
  );
  assert.deepEqual(classes, [
    'Dump Truck (6W / 10W)',
    'Heavy Equipment (Backhoe / Grader / Loader)',
    'Emergency / Ambulance / Fire Truck',
  ]);
});

test('evaluateWorkPlanWeekStart blocks dates before preparationDate and allows forward-only scheduling', () => {
  const prep = '2026-11-18';

  const past = evaluateWorkPlanWeekStart(prep, '2026-11-17');
  assert.equal(past.allowed, false);
  assert.equal(past.minAllowedDate, prep);
  assert.ok(past.reason?.includes('cannot be earlier than Preparation Date'));

  const sameDay = evaluateWorkPlanWeekStart(prep, '2026-11-18');
  assert.equal(sameDay.allowed, true);
  assert.equal(sameDay.minAllowedDate, prep);

  const future = evaluateWorkPlanWeekStart(prep, '2026-11-25');
  assert.equal(future.allowed, true);

  const empty = evaluateWorkPlanWeekStart(prep, '');
  assert.equal(empty.allowed, false);
});

test('Single Trip Ticket omits prerequisite WP number and displays only Single Request Ticket across previews', () => {
  assert.equal(SINGLE_REQUEST_TICKET_LABEL, 'Single Request Ticket');

  // Newly created single_trip with empty controlNumber
  assert.equal(
    getWorkPlanDisplayLabel({ requestType: 'single_trip', controlNumber: '' }),
    'Single Request Ticket'
  );
  // Legacy single_trip record that had an old WP number still displays Single Request Ticket
  assert.equal(
    getWorkPlanDisplayLabel({ requestType: 'single_trip', controlNumber: 'WP-2026-0099' }),
    'Single Request Ticket'
  );
  // Weekly work plan keeps its WP control number
  assert.equal(
    getWorkPlanDisplayLabel({ requestType: 'weekly_work_plan', controlNumber: 'WP-2026-0005' }),
    'WP-2026-0005'
  );

  // Single trip records without WP numbers do not consume the sequential WP-YYYY-NNNN sequence
  const plans: WorkPlan[] = [
    { controlNumber: 'WP-2026-0001', requestType: 'weekly_work_plan' } as WorkPlan,
    { controlNumber: '', requestType: 'single_trip' } as WorkPlan,
    { controlNumber: '', requestType: 'single_trip' } as WorkPlan,
  ];
  assert.equal(generateNextWorkPlanNumber(plans, 2026), 'WP-2026-0002');

  // Dispensing lookup maps single_trip tickets to 'Single Request Ticket'
  const disp = categorizeAndFilterDispensingTickets(
    [
      {
        id: 't_single',
        workPlanId: 'wp_single',
        ticketNumber: '0000099',
        department: 'City Engineering Office',
        projectTitle: 'Urgent Repair',
        plateNumber: 'SGV-042',
        driverName: 'Juan Dela Cruz',
        fuelType: 'diesel',
        destination: 'Brgy. 1',
        status: 'approved',
        approvedLiters: 40,
        dispensedLiters: 0,
        servedOnce: false,
        createdAt: '2026-11-18T09:00:00Z',
      } as TripTicket,
    ],
    [
      {
        id: 'wp_single',
        controlNumber: '',
        requestType: 'single_trip',
      } as WorkPlan,
    ]
  );
  assert.equal(disp.approved[0].workPlanNumber, 'Single Request Ticket');
});

test('Report Utilities restricts management to System Administrator only', () => {
  assert.equal(canManageReportUtilities('admin'), true);
  assert.equal(canManageReportUtilities('approver'), false);
  assert.equal(canManageReportUtilities('department_head'), false);
  assert.equal(canManageReportUtilities('requester'), false);
  assert.equal(canManageReportUtilities('gso_head'), false);
  assert.equal(canManageReportUtilities('gso_dispenser'), false);
  assert.equal(canManageReportUtilities('auditor'), false);
});

test('Report Utilities normalizes partial/corrupt configs, preserves custom sequence, and appends progressive fields retroactively', () => {
  const defaults = createDefaultReportUtilitiesConfig();
  assert.equal(defaults.id, 'report_utilities');
  for (const target of REPORT_UTILITIES_TARGET_KEYS) {
    assert.ok(defaults[target].length > 0);
    assert.ok(defaults[target].every((item) => item.enabled === true));
  }

  // Null / corrupt input falls back safely to defaults
  const fromNull = normalizeReportUtilitiesConfig(null);
  assert.deepEqual(
    getActiveReportUtilityKeys(fromNull, 'workplans_preview'),
    getActiveReportUtilityKeys(defaults, 'workplans_preview')
  );

  // Partial saved config with reordered fields, disabled field, duplicate & unknown keys
  const savedPartial = {
    id: 'report_utilities' as const,
    updatedBy: 'SysAdmin',
    updatedAt: '2026-11-18T10:00:00Z',
    workplans_preview: [
      { key: 'workPlanNo', enabled: true },
      { key: 'unknown_obsolete_col', enabled: true },
      { key: 'workPlanNo', enabled: false }, // duplicate should be ignored
      { key: 'gasDispensed', enabled: false },
    ],
    // All disabled target must auto-enable the first item to avoid blank tables
    approvals_preview: defaults.approvals_preview.map((item) => ({
      key: item.key,
      enabled: false,
    })),
  };

  const normalized = normalizeReportUtilitiesConfig(savedPartial);
  assert.equal(normalized.updatedBy, 'SysAdmin');
  assert.equal(normalized.workplans_preview[0].key, 'workPlanNo');
  assert.equal(normalized.workplans_preview[0].enabled, true);
  assert.equal(normalized.workplans_preview[1].key, 'gasDispensed');
  assert.equal(normalized.workplans_preview[1].enabled, false);
  // Progressive newly added canonical fields not in savedPartial are appended as enabled
  assert.equal(
    normalized.workplans_preview.length,
    defaults.workplans_preview.length
  );
  assert.ok(
    !normalized.workplans_preview.some((item) => item.key === 'unknown_obsolete_col')
  );

  const activeWpCols = getActiveReportUtilityKeys(normalized, 'workplans_preview');
  assert.equal(activeWpCols[0], 'workPlanNo');
  assert.ok(!activeWpCols.includes('gasDispensed'));
  assert.ok(activeWpCols.includes('department'));

  // All-disabled approvals_preview automatically re-enables its first field
  const activeApprovalCols = getActiveReportUtilityKeys(normalized, 'approvals_preview');
  assert.equal(activeApprovalCols.length, 1);
  assert.equal(activeApprovalCols[0], defaults.approvals_preview[0].key);
});

test('Report Utilities reorder and toggle helpers preserve immutability and block disabling the last active item', () => {
  const initial = [
    { key: 'a', enabled: true },
    { key: 'b', enabled: true },
    { key: 'c', enabled: false },
  ];

  // Move 'b' to index 0
  const movedUp = reorderReportUtilityItems(initial, 1, 0);
  assert.deepEqual(
    movedUp.map((i) => i.key),
    ['b', 'a', 'c']
  );
  // Original array not mutated
  assert.deepEqual(
    initial.map((i) => i.key),
    ['a', 'b', 'c']
  );

  // Out-of-bounds indices are no-ops
  assert.deepEqual(reorderReportUtilityItems(initial, -1, 2), initial);
  assert.deepEqual(reorderReportUtilityItems(initial, 0, 10), initial);

  // Toggling off 'b' succeeds while 'a' remains active
  const toggledB = toggleReportUtilityItem(initial, 'b');
  assert.equal(toggledB.blockedLastEnabled, false);
  assert.equal(toggledB.items.find((i) => i.key === 'b')?.enabled, false);

  // Toggling off 'a' (the last active item) is blocked
  const blockedA = toggleReportUtilityItem(toggledB.items, 'a');
  assert.equal(blockedA.blockedLastEnabled, true);
  assert.equal(blockedA.items.find((i) => i.key === 'a')?.enabled, true);

  // Enabling 'c' succeeds
  const enabledC = toggleReportUtilityItem(toggledB.items, 'c');
  assert.equal(enabledC.blockedLastEnabled, false);
  assert.equal(enabledC.items.find((i) => i.key === 'c')?.enabled, true);
});

test('Department mnemonics are unique 3-5 uppercase letters, validate collisions, and resolve system-wide', () => {
  // All 8 canonical Bais departments have unique 3-5 letter uppercase mnemonics
  const seen = new Set<string>();
  for (const dept of BAIS_DEPARTMENTS) {
    const code = BAIS_DEPARTMENT_MNEMONICS[dept];
    assert.ok(code, `Missing canonical mnemonic for ${dept}`);
    assert.match(code, /^[A-Z]{3,5}$/);
    assert.ok(!seen.has(code), `Duplicate canonical mnemonic ${code}`);
    seen.add(code);
    assert.equal(getDepartmentMnemonic(dept), code);
  }

  // Validation enforces 3-5 uppercase A-Z letters
  assert.equal(validateDepartmentMnemonic('ce').valid, false);
  assert.equal(validateDepartmentMnemonic('ABCDEF').valid, false);
  const okVal = validateDepartmentMnemonic(' cagro ');
  assert.equal(okVal.valid, true);
  assert.equal(okVal.normalized, 'CAGRO');

  // Custom office derivation and uniqueness collision avoidance
  const used = new Set<string>(Object.values(BAIS_DEPARTMENT_MNEMONICS));
  const cswdo = deriveDepartmentMnemonic('City Social Welfare & Development Office (CSWDO)', used);
  assert.equal(cswdo, 'CSWDO');

  const vet = deriveDepartmentMnemonic('City Veterinary Office', used);
  assert.match(vet, /^[A-Z]{3,5}$/);
  assert.ok(!used.has(vet));

  // Fleet Registry custom mnemonic overrides office lookup & detects cross-office collisions
  const fleetWithCustom: Array<Pick<FleetVehicle, 'office' | 'officeMnemonic'>> = [
    { office: 'City Veterinary Office', officeMnemonic: 'CVETO' },
  ];
  assert.equal(getDepartmentMnemonic('City Veterinary Office', fleetWithCustom), 'CVETO');
  assert.equal(
    formatDepartmentWithMnemonic('City Engineering Office', fleetWithCustom),
    'CEO — City Engineering Office'
  );
  assert.equal(formatDepartmentWithMnemonic('CEO', fleetWithCustom), 'CEO');

  // Collision detected when another office tries to claim CEO or CVETO
  assert.equal(
    checkDepartmentMnemonicCollision('CEO', 'City Veterinary Office', fleetWithCustom),
    'City Engineering Office'
  );
  assert.equal(
    checkDepartmentMnemonicCollision('CVETO', 'City Tourism Office', fleetWithCustom),
    'City Veterinary Office'
  );
  // Same office reusing its own mnemonic is allowed (no collision)
  assert.equal(
    checkDepartmentMnemonicCollision('CVETO', 'City Veterinary Office', fleetWithCustom),
    null
  );

  // RBAC department scoping and AIP optional checks recognize mnemonic equivalence
  assert.equal(
    canAccessDepartmentRecord('department_head', 'City Engineering Office', 'CEO', fleetWithCustom),
    true
  );
  assert.equal(
    canAccessDepartmentRecord('department_head', 'City Engineering Office', 'CHO', fleetWithCustom),
    false
  );
  assert.equal(isProjectAipOptionalDepartment('CMO'), true);
  assert.equal(isProjectAipOptionalDepartment('CEO'), false);
});

test('GSO Dispenser search-first mode isolates dispenser role from GSO Head and locates tickets by number', () => {
  assert.equal(isGsoDispenserOnlyMode('gso_dispenser'), true);
  assert.equal(isGsoDispenserOnlyMode('gso_head'), false);
  assert.equal(isGsoDispenserOnlyMode('admin'), false);
  assert.equal(isGsoDispenserOnlyMode('approver'), false);
  assert.equal(isGsoDispenserOnlyMode('auditor'), false);

  // GSO Head still retains full report, preview, dispensing, and export permissions
  assert.equal(canDispenseAtGso('gso_head'), true);
  assert.equal(canPreviewDispensingFullRecord('gso_head'), true);
  assert.equal(canExportDispensingRecords('gso_head'), true);

  const samplePlans: WorkPlan[] = [
    { id: 'wp1', controlNumber: 'WP-2026-0001', requestType: 'weekly_work_plan' } as WorkPlan,
    { id: 'wp_s', controlNumber: '', requestType: 'single_trip' } as WorkPlan,
  ];
  const sampleTickets: TripTicket[] = [
    {
      id: 't1',
      workPlanId: 'wp1',
      ticketNumber: '0000002',
      plateNumber: 'SGV-042',
      driverName: 'Juan Dela Cruz',
      fuelType: 'diesel',
      approvedLiters: 120,
      dispensedLiters: 0,
      servedOnce: false,
      status: 'approved',
    } as TripTicket,
    {
      id: 't2',
      workPlanId: 'wp_s',
      ticketNumber: '0000005',
      plateNumber: 'CHO-204',
      driverName: 'Ana Reyes',
      fuelType: 'gasoline',
      approvedLiters: 45,
      dispensedLiters: 40,
      servedOnce: true,
      status: 'dispensed',
    } as TripTicket,
    {
      id: 't3',
      workPlanId: 'wp1',
      ticketNumber: '0000009',
      plateNumber: 'GSO-100',
      driverName: 'Pedro Penduko',
      fuelType: 'diesel',
      approvedLiters: 0,
      dispensedLiters: 0,
      servedOnce: false,
      status: 'pending',
    } as TripTicket,
    {
      id: 't4',
      workPlanId: 'wp1',
      ticketNumber: '0000010',
      plateNumber: 'GSO-101',
      driverName: 'Mario Santos',
      fuelType: 'diesel',
      approvedLiters: 0,
      dispensedLiters: 0,
      servedOnce: false,
      status: 'rejected',
    } as TripTicket,
  ];

  assert.equal(findDispensingTicketByNumber(sampleTickets, samplePlans, '   ').status, 'empty');
  assert.equal(findDispensingTicketByNumber(sampleTickets, samplePlans, '9999999').status, 'not_found');
  assert.equal(findDispensingTicketByNumber(sampleTickets, samplePlans, '0000009').status, 'pending_approval');
  assert.equal(findDispensingTicketByNumber(sampleTickets, samplePlans, '0000010').status, 'rejected');

  // Exact match and numeric shorthand match without leading zeros
  const exact = findDispensingTicketByNumber(sampleTickets, samplePlans, '0000002');
  assert.equal(exact.status, 'found');
  assert.equal(exact.item?.ticket.plateNumber, 'SGV-042');
  assert.equal(exact.item?.ticket.driverName, 'Juan Dela Cruz');
  assert.equal(exact.item?.ticket.approvedLiters, 120);
  assert.equal(exact.item?.ticket.dispensedLiters, 0);

  const shorthand = findDispensingTicketByNumber(sampleTickets, samplePlans, '5');
  assert.equal(shorthand.status, 'found');
  assert.equal(shorthand.item?.ticket.ticketNumber, '0000005');
  assert.equal(shorthand.item?.workPlanNumber, 'Single Request Ticket');
  assert.equal(shorthand.item?.ticket.dispensedLiters, 40);
});

test('mobile display preview compaction hides empty folders and defers full report view until download opt-in', () => {
  // Full preview report mode only triggers when download is opted
  assert.equal(resolveReportPreviewMode(false), 'mobile_compact');
  assert.equal(resolveReportPreviewMode(true), 'full_report');

  // Work Program folders hide empty containers when viewing "all", but show explicitly selected empty tab
  assert.equal(shouldRenderWorkProgramFolder('all', 'approved_dispensed', 0), false);
  assert.equal(shouldRenderWorkProgramFolder('all', 'approved_undispensed', 2), true);
  assert.equal(shouldRenderWorkProgramFolder('approved_dispensed', 'approved_dispensed', 0), true);
  assert.equal(shouldRenderWorkProgramFolder('approved_dispensed', 'pending_approval', 3), false);

  // Dispensing categories hide empty section when viewing "all" if the other section has rows
  assert.equal(shouldRenderDispensingSection('all', 'approved', 0, 5), false);
  assert.equal(shouldRenderDispensingSection('all', 'dispensed', 5, 0), true);
  assert.equal(shouldRenderDispensingSection('all', 'approved', 0, 0), true);
  assert.equal(shouldRenderDispensingSection('all', 'dispensed', 0, 0), false);
  assert.equal(shouldRenderDispensingSection('approved', 'approved', 0, 5), true);

  // Mobile display preview for Reports renders only the essential compact table section
  assert.deepEqual(
    getCompactMobileReportSections([
      'summaryMetrics',
      'departmentBreakdown',
      'discrepancyAlerts',
      'depotValuation',
    ]),
    ['departmentBreakdown']
  );
  assert.deepEqual(getCompactMobileReportSections(['discrepancyAlerts', 'depotValuation']), [
    'discrepancyAlerts',
  ]);
});

test('Sandbox Role Preview restricts User Office to Internal Audit Service and Tabletop Approver to City Mayors Office', () => {
  const sampleUsers: UserAccount[] = [
    {
      uid: 'u_admin',
      username: 'admin',
      email: 'internalaudit.baiscity@gmail.com',
      displayName: 'Bais Internal Audit Admin',
      role: 'admin',
      department: 'Internal Audit Service',
      canEdit: true,
      canDelete: true,
      canSwitchToLive: true,
      canRequestSingleTrip: true,
      active: true,
      createdBy: 'system',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      uid: 'u_approver',
      username: 'approver',
      email: 'approver@baiscity.gov.ph',
      displayName: 'Engr. Roberto Alcantara',
      role: 'approver',
      department: "City Mayor's Office",
      canEdit: false,
      canDelete: false,
      canSwitchToLive: false,
      canRequestSingleTrip: false,
      active: true,
      createdBy: 'u_admin',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      uid: 'u_eng',
      username: 'eng_head',
      email: 'eng@baiscity.gov.ph',
      displayName: 'Engr. Clarissa Mendoza',
      role: 'department_head',
      department: 'City Engineering Office',
      canEdit: true,
      canDelete: false,
      canSwitchToLive: false,
      canRequestSingleTrip: false,
      active: true,
      createdBy: 'u_admin',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      uid: 'u_custom',
      username: 'treasury_req',
      email: 'treasury@baiscity.gov.ph',
      displayName: 'Maria Santos',
      role: 'requester',
      department: "City Treasurer's Office",
      canEdit: false,
      canDelete: false,
      canSwitchToLive: false,
      canRequestSingleTrip: true,
      active: true,
      createdBy: 'u_admin',
      createdAt: '2026-11-02T00:00:00Z',
      updatedAt: '2026-11-02T00:00:00Z',
    },
  ];

  // Admin & Internal Auditor match ONLY User Office = Internal Audit Service
  assert.deepEqual(getSandboxPreviewDepartmentsForRole('admin', sampleUsers), [USER_OFFICE_DEPARTMENT]);
  assert.deepEqual(getSandboxPreviewDepartmentsForRole('auditor', sampleUsers), [USER_OFFICE_DEPARTMENT]);

  // Tabletop Approver matches ONLY City Mayor's Office
  assert.deepEqual(getSandboxPreviewDepartmentsForRole('approver', sampleUsers), [TABLETOP_APPROVER_DEPARTMENT]);
  assert.equal(
    resolveDefaultSandboxDepartmentForRole('approver', 'Internal Audit Service', sampleUsers),
    "City Mayor's Office"
  );

  // Operational roles exclude Internal Audit Service and include custom RBAC departments
  const reqDepts = getSandboxPreviewDepartmentsForRole('requester', sampleUsers);
  assert.ok(!reqDepts.includes('Internal Audit Service'));
  assert.ok(reqDepts.includes("City Treasurer's Office"));
  assert.equal(
    resolveDefaultSandboxDepartmentForRole('department_head', 'Internal Audit Service', sampleUsers),
    'City Engineering Office'
  );
  assert.equal(
    resolveDefaultSandboxDepartmentForRole('gso_dispenser', 'Internal Audit Service', sampleUsers),
    'General Services Office (GSO)'
  );
});

test('Sandbox Role Preview and active session immediately apply newly created and edited RBAC permissions upon save', () => {
  const adminUser: UserAccount = {
    uid: 'u_admin',
    username: 'admin',
    email: 'internalaudit.baiscity@gmail.com',
    displayName: 'Bais Internal Audit Admin',
    role: 'admin',
    department: 'Internal Audit Service',
    canEdit: true,
    canDelete: true,
    canSwitchToLive: true,
    canRequestSingleTrip: true,
    active: true,
    createdBy: 'system',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  // No RBAC user in City Health Office yet -> preview must NOT leak admin permissions
  const noUserPreview = resolveSandboxPreviewUser({
    authenticatedUser: adminUser,
    sandboxActiveRole: 'requester',
    sandboxActiveDepartment: 'City Health Office',
    users: [adminUser],
  });
  assert.equal(noUserPreview.role, 'requester');
  assert.equal(noUserPreview.department, 'City Health Office');
  assert.equal(noUserPreview.canEdit, false);
  assert.equal(noUserPreview.canDelete, false);
  assert.equal(noUserPreview.canRequestSingleTrip, false);
  assert.equal(noUserPreview.canSwitchToLive, false);

  // Newly created RBAC user in City Health Office with Edit + Single Trip -> immediately effected
  const createdChoReq: UserAccount = {
    uid: 'u_cho_1',
    username: 'cho_req',
    email: 'cho.req@baiscity.gov.ph',
    displayName: 'Dr. Liza Cruz',
    role: 'requester',
    department: 'City Health Office',
    canEdit: true,
    canDelete: false,
    canSwitchToLive: false,
    canRequestSingleTrip: true,
    active: true,
    createdBy: 'u_admin',
    createdAt: '2026-11-18T08:00:00Z',
    updatedAt: '2026-11-18T08:00:00Z',
  };
  const afterCreatePreview = resolveSandboxPreviewUser({
    authenticatedUser: adminUser,
    sandboxActiveRole: 'requester',
    sandboxActiveDepartment: 'City Health Office',
    users: [adminUser, createdChoReq],
  });
  assert.equal(afterCreatePreview.uid, 'u_cho_1');
  assert.equal(afterCreatePreview.canEdit, true);
  assert.equal(afterCreatePreview.canDelete, false);
  assert.equal(afterCreatePreview.canRequestSingleTrip, true);

  // Edited RBAC user disables Edit & Single Trip and enables Delete + Live -> immediately effected
  const editedChoReq: UserAccount = {
    ...createdChoReq,
    canEdit: false,
    canDelete: true,
    canRequestSingleTrip: false,
    canSwitchToLive: true,
    updatedAt: '2026-11-18T09:00:00Z',
  };
  const afterEditPreview = resolveSandboxPreviewUser({
    authenticatedUser: adminUser,
    sandboxActiveRole: 'requester',
    sandboxActiveDepartment: 'City Health Office',
    users: [adminUser, editedChoReq],
  });
  assert.equal(afterEditPreview.canEdit, false);
  assert.equal(afterEditPreview.canDelete, true);
  assert.equal(afterEditPreview.canRequestSingleTrip, false);
  assert.equal(afterEditPreview.canSwitchToLive, true);

  // Signed-in non-admin user immediately receives saved RBAC edits via resolveActiveUserFromRegistry
  const liveSessionAfterEdit = resolveActiveUserFromRegistry(createdChoReq, [adminUser, editedChoReq]);
  assert.equal(liveSessionAfterEdit.canEdit, false);
  assert.equal(liveSessionAfterEdit.canDelete, true);
  assert.equal(liveSessionAfterEdit.canRequestSingleTrip, false);
  assert.equal(liveSessionAfterEdit.canSwitchToLive, true);

  // Tabletop Approver preview always resolves department to City Mayor's Office & uses approver RBAC flags
  const approverUser: UserAccount = {
    uid: 'u_appr',
    username: 'approver',
    email: 'approver@baiscity.gov.ph',
    displayName: 'Engr. Roberto Alcantara',
    role: 'approver',
    department: "City Mayor's Office",
    canEdit: true,
    canDelete: false,
    canSwitchToLive: false,
    canRequestSingleTrip: false,
    active: true,
    createdBy: 'u_admin',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-18T10:00:00Z',
  };
  const approverPreview = resolveSandboxPreviewUser({
    authenticatedUser: adminUser,
    sandboxActiveRole: 'approver',
    sandboxActiveDepartment: 'Internal Audit Service',
    users: [adminUser, approverUser],
  });
  assert.equal(approverPreview.department, "City Mayor's Office");
  assert.equal(approverPreview.canEdit, true);
  assert.equal(approverPreview.canDelete, false);
  assert.equal(
    findMatchingRbacUsersForSandboxPreview('approver', "City Mayor's Office", [adminUser, approverUser]).length,
    1
  );
});

test('Work Plan For Approval PDF includes ONLY Preparer, Reviewer, and Department Approver while Post-Approval Monitoring PDF excludes sign-offs entirely', () => {
  const pendingPlanWithExtraNames: WorkPlan = {
    id: 'wp_signoff_only',
    controlNumber: 'WP-2026-0099',
    department: 'City Engineering Office',
    projectTitle: 'Bridge Riprap & Drainage Clearing',
    projectCode: 'INFRA-2026-099',
    weekStart: '2026-11-23',
    weekEnd: '2026-11-29',
    status: 'pending_approval',
    totalRequestedLiters: 80,
    totalApprovedLiters: 0,
    totalDispensedLiters: 0,
    preparedBy: 'Engr. Clarissa Mendoza',
    preparedByDesignation: 'Engineer III / Focal Person',
    reviewedBy: 'Engr. Noel Castaneda',
    reviewedByDesignation: 'Assistant City Engineer',
    approvedBy: 'Engr. Danilo Villanueva',
    approvedByDesignation: 'City Engineer / Department Approver',
    // Legacy secondary sign-off names that MUST be excluded from preview & PDF
    divisionHead: 'Legacy Division Head Name',
    unitLead: 'Foreman J. Palomar',
    sectionManager: 'Engr. M. Silvestre',
    ownerId: 'u_admin',
    createdAt: '2026-11-18T08:00:00Z',
    updatedAt: '2026-11-18T08:00:00Z',
  };

  // 1. Pure helper returns strictly the 3 concerned-department sign-offs
  const signOffs = getWorkPlanDepartmentSignOffs(pendingPlanWithExtraNames);
  assert.equal(signOffs.length, 3);
  assert.deepEqual(
    signOffs.map((s) => ({ label: s.label, name: s.name })),
    [
      { label: 'Prepared by', name: 'Engr. Clarissa Mendoza' },
      { label: 'Reviewed by', name: 'Engr. Noel Castaneda' },
      { label: 'Department Approver', name: 'Engr. Danilo Villanueva' },
    ]
  );

  // Single trip requests omit sign-offs altogether
  assert.deepEqual(
    getWorkPlanDepartmentSignOffs({ ...pendingPlanWithExtraNames, requestType: 'single_trip' }),
    []
  );

  // 2. For Approval PDF (pending_approval) includes ONLY Preparer, Reviewer, and Department Approver
  //    and completely strips Division Head / Unit Lead / Section Manager headers & names
  const forApprovalPdf = generateWorkPlanPdf(pendingPlanWithExtraNames, []);
  const forApprovalText = forApprovalPdf.doc.output();
  assert.ok(forApprovalText.includes('FOR APPROVAL'), 'For Approval PDF must indicate For Approval layout');
  assert.ok(forApprovalText.includes('Engr. Clarissa Mendoza'), 'PDF must include Preparer name');
  assert.ok(forApprovalText.includes('Engr. Noel Castaneda'), 'PDF must include Reviewer name');
  assert.ok(forApprovalText.includes('Engr. Danilo Villanueva'), 'PDF must include Department Approver name');
  assert.ok(forApprovalText.includes('Department Approver'), 'PDF must label Department Approver');
  assert.ok(!forApprovalText.includes('Division Head'), 'PDF must NOT include Division Head sign-off header');
  assert.ok(!forApprovalText.includes('Unit Lead'), 'PDF must NOT include Unit Lead sign-off header');
  assert.ok(!forApprovalText.includes('Section Manager'), 'PDF must NOT include Section Manager sign-off header');
  assert.ok(!forApprovalText.includes('Legacy Division Head Name'), 'PDF must NOT include Division Head name');
  assert.ok(!forApprovalText.includes('Foreman J. Palomar'), 'PDF must NOT include Unit Lead name');
  assert.ok(!forApprovalText.includes('Engr. M. Silvestre'), 'PDF must NOT include Section Manager name');
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(forApprovalPdf.blobUrl);
  }

  // 3. Post-Approval Monitoring PDF (approved) completely excludes the sign-off & approval section
  const approvedPlan: WorkPlan = {
    ...pendingPlanWithExtraNames,
    status: 'approved',
    totalApprovedLiters: 80,
  };
  const monitoringPdf = generateWorkPlanPdf(approvedPlan, []);
  const monitoringText = monitoringPdf.doc.output();
  assert.ok(monitoringText.includes('POST-APPROVAL MONITORING'), 'Approved PDF must indicate Post-Approval Monitoring layout');
  assert.ok(!monitoringText.includes('Department Approver'), 'Post-Approval Monitoring PDF must NOT include Department Approver sign-off');
  assert.ok(!monitoringText.includes('Engr. Clarissa Mendoza'), 'Post-Approval Monitoring PDF must NOT include Preparer sign-off');
  assert.ok(!monitoringText.includes('Engr. Noel Castaneda'), 'Post-Approval Monitoring PDF must NOT include Reviewer sign-off');
  assert.ok(!monitoringText.includes('Engr. Danilo Villanueva'), 'Post-Approval Monitoring PDF must NOT include Approver sign-off');
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(monitoringPdf.blobUrl);
  }
});

test('Work Plan full report hides null fuel summary prior to approval and shows non-null details strictly below the last trip ticket once approved', () => {
  const pendingPlan: WorkPlan = {
    id: 'wp_pending_summary',
    controlNumber: 'WP-2026-0101',
    department: 'City Agriculture Office',
    projectTitle: 'Seed Distribution Run',
    projectCode: 'AGRI-2026-101',
    weekStart: '2026-11-23',
    weekEnd: '2026-11-29',
    status: 'pending_approval',
    totalRequestedLiters: 95,
    totalApprovedLiters: 0,
    totalDispensedLiters: 0,
    preparedBy: 'Lucia Fernandez',
    preparedByDesignation: 'Agriculturist II',
    reviewedBy: 'Ramon Navarro',
    reviewedByDesignation: 'Supervising Agriculturist',
    approvedBy: 'Dr. Tomas Gamboa',
    approvedByDesignation: 'City Agriculturist / Department Approver',
    ownerId: 'u_admin',
    createdAt: '2026-11-18T08:00:00Z',
    updatedAt: '2026-11-18T08:00:00Z',
  };

  const pendingTickets: TripTicket[] = [
    {
      id: 'tt_p1',
      workPlanId: 'wp_pending_summary',
      ticketNumber: '0000101',
      department: 'City Agriculture Office',
      projectTitle: 'Seed Distribution Run',
      vehicleId: 'v1',
      plateNumber: 'SGV-101',
      vehicleLabel: 'Pickup',
      driverName: 'Driver A',
      depotId: 'depot_1',
      fuelType: 'diesel',
      scheduledDate: '2026-11-24',
      destination: 'Brgy. Sab-ahan',
      estimatedUsage: 100,
      computedLimitLiters: 60,
      requestedLiters: 50,
      approvedLiters: 0,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'pending',
      ownerId: 'u_admin',
      createdAt: '2026-11-18T08:00:00Z',
      updatedAt: '2026-11-18T08:00:00Z',
    },
  ];

  // 1. Prior to approval: summary items MUST be empty and summaryMetrics MUST be excluded from sections
  assert.deepEqual(getWorkPlanFullReportSummaryItems(pendingPlan, pendingTickets), []);
  assert.deepEqual(
    getOrderedWorkPlanFullReportSections(
      ['undispensedNotice', 'summaryMetrics', 'tripTicketsTable', 'mandatorySignOffs'],
      false
    ),
    ['undispensedNotice', 'tripTicketsTable', 'mandatorySignOffs']
  );

  // Pending PDF must NOT include Diesel Approved / Gasoline Approved / Total Approved summary table
  const pendingPdf = generateWorkPlanPdf(pendingPlan, pendingTickets);
  const pendingPdfText = pendingPdf.doc.output();
  assert.ok(!pendingPdfText.includes('Diesel Approved / Dispensed'));
  assert.ok(!pendingPdfText.includes('Gasoline Approved / Dispensed'));
  assert.ok(!pendingPdfText.includes('Total Approved'));
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(pendingPdf.blobUrl);

  // 2. Approved Diesel-only plan (including both 'dispensed' and 'reduced' tickets):
  // omits null Gasoline portion, sums approved liters across dispensed + reduced tickets
  const approvedDieselPlan: WorkPlan = {
    ...pendingPlan,
    status: 'approved',
    totalRequestedLiters: 190,
    totalApprovedLiters: 165,
    totalDispensedLiters: 60,
  };
  const approvedDieselTickets: TripTicket[] = [
    {
      ...pendingTickets[0],
      requestedLiters: 75,
      approvedLiters: 75,
      dispensedLiters: 60,
      servedOnce: true,
      status: 'dispensed',
    },
    {
      ...pendingTickets[0],
      id: 'tt_p1b',
      ticketNumber: '0000102',
      requestedLiters: 115,
      approvedLiters: 90,
      dispensedLiters: 0,
      servedOnce: false,
      status: 'reduced',
    },
  ];

  const dieselSummary = getWorkPlanFullReportSummaryItems(approvedDieselPlan, approvedDieselTickets);
  assert.deepEqual(
    dieselSummary.map((i) => i.key),
    ['requested', 'diesel', 'tickets', 'totalApproved']
  );
  assert.equal(dieselSummary.find((i) => i.key === 'diesel')?.value, '165.0 L / 60.0 L');
  assert.equal(dieselSummary.find((i) => i.key === 'tickets')?.value, '2 / 1');
  assert.equal(dieselSummary.find((i) => i.key === 'totalApproved')?.value, '165.0 L');
  assert.ok(!dieselSummary.some((i) => i.key === 'gasoline'));

  // Even when a legacy config puts summaryMetrics before tripTicketsTable,
  // summaryMetrics MUST be placed immediately AFTER tripTicketsTable (below the last trip ticket)
  assert.deepEqual(
    getOrderedWorkPlanFullReportSections(
      ['undispensedNotice', 'summaryMetrics', 'tripTicketsTable', 'mandatorySignOffs'],
      true
    ),
    ['undispensedNotice', 'tripTicketsTable', 'summaryMetrics', 'mandatorySignOffs']
  );

  // Approved Diesel-only PDF places summary AFTER the last trip ticket and omits null Gasoline
  const approvedPdf = generateWorkPlanPdf(approvedDieselPlan, approvedDieselTickets);
  const approvedPdfText = approvedPdf.doc.output();
  const lastTicketPos = approvedPdfText.indexOf('0000102');
  const dieselSummaryPos = approvedPdfText.indexOf('Diesel Approved / Dispensed');
  assert.ok(lastTicketPos > -1, 'Approved PDF must contain last trip ticket number');
  assert.ok(dieselSummaryPos > lastTicketPos, 'Summary metrics must appear below the last trip ticket in PDF');
  assert.ok(!approvedPdfText.includes('Gasoline Approved / Dispensed'), 'Null Gasoline portion must be omitted');
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(approvedPdf.blobUrl);

  // 3. Approved mixed Diesel + Gasoline plan includes BOTH non-null fuel portions
  const mixedTickets: TripTicket[] = [
    ...approvedDieselTickets,
    {
      ...approvedDieselTickets[0],
      id: 'tt_p3',
      ticketNumber: '0000103',
      fuelType: 'gasoline',
      requestedLiters: 25,
      approvedLiters: 25,
      dispensedLiters: 0,
      servedOnce: false,
      status: 'approved',
    },
  ];
  const mixedSummary = getWorkPlanFullReportSummaryItems(
    { ...approvedDieselPlan, totalApprovedLiters: 190 },
    mixedTickets
  );
  assert.deepEqual(
    mixedSummary.map((i) => i.key),
    ['requested', 'diesel', 'gasoline', 'tickets', 'totalApproved']
  );
  assert.equal(mixedSummary.find((i) => i.key === 'gasoline')?.value, '25.0 L / 0.0 L');
  assert.equal(mixedSummary.find((i) => i.key === 'tickets')?.value, '3 / 1');
});

test('Report Utilities Layout exposes Purpose, AIP Code, Scheduled Date, and Destination as separate selectable columns with retroactive migration and PDF support', () => {
  const defaults = createDefaultReportUtilitiesConfig('admin', '2026-11-18T00:00:00Z');
  const defaultKeys = defaults.workplans_review_tickets.map((c) => c.key);

  // 1. Canonical spec has 4 individual columns and no legacy combined purposeDestination
  assert.ok(!defaultKeys.includes('purposeDestination'));
  assert.ok(defaultKeys.includes('purpose'));
  assert.ok(defaultKeys.includes('aipCode'));
  assert.ok(defaultKeys.includes('scheduledDate'));
  assert.ok(defaultKeys.includes('destination'));
  assert.deepEqual(defaultKeys.slice(0, 7), [
    'ticketNumber',
    'vehicle',
    'driver',
    'purpose',
    'aipCode',
    'scheduledDate',
    'destination',
  ]);

  // 2. Retroactive in-place migration expands legacy purposeDestination at its original index
  const migratedEnabled = normalizeReportUtilitiesConfig({
    workplans_review_tickets: [
      { key: 'ticketNumber', enabled: true },
      { key: 'purposeDestination', enabled: true },
      { key: 'requested', enabled: true },
    ],
  });
  assert.deepEqual(
    migratedEnabled.workplans_review_tickets.slice(0, 6).map((c) => c.key),
    ['ticketNumber', 'purpose', 'aipCode', 'scheduledDate', 'destination', 'requested']
  );
  assert.equal(migratedEnabled.workplans_review_tickets.find((c) => c.key === 'aipCode')?.enabled, true);

  // Legacy disabled purposeDestination preserves enabled=false across the 4 expanded columns
  const migratedDisabled = normalizeReportUtilitiesConfig({
    workplans_review_tickets: [
      { key: 'ticketNumber', enabled: true },
      { key: 'purposeDestination', enabled: false },
      { key: 'requested', enabled: true },
    ],
  });
  for (const k of ['purpose', 'aipCode', 'scheduledDate', 'destination']) {
    assert.equal(
      migratedDisabled.workplans_review_tickets.find((c) => c.key === k)?.enabled,
      false,
      `Expanded legacy disabled column ${k} must remain disabled`
    );
  }

  // 3. Individual toggle & reorder work independently for BOTH For Approval and Post-Approval Monitoring layouts
  let customApprovalCols = toggleReportUtilityItem(defaults.workplans_review_tickets, 'aipCode').items;
  const destIdx = customApprovalCols.findIndex((c) => c.key === 'destination');
  const dateIdx = customApprovalCols.findIndex((c) => c.key === 'scheduledDate');
  customApprovalCols = reorderReportUtilityItems(customApprovalCols, destIdx, dateIdx);

  // Keep AIP Code enabled in Monitoring layout, but disable Purpose in Monitoring layout to prove independence
  const customMonitoringCols = toggleReportUtilityItem(defaults.workplans_monitoring_tickets, 'purpose').items;

  const customConfig = normalizeReportUtilitiesConfig({
    ...defaults,
    workplans_review_tickets: customApprovalCols,
    workplans_monitoring_tickets: customMonitoringCols,
  });
  const activeApprovalCols = getActiveReportUtilityKeys(customConfig, 'workplans_review_tickets');
  const activeMonitoringCols = getActiveReportUtilityKeys(customConfig, 'workplans_monitoring_tickets');
  assert.ok(!activeApprovalCols.includes('aipCode'), 'Unchecked AIP Code must be excluded from For Approval layout');
  assert.ok(activeApprovalCols.includes('purpose'), 'Purpose must remain active in For Approval layout');
  assert.ok(
    activeApprovalCols.indexOf('destination') < activeApprovalCols.indexOf('scheduledDate'),
    'Reordered Destination must precede Scheduled Date in For Approval layout'
  );
  assert.ok(activeMonitoringCols.includes('aipCode'), 'AIP Code must remain active in Post-Approval Monitoring layout');
  assert.ok(!activeMonitoringCols.includes('purpose'), 'Unchecked Purpose must be excluded from Post-Approval Monitoring layout');

  const samplePendingWp: WorkPlan = {
    id: 'wp_cols_test_pending',
    controlNumber: 'WP-2026-0777',
    department: 'City Engineering Office',
    projectTitle: 'Bridge Repair',
    projectCode: 'INFRA-2026-777',
    weekStart: '2026-11-23',
    weekEnd: '2026-11-29',
    status: 'pending_approval',
    totalRequestedLiters: 80,
    totalApprovedLiters: 0,
    totalDispensedLiters: 0,
    preparedBy: 'Engr. A',
    reviewedBy: 'Engr. B',
    approvedBy: 'Engr. C',
    ownerId: 'u_admin',
    createdAt: '2026-11-18T08:00:00Z',
    updatedAt: '2026-11-18T08:00:00Z',
  };
  const sampleApprovedWp: WorkPlan = {
    ...samplePendingWp,
    id: 'wp_cols_test_approved',
    status: 'approved',
    totalApprovedLiters: 80,
  };
  const sampleTickets: TripTicket[] = [
    {
      id: 'tt_cols_1',
      workPlanId: 'wp_cols_test_pending',
      ticketNumber: '0000777',
      department: 'City Engineering Office',
      projectTitle: 'Bridge Repair',
      purposeOrProject: 'Hauling structural steel beams',
      projectAip: 'AIP-2026-BRIDGE-07',
      vehicleId: 'v1',
      plateNumber: 'SGV-777',
      vehicleLabel: 'Dump Truck',
      driverName: 'Juan Cruz',
      depotId: 'depot_1',
      fuelType: 'diesel',
      scheduledDate: '2026-11-25',
      destination: 'Brgy. Talungon Bridge',
      computedLimitLiters: 90,
      requestedLiters: 80,
      approvedLiters: 80,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'approved',
      ownerId: 'u_admin',
      createdAt: '2026-11-18T08:00:00Z',
      updatedAt: '2026-11-18T08:00:00Z',
    },
  ];

  // Default PDF includes all 4 distinct column headers and values
  const defaultPdf = generateWorkPlanPdf(samplePendingWp, sampleTickets, defaults);
  const defaultPdfText = defaultPdf.doc.output();
  assert.ok(defaultPdfText.includes('Purpose'));
  assert.ok(defaultPdfText.includes('AIP Code'));
  assert.ok(defaultPdfText.includes('Scheduled Date'));
  assert.ok(defaultPdfText.includes('Destination'));
  assert.ok(defaultPdfText.includes('AIP-2026-BRIDGE-07'));
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(defaultPdf.blobUrl);

  // Custom For Approval PDF omits unchecked AIP Code while keeping Purpose
  const customApprovalPdf = generateWorkPlanPdf(samplePendingWp, sampleTickets, customConfig);
  const customApprovalPdfText = customApprovalPdf.doc.output();
  assert.ok(!customApprovalPdfText.includes('AIP-2026-BRIDGE-07'), 'Unchecked AIP Code cell must not render in For Approval PDF');
  assert.ok(customApprovalPdfText.includes('Hauling structural steel beams'));
  assert.ok(customApprovalPdfText.includes('Brgy. Talungon Bridge'));
  assert.ok(customApprovalPdfText.includes('2026-11-25'));
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(customApprovalPdf.blobUrl);

  // Custom Post-Approval Monitoring PDF keeps AIP Code while omitting unchecked Purpose
  const customMonitoringPdf = generateWorkPlanPdf(sampleApprovedWp, sampleTickets, customConfig);
  const customMonitoringPdfText = customMonitoringPdf.doc.output();
  assert.ok(customMonitoringPdfText.includes('AIP-2026-BRIDGE-07'), 'Checked AIP Code cell must render in Monitoring PDF');
  assert.ok(!customMonitoringPdfText.includes('Hauling structural steel beams'), 'Unchecked Purpose cell must not render in Monitoring PDF');
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(customMonitoringPdf.blobUrl);
});

test('Report Utilities clearly separates For Approval (with sign-offs) and Post-Approval Monitoring (no sign-offs) Work Plan layouts', () => {
  // 1. Target specs separate the two layout groups and omit mandatorySignOffs from Post-Approval Monitoring
  const forApprovalReviewSpec = REPORT_UTILITIES_TARGET_SPECS.find((s) => s.target === 'workplans_full_review');
  const forApprovalTicketsSpec = REPORT_UTILITIES_TARGET_SPECS.find((s) => s.target === 'workplans_review_tickets');
  const monitoringReviewSpec = REPORT_UTILITIES_TARGET_SPECS.find((s) => s.target === 'workplans_monitoring_review');
  const monitoringTicketsSpec = REPORT_UTILITIES_TARGET_SPECS.find((s) => s.target === 'workplans_monitoring_tickets');

  assert.equal(forApprovalReviewSpec?.group, 'for_approval');
  assert.equal(forApprovalTicketsSpec?.group, 'for_approval');
  assert.equal(monitoringReviewSpec?.group, 'post_approval_monitoring');
  assert.equal(monitoringTicketsSpec?.group, 'post_approval_monitoring');

  const forApprovalSectionKeys = (forApprovalReviewSpec?.fields ?? []).map((f) => f.key);
  const monitoringSectionKeys = (monitoringReviewSpec?.fields ?? []).map((f) => f.key);
  assert.ok(forApprovalSectionKeys.includes('mandatorySignOffs'), 'For Approval layout must include Departmental Sign-Offs');
  assert.ok(!monitoringSectionKeys.includes('mandatorySignOffs'), 'Post-Approval Monitoring layout must NOT include Departmental Sign-Offs');

  // 2. Status resolution maps pending_approval -> for_approval and post-approval statuses -> post_approval_monitoring
  assert.equal(resolveWorkPlanReportLayoutVariant({ status: 'pending_approval' }), 'for_approval');
  assert.equal(resolveWorkPlanReportLayoutVariant({ status: 'approved' }), 'post_approval_monitoring');
  assert.equal(resolveWorkPlanReportLayoutVariant({ status: 'partially_approved' }), 'post_approval_monitoring');
  assert.equal(resolveWorkPlanReportLayoutVariant({ status: 'completed' }), 'post_approval_monitoring');
  assert.equal(resolveWorkPlanReportLayoutVariant({ status: 'rejected' }), 'post_approval_monitoring');

  // Explicit variant override works for both layouts
  assert.equal(
    resolveWorkPlanReportLayoutVariant({ status: 'approved' }, 'for_approval'),
    'for_approval'
  );
  assert.equal(
    resolveWorkPlanReportLayoutVariant({ status: 'pending_approval' }, 'post_approval_monitoring'),
    'post_approval_monitoring'
  );

  // 3. Target resolver returns distinct keys and sign-off flags per layout variant
  const approvalTargets = getWorkPlanReportTargetsForVariant('for_approval');
  assert.equal(approvalTargets.sectionsTarget, 'workplans_full_review');
  assert.equal(approvalTargets.ticketColsTarget, 'workplans_review_tickets');
  assert.equal(approvalTargets.includeSignOffs, true);

  const monitoringTargets = getWorkPlanReportTargetsForVariant('post_approval_monitoring');
  assert.equal(monitoringTargets.sectionsTarget, 'workplans_monitoring_review');
  assert.equal(monitoringTargets.ticketColsTarget, 'workplans_monitoring_tickets');
  assert.equal(monitoringTargets.includeSignOffs, false);

  // 4. Normalization strips any stray mandatorySignOffs from workplans_monitoring_review
  const normalized = normalizeReportUtilitiesConfig({
    workplans_monitoring_review: [
      { key: 'tripTicketsTable', enabled: true },
      { key: 'mandatorySignOffs', enabled: true },
    ],
  });
  assert.ok(
    !normalized.workplans_monitoring_review.some((item) => item.key === 'mandatorySignOffs'),
    'Normalized Post-Approval Monitoring sections must never contain mandatorySignOffs'
  );
});

test('PMC Staff role RBAC, PMC Project Registry validation, filtering, payload sanitization, and Sandbox Preview office', () => {
  // 1. RBAC & menu gating: PMC Staff gets unified Master Registries with ONLY PMC Project Registry sub-tab
  assert.deepEqual(getAllowedNavSections('pmc_staff'), ['registries']);
  assert.equal(getDefaultNavSection('pmc_staff'), 'registries');
  assert.deepEqual(getAllowedRegistrySubTabs('pmc_staff'), ['pmc_projects']);
  assert.equal(canAccessNavSection('pmc_staff', 'registries'), true);
  assert.equal(canAccessNavSection('pmc_staff', 'dashboard'), false);
  assert.equal(canAccessNavSection('pmc_staff', 'work_plans'), false);
  assert.equal(canAccessPmcProjectRegistry('admin'), true);
  assert.equal(canAccessPmcProjectRegistry('pmc_staff'), true);
  assert.equal(canAccessPmcProjectRegistry('requester'), false);
  assert.equal(canAccessPmcProjectRegistry('department_head'), false);
  assert.equal(canAccessPmcProjectRegistry('approver'), false);
  assert.equal(canAccessPmcProjectRegistry('gso_head'), false);
  assert.equal(canAccessPmcProjectRegistry('gso_dispenser'), false);
  assert.equal(canAccessPmcProjectRegistry('auditor'), false);

  assert.equal(canManagePmcProjects('pmc_staff'), true);
  assert.equal(canManagePmcProjects('admin'), true);
  assert.equal(canManagePmcProjects('requester'), false);
  assert.equal(canManagePmcProjects('gso_head'), false);

  // 2. Sandbox Role Preview office defaults to Project Monitoring Committee (PMC) and never IAS
  const pmcOffices = getSandboxPreviewDepartmentsForRole('pmc_staff', []);
  assert.ok(pmcOffices.includes(PMC_OFFICE_DEPARTMENT));
  assert.ok(!pmcOffices.includes(USER_OFFICE_DEPARTMENT));
  assert.equal(resolveDefaultSandboxDepartmentForRole('pmc_staff', '', []), PMC_OFFICE_DEPARTMENT);
  assert.equal(getDepartmentMnemonic(PMC_OFFICE_DEPARTMENT), 'PMC');

  // 3. Validation enforces approval year bounds, project name, AIP code normalization & uniqueness, and POW fuel amount
  const existing: PmcProject[] = [
    {
      id: 'pmc_1',
      department: 'City Engineering Office',
      approvalYear: 2026,
      projectName: 'Coastal Highway Rehabilitation',
      aipCode: 'INFRA-2026-014',
      dieselFuelComponentPhp: 420000,
      gasolineFuelComponentPhp: 65000,
      fuelComponentAmountPhp: 485000,
      ownerId: 'seed_pmc_1',
      createdAt: '2026-01-15T08:00:00Z',
      updatedAt: '2026-01-15T08:00:00Z',
    },
    {
      id: 'pmc_2',
      department: 'City Agriculture Office',
      approvalYear: 2025,
      projectName: 'Farm-to-Market Road Concreting',
      aipCode: 'AGRI-2025-003',
      dieselFuelComponentPhp: 180250.5,
      gasolineFuelComponentPhp: 35000,
      fuelComponentAmountPhp: 215250.5,
      ownerId: 'seed_pmc_1',
      createdAt: '2025-02-10T08:00:00Z',
      updatedAt: '2025-02-10T08:00:00Z',
    },
  ];

  const badYear = validatePmcProjectInput(
    { department: 'City Engineering Office', approvalYear: 1995, projectName: 'Drainage Upgrade', aipCode: 'INFRA-1995-01', dieselFuelComponentPhp: 10000, gasolineFuelComponentPhp: 0 },
    existing
  );
  assert.equal(badYear.valid, false);

  const badName = validatePmcProjectInput(
    { department: 'City Engineering Office', approvalYear: 2027, projectName: 'AB', aipCode: 'INFRA-2027-01', dieselFuelComponentPhp: 10000, gasolineFuelComponentPhp: 0 },
    existing
  );
  assert.equal(badName.valid, false);

  const badFuel = validatePmcProjectInput(
    { department: 'City Engineering Office', approvalYear: 2027, projectName: 'Drainage Upgrade', aipCode: 'INFRA-2027-01', dieselFuelComponentPhp: -50, gasolineFuelComponentPhp: 0 },
    existing
  );
  assert.equal(badFuel.valid, false);

  const dupAip = validatePmcProjectInput(
    { department: 'City Engineering Office', approvalYear: 2026, projectName: 'Duplicate AIP Test', aipCode: 'infra-2026-014', dieselFuelComponentPhp: 50000, gasolineFuelComponentPhp: 0 },
    existing
  );
  assert.equal(dupAip.valid, false);
  assert.ok(dupAip.error?.includes('INFRA-2026-014'));

  // Same AIP code under editingId itself is allowed (Diesel + Gasoline sums automatically)
  const editingSame = validatePmcProjectInput(
    {
      department: 'City Engineering Office',
      approvalYear: 2026,
      projectName: 'Coastal Highway Rehabilitation Phase 2',
      aipCode: 'infra-2026-014',
      dieselFuelComponentPhp: 440000.333,
      gasolineFuelComponentPhp: 70000.223,
    },
    existing,
    'pmc_1'
  );
  assert.equal(editingSame.valid, true);
  assert.equal(editingSame.normalized?.aipCode, 'INFRA-2026-014');
  assert.equal(editingSame.normalized?.dieselFuelComponentPhp, 440000.33);
  assert.equal(editingSame.normalized?.gasolineFuelComponentPhp, 70000.22);
  assert.equal(editingSame.normalized?.fuelComponentAmountPhp, 510000.55);

  // 4. Filter & summarize computes department + year options, search match, and Diesel/Gasoline/Total PHP totals
  const allSummary = filterAndSummarizePmcProjects(existing, {});
  assert.deepEqual(allSummary.availableYears, [2026, 2025]);
  assert.deepEqual(allSummary.availableDepartments, ['City Agriculture Office', 'City Engineering Office']);
  assert.equal(allSummary.projectCount, 2);
  assert.equal(allSummary.totalDieselComponentPhp, 600250.5);
  assert.equal(allSummary.totalGasolineComponentPhp, 100000);
  assert.equal(allSummary.totalFuelComponentPhp, 700250.5);

  const filtered2026 = filterAndSummarizePmcProjects(existing, {
    department: 'City Engineering Office',
    year: '2026',
    search: 'coastal',
  });
  assert.equal(filtered2026.projectCount, 1);
  assert.equal(filtered2026.items[0].aipCode, 'INFRA-2026-014');
  assert.equal(filtered2026.totalDieselComponentPhp, 420000);
  assert.equal(filtered2026.totalGasolineComponentPhp, 65000);
  assert.equal(filtered2026.totalFuelComponentPhp, 485000);

  // 5. Firestore payload sanitization matches blueprint constraints
  const sanitized = prepareFirestoreRecordPayload(
    {
      id: 'pmc_new',
      department: '  City Engineering Office ',
      approvalYear: 2027.9,
      projectName: '  Public Market Drainage Upgrade  ',
      aipCode: '  infra-2027-001 ',
      dieselFuelComponentPhp: 275000.456,
      gasolineFuelComponentPhp: 50000,
      fuelComponentAmountPhp: 325000.456,
      ownerId: 'u_pmc',
      createdAt: '2026-11-19T06:00:00Z',
      updatedAt: '2026-11-19T06:00:00Z',
    },
    'firebase_pmc_uid',
    { isCreate: true, collection: 'pmcProjects' }
  );
  assert.equal(sanitized.department, 'City Engineering Office');
  assert.equal(sanitized.approvalYear, 2027);
  assert.equal(sanitized.projectName, 'Public Market Drainage Upgrade');
  assert.equal(sanitized.aipCode, 'INFRA-2027-001');
  assert.equal(sanitized.dieselFuelComponentPhp, 275000.46);
  assert.equal(sanitized.gasolineFuelComponentPhp, 50000);
  assert.equal(sanitized.fuelComponentAmountPhp, 325000.46);
  assert.equal(sanitized.ownerId, 'firebase_pmc_uid');
});

test('Weighted Average Cost (WAC) delivery computation, timestamp-referenced dispensing cost, Heavy Equipment/Dump Truck PMC referencing, and aggregate fuel cap enforcement', () => {
  // 1. Weighted Average Cost formula on delivery
  // Existing: 8,000 L @ ₱58.00/L + New Delivery: 2,000 L @ ₱63.00/L => (464,000 + 126,000) / 10,000 = ₱59.00/L
  assert.equal(
    computeWeightedAverageCostAfterDelivery({
      currentStockLiters: 8000,
      currentWacPhp: 58,
      deliveredLiters: 2000,
      deliveryUnitCostPhp: 63,
    }),
    59
  );
  // Existing 0 L => new delivery unit cost becomes the WAC
  assert.equal(
    computeWeightedAverageCostAfterDelivery({
      currentStockLiters: 0,
      currentWacPhp: 58,
      deliveredLiters: 1500,
      deliveryUnitCostPhp: 61.25,
    }),
    61.25
  );

  // 2. Tabular WAC ledger & timestamp-referenced prevailing WAC resolution
  const depots = [
    {
      id: 'depot_main',
      name: 'Bais City Central GSO Depot',
      location: 'Motorpool',
      gasolineCapacityLiters: 15000,
      gasolineCurrentLiters: 10000,
      gasolinePricePerLiter: 64.5,
      dieselCapacityLiters: 25000,
      dieselCurrentLiters: 18000,
      dieselPricePerLiter: 61.0,
      reorderThresholdPct: 25,
      updatedAt: '2026-11-19T08:00:00Z',
    },
  ];

  const logs = [
    {
      id: 'log_del_1',
      depotId: 'depot_main',
      depotName: 'Bais City Central GSO Depot',
      fuelType: 'diesel' as const,
      transactionType: 'delivery' as const,
      litersDelta: 10000,
      balanceBefore: 10000,
      balanceAfter: 20000,
      deliveryUnitCostPhp: 60.0,
      weightedAverageCostBefore: 56.0,
      weightedAverageCostAfter: 58.0,
      prevailingWeightedAverageCostPhp: 58.0,
      referenceNumber: 'DR-1001',
      approvalStatus: 'verified' as const,
      ownerId: 'u_gso',
      createdAt: '2026-11-10T08:00:00Z',
      verifiedAt: '2026-11-10T08:05:00Z',
    },
    {
      id: 'log_del_2',
      depotId: 'depot_main',
      depotName: 'Bais City Central GSO Depot',
      fuelType: 'diesel' as const,
      transactionType: 'delivery' as const,
      litersDelta: 5000,
      balanceBefore: 15000,
      balanceAfter: 20000,
      deliveryUnitCostPhp: 70.0,
      weightedAverageCostBefore: 58.0,
      weightedAverageCostAfter: 61.0,
      prevailingWeightedAverageCostPhp: 61.0,
      referenceNumber: 'DR-1002',
      approvalStatus: 'verified' as const,
      ownerId: 'u_gso',
      createdAt: '2026-11-18T09:00:00Z',
      verifiedAt: '2026-11-18T09:05:00Z',
    },
    {
      id: 'log_del_pending',
      depotId: 'depot_main',
      depotName: 'Bais City Central GSO Depot',
      fuelType: 'diesel' as const,
      transactionType: 'delivery' as const,
      litersDelta: 2000,
      balanceBefore: 20000,
      balanceAfter: 22000,
      deliveryUnitCostPhp: 99.0,
      weightedAverageCostBefore: 61.0,
      weightedAverageCostAfter: 64.45,
      prevailingWeightedAverageCostPhp: 64.45,
      referenceNumber: 'DR-PENDING',
      approvalStatus: 'pending_gso_approval' as const,
      ownerId: 'u_gso',
      createdAt: '2026-11-19T10:00:00Z',
    },
  ];

  const wacLedger = buildWeightedAverageCostLedger(logs, depots);
  const verifiedWacEntries = wacLedger.filter((e) => e.approvalStatus === 'verified');
  assert.equal(verifiedWacEntries.length, 2, 'Two verified deliveries present in WAC ledger');
  assert.equal(verifiedWacEntries[0].referenceNumber, 'DR-1002', 'Ledger is newest-first');
  assert.equal(verifiedWacEntries[0].newPrevailingWacPhp, 61.0);
  assert.equal(verifiedWacEntries[1].newPrevailingWacPhp, 58.0);

  // Dispensing on Nov 12 uses the Nov 10 prevailing WAC (₱58.00/L), NOT Nov 18 (₱61.00/L)
  assert.equal(
    resolvePrevailingWeightedAverageCost({
      fuelType: 'diesel',
      timestampIso: '2026-11-12T10:00:00Z',
      inventoryLogs: logs,
      depots,
    }),
    58.0
  );
  // Dispensing on Nov 19 uses Nov 18 prevailing WAC (₱61.00/L), ignoring pending delivery
  assert.equal(
    resolvePrevailingWeightedAverageCost({
      fuelType: 'diesel',
      timestampIso: '2026-11-19T12:00:00Z',
      inventoryLogs: logs,
      depots,
    }),
    61.0
  );
  // Gasoline with no verified deliveries falls back to depot price (₱64.50/L)
  assert.equal(
    resolvePrevailingWeightedAverageCost({
      fuelType: 'gasoline',
      timestampIso: '2026-11-19T12:00:00Z',
      inventoryLogs: logs,
      depots,
    }),
    64.5
  );

  // 3. Heavy Equipment & Dump Truck exclusively require PMC Project Registry referencing
  assert.equal(requiresPmcRegistryReference('heavy_equipment'), true);
  assert.equal(requiresPmcRegistryReference('dump_truck'), true);
  assert.equal(requiresPmcRegistryReference('service_pickup'), false);
  assert.equal(requiresPmcRegistryReference('light_utility'), false);
  assert.equal(requiresPmcRegistryReference('generator_tool'), false);
  assert.equal(requiresPmcRegistryReference('emergency_rescue'), false);

  // 4. Project fuel summary: running balance reduced strictly by actual dispensed × prevailing WAC at dispensing timestamp
  const project: PmcProject = normalizePmcProject({
    id: 'pmc_road_1',
    department: 'City Engineering Office',
    approvalYear: 2026,
    projectName: 'Coastal Highway Rehabilitation',
    aipCode: 'INFRA-2026-014',
    dieselFuelComponentPhp: 10000,
    gasolineFuelComponentPhp: 3000,
    fuelComponentAmountPhp: 13000,
    ownerId: 'u_pmc',
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-01-10T08:00:00Z',
  });

  const workPlans = [
    {
      id: 'wp1',
      controlNumber: 'WP-2026-0001',
      requestType: 'weekly_work_plan' as const,
      department: 'City Engineering Office',
      projectTitle: 'Coastal Highway Rehabilitation',
      projectCode: 'INFRA-2026-014',
      weekStart: '2026-11-12',
      weekEnd: '2026-11-19',
      status: 'approved' as const,
      totalRequestedLiters: 150,
      totalApprovedLiters: 140,
      totalDispensedLiters: 100,
      preparedBy: 'Engr. A',
      reviewedBy: 'Engr. B',
      approvedBy: 'Mayor C',
      ownerId: 'u_eng',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    },
  ];

  const vehicles = [
    {
      id: 'v_dt',
      office: 'City Engineering Office',
      plateNumber: 'SGV-042',
      chassisNumber: 'CHS-1',
      makeModel: 'Isuzu Dump Truck',
      yearAcquired: 2022,
      equipmentClass: 'dump_truck' as const,
      fuelType: 'diesel' as const,
      efficiencyRate: 4,
      efficiencyUnit: 'km_per_liter' as const,
      maxWeeklyLiters: 400,
      status: 'operational' as const,
      ownerId: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'v_he',
      office: 'City Engineering Office',
      plateNumber: 'HE-011',
      chassisNumber: 'CHS-3',
      makeModel: 'CAT Motor Grader',
      yearAcquired: 2021,
      equipmentClass: 'heavy_equipment' as const,
      fuelType: 'diesel' as const,
      efficiencyRate: 12,
      efficiencyUnit: 'liters_per_hour' as const,
      maxWeeklyLiters: 400,
      status: 'operational' as const,
      ownerId: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'v_pickup',
      office: 'City Engineering Office',
      plateNumber: 'SHX-108',
      chassisNumber: 'CHS-2',
      makeModel: 'Toyota Hilux Pickup',
      yearAcquired: 2023,
      equipmentClass: 'service_pickup' as const,
      fuelType: 'diesel' as const,
      efficiencyRate: 10,
      efficiencyUnit: 'km_per_liter' as const,
      maxWeeklyLiters: 150,
      status: 'operational' as const,
      ownerId: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const projectTickets = [
    {
      id: 't1',
      workPlanId: 'wp1',
      ticketNumber: '0000001',
      department: 'City Engineering Office',
      projectTitle: 'Coastal Highway',
      purposeOrProject: 'Coastal Highway Rehabilitation',
      projectAip: 'INFRA-2026-014',
      pmcProjectId: 'pmc_road_1',
      vehicleId: 'v_dt',
      plateNumber: 'SGV-042',
      vehicleLabel: 'Isuzu Dump Truck',
      driverName: 'Driver A',
      driverLicense: 'DL-1',
      fuelType: 'diesel' as const,
      depotId: 'depot_main',
      scheduledDate: '2026-11-12',
      destination: 'Brgy. Tamisu',
      estimatedUsage: 100,
      computedLimitLiters: 100,
      requestedLiters: 100,
      approvedLiters: 100,
      dispensedLiters: 100,
      forfeitedLiters: 0,
      servedOnce: true,
      dispensedAt: '2026-11-12T10:00:00Z',
      status: 'dispensed' as const,
      ownerId: 'u_eng',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    },
    {
      id: 't2',
      workPlanId: 'wp1',
      ticketNumber: '0000002',
      department: 'City Engineering Office',
      projectTitle: 'Coastal Highway',
      purposeOrProject: 'Coastal Highway Rehabilitation',
      projectAip: 'INFRA-2026-014',
      pmcProjectId: 'pmc_road_1',
      vehicleId: 'v_he',
      plateNumber: 'HE-011',
      vehicleLabel: 'CAT Grader',
      driverName: 'Driver B',
      driverLicense: 'DL-2',
      fuelType: 'diesel' as const,
      depotId: 'depot_main',
      scheduledDate: '2026-11-19',
      destination: 'Brgy. Tamisu',
      estimatedUsage: 50,
      computedLimitLiters: 50,
      requestedLiters: 50,
      approvedLiters: 40,
      dispensedLiters: 0,
      forfeitedLiters: 0,
      servedOnce: false,
      status: 'reduced' as const,
      ownerId: 'u_eng',
      createdAt: '2026-11-18T10:00:00Z',
      updatedAt: '2026-11-18T12:00:00Z',
    },
  ];

  assert.equal(matchTicketToPmcProject(projectTickets[0], project), true);

  const summary = computePmcProjectFuelSummary({
    project,
    tickets: projectTickets,
    workPlans,
    vehicles,
    inventoryLogs: logs,
    depots,
  });
  // t1 dispensed 100 L on Nov 12 when prevailing Diesel WAC was ₱58.00/L => ₱5,800.00
  assert.equal(summary.diesel.dispensedLiters, 100);
  assert.equal(summary.diesel.actualDispensedCostPhp, 5800);
  // Running balance = POW Cap (₱10,000) - Actual Dispensed Cost (₱5,800) = ₱4,200
  assert.equal(summary.diesel.runningBalancePhp, 4200);
  // Active pending/approved commitment for t2: 40 L * current prevailing Diesel WAC (₱61.00/L) = ₱2,440
  assert.equal(summary.diesel.requestedLiters, 150);
  assert.equal(summary.diesel.approvedLiters, 140);
  assert.equal(summary.diesel.pendingAndApprovedCommittedPhp, 2440);
  assert.equal(summary.diesel.availableForNewRequestPhp, 1760);
  assert.equal(summary.requestRows.length, 2);
  const row1 = summary.requestRows.find((r) => r.ticket.ticketNumber === '0000001');
  const row2 = summary.requestRows.find((r) => r.ticket.ticketNumber === '0000002');
  assert.ok(row1 && row2);
  assert.equal(row1.prevailingWacPhp, 58);
  assert.equal(row1.dispensedCostPhp, 5800);
  assert.equal(row2.ticket.dispensedLiters, 0);
  assert.equal(row2.dispensedCostPhp, 0);

  // 5. Aggregate cap enforcement on Work Plan submission
  // Missing PMC project on Dump Truck is blocked
  const missingPmc = validateDraftTicketsAgainstPmcCaps({
    draftTickets: [{ vehicleId: 'v_dt', requestedLiters: 20 }],
    vehicles,
    pmcProjects: [project],
    existingTickets: projectTickets,
    workPlans,
    inventoryLogs: logs,
    depots,
  });
  assert.equal(missingPmc.valid, false);
  assert.ok(missingPmc.issues[0]?.message.includes('PMC Project Registry'));

  // Missing PMC project on Service Pickup is ALLOWED
  const pickupNoPmc = validateDraftTicketsAgainstPmcCaps({
    draftTickets: [{ vehicleId: 'v_pickup', requestedLiters: 20 }],
    vehicles,
    pmcProjects: [project],
    existingTickets: projectTickets,
    workPlans,
    inventoryLogs: logs,
    depots,
  });
  assert.equal(pickupNoPmc.valid, true);

  // Remaining available Diesel cap on pmc_road_1 is ₱1,760. At ₱61/L, 30 L = ₱1,830 -> BLOCKED
  const overCap = validateDraftTicketsAgainstPmcCaps({
    draftTickets: [
      { vehicleId: 'v_dt', pmcProjectId: 'pmc_road_1', requestedLiters: 15 },
      { vehicleId: 'v_he', pmcProjectId: 'pmc_road_1', requestedLiters: 15 },
    ],
    vehicles,
    pmcProjects: [project],
    existingTickets: projectTickets,
    workPlans,
    inventoryLogs: logs,
    depots,
  });
  assert.equal(overCap.valid, false);
  assert.ok(overCap.issues[0]?.message.includes('Diesel fuel cap exceeded'));

  // 25 L * ₱61/L = ₱1,525 <= ₱1,760 -> ALLOWED
  const withinCap = validateDraftTicketsAgainstPmcCaps({
    draftTickets: [{ vehicleId: 'v_dt', pmcProjectId: 'pmc_road_1', requestedLiters: 25 }],
    vehicles,
    pmcProjects: [project],
    existingTickets: projectTickets,
    workPlans,
    inventoryLogs: logs,
    depots,
  });
  assert.equal(withinCap.valid, true);
});

test('resolveDepotTransactionVerification posts pre-delivery dipstick deliveries immediately as verified even without optional GSO code', () => {
  // Post-dipstick delivery with optional GSO code left blank -> verified immediately with auto-stamped DIP code
  const autoVerified = resolveDepotTransactionVerification({
    transactionType: 'delivery',
    digitalVerificationCode: undefined,
    actorDisplayName: 'Mario Santos',
    gsoTransactionCode: 'DL00003',
    postImmediately: true,
  });
  assert.equal(autoVerified.isVerifiedNow, true);
  assert.equal(autoVerified.approvalStatus, 'verified');
  assert.equal(autoVerified.gsoApproverName, 'Mario Santos');
  assert.equal(autoVerified.digitalVerificationCode, 'DIP-DL00003');

  // Post-dipstick delivery with manual 4+ char GSO code -> preserves manual code
  const manualVerified = resolveDepotTransactionVerification({
    transactionType: 'delivery',
    digitalVerificationCode: 'GSO-905',
    actorDisplayName: 'Mario Santos',
    gsoTransactionCode: 'DL00004',
    postImmediately: true,
  });
  assert.equal(manualVerified.isVerifiedNow, true);
  assert.equal(manualVerified.approvalStatus, 'verified');
  assert.equal(manualVerified.digitalVerificationCode, 'GSO-905');

  // Standard adjustment without verification code -> remains pending_gso_approval
  const pendingAdj = resolveDepotTransactionVerification({
    transactionType: 'shrinkage_adjustment',
    digitalVerificationCode: '',
    actorDisplayName: 'Mario Santos',
    gsoTransactionCode: 'SH00002',
    postImmediately: false,
  });
  assert.equal(pendingAdj.isVerifiedNow, false);
  assert.equal(pendingAdj.approvalStatus, 'pending_gso_approval');
});

test('prepareFirestoreRecordPayload sanitizes inventoryLogs delivery fields cleanly for Firestore rules', () => {
  const sanitized = prepareFirestoreRecordPayload(
    {
      id: 'inv_123',
      depotId: 'depot_gso_central',
      depotName: 'GSO Central Fuel Depot',
      tankId: 'tank_gso_ust01',
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 2000,
      balanceBefore: 21850,
      balanceAfter: 23850,
      deliveryUnitCostPhp: 62.123456,
      deliveryTotalAmountPhp: 124246.9123,
      physicalDipLiters: 19450.56,
      referenceNumber: '  dr-2026-990  ',
      purchaseOrderRef: '  po-2026-550 ',
      supplierName: '  Petron Bulk Depot  ',
      deliveryDate: '2026-11-20',
      notes: '  BOL: BOL-2026-990  ',
      approvalStatus: 'verified',
      gsoApproverName: '  Bais Internal Audit Admin  ',
      digitalVerificationCode: '  DIP-DL00003  ',
      ownerId: 'old_uid',
      createdAt: '2026-11-20T14:00:00.000Z',
    },
    'firebase_uid_99',
    { isCreate: true, collection: 'inventoryLogs' }
  );

  assert.equal(sanitized.ownerId, 'firebase_uid_99');
  assert.equal(sanitized.deliveryUnitCostPhp, 62.1235);
  assert.equal(sanitized.deliveryTotalAmountPhp, 124246.91);
  assert.equal(sanitized.physicalDipLiters, 19450.6);
  assert.equal(sanitized.referenceNumber, 'dr-2026-990');
  assert.equal(sanitized.purchaseOrderRef, 'PO-2026-550');
  assert.equal(sanitized.supplierName, 'Petron Bulk Depot');
  assert.equal(sanitized.gsoApproverName, 'Bais Internal Audit Admin');
  assert.equal(sanitized.digitalVerificationCode, 'DIP-DL00003');
});

test('canAccessDepotLedgerRegister allows ONLY admin and gso_head and strictly blocks gso_dispenser and other roles', () => {
  assert.equal(canAccessDepotLedgerRegister('admin'), true);
  assert.equal(canAccessDepotLedgerRegister('gso_head'), true);
  assert.equal(canAccessDepotLedgerRegister('gso_dispenser'), false);
  assert.equal(canAccessDepotLedgerRegister('approver'), false);
  assert.equal(canAccessDepotLedgerRegister('department_head'), false);
  assert.equal(canAccessDepotLedgerRegister('requester'), false);
  assert.equal(canAccessDepotLedgerRegister('pmc_staff'), false);
  assert.equal(canAccessDepotLedgerRegister('auditor'), false);
});

test('GSO Head distinct verification code validation, generation, matching, and Firestore sanitization are exclusive to gso_head RBAC', () => {
  const existingUsers: UserAccount[] = [
    {
      uid: 'u_gso_head_1',
      email: 'gso.head1@baiscity.gov.ph',
      displayName: 'Engr. Ramon Villanueva',
      role: 'gso_head',
      department: 'General Services Office (GSO)',
      gsoVerificationCode: 'GSO-HD-9012',
      active: true,
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      uid: 'u_gso_head_inactive',
      email: 'gso.former@baiscity.gov.ph',
      displayName: 'Former GSO Head',
      role: 'gso_head',
      department: 'General Services Office (GSO)',
      gsoVerificationCode: 'GSO-HD-1111',
      active: false,
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      uid: 'u_dispenser_1',
      email: 'dispenser@baiscity.gov.ph',
      displayName: 'Mario Santos',
      role: 'gso_dispenser',
      department: 'General Services Office (GSO)',
      active: true,
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  // Normalization uppercases & trims
  assert.equal(normalizeGsoVerificationCode('  gso-hd-7788  '), 'GSO-HD-7788');

  // Required & format-checked for gso_head
  const missingCode = validateGsoHeadVerificationCode({
    role: 'gso_head',
    code: '   ',
    existingUsers,
  });
  assert.equal(missingCode.valid, false);

  const invalidChars = validateGsoHeadVerificationCode({
    role: 'gso_head',
    code: 'GSO HEAD!@#',
    existingUsers,
  });
  assert.equal(invalidChars.valid, false);

  // Rejects duplicate code assigned to another GSO Head
  const duplicateCode = validateGsoHeadVerificationCode({
    role: 'gso_head',
    code: 'gso-hd-9012',
    existingUsers,
  });
  assert.equal(duplicateCode.valid, false);
  assert.ok(duplicateCode.error?.toLowerCase().includes('already assigned'));

  // Allows keeping own code when editing the same GSO Head (excludeUid)
  const selfEdit = validateGsoHeadVerificationCode({
    role: 'gso_head',
    code: 'GSO-HD-9012',
    existingUsers,
    excludeUid: 'u_gso_head_1',
  });
  assert.equal(selfEdit.valid, true);
  assert.equal(selfEdit.normalizedCode, 'GSO-HD-9012');

  // Accepts a new distinct code for a second GSO Head
  const distinctNew = validateGsoHeadVerificationCode({
    role: 'gso_head',
    code: 'gso-hd-7788',
    existingUsers,
  });
  assert.equal(distinctNew.valid, true);
  assert.equal(distinctNew.normalizedCode, 'GSO-HD-7788');

  // Strips code completely for non-gso_head roles (even if passed in)
  const nonHeadRoles: UserAccount['role'][] = [
    'admin',
    'approver',
    'gso_dispenser',
    'department_head',
    'requester',
    'pmc_staff',
    'auditor',
  ];
  for (const role of nonHeadRoles) {
    const res = validateGsoHeadVerificationCode({
      role,
      code: 'GSO-HD-9999',
      existingUsers,
    });
    assert.equal(res.valid, true);
    assert.equal(res.normalizedCode, undefined);
  }

  // Distinct code generator never collides with existing codes
  const generated = generateDistinctGsoVerificationCode(existingUsers);
  assert.match(generated, /^GSO-HD-[A-Z0-9]{4,10}$/);
  assert.notEqual(generated, 'GSO-HD-9012');
  assert.notEqual(generated, 'GSO-HD-1111');

  // Matching verifies ONLY active GSO Head codes
  const matchedActive = matchGsoHeadVerificationCode('gso-hd-9012', existingUsers);
  assert.equal(matchedActive.matched, true);
  assert.equal(matchedActive.normalizedCode, 'GSO-HD-9012');
  assert.equal(matchedActive.gsoHead?.uid, 'u_gso_head_1');
  assert.equal(matchGsoHeadVerificationCode('GSO-HD-1111', existingUsers).matched, false); // inactive GSO Head blocked
  assert.equal(matchGsoHeadVerificationCode('WRONG-123', existingUsers).matched, false);

  // Firestore payload & invite sanitization preserves gsoVerificationCode ONLY for gso_head
  const gsoHeadPayload = prepareFirestoreRecordPayload(
    { ...existingUsers[0] },
    'admin_uid',
    { collection: 'users' }
  );
  assert.equal(gsoHeadPayload.gsoVerificationCode, 'GSO-HD-9012');

  const demotedPayload = prepareFirestoreRecordPayload(
    { ...existingUsers[0], role: 'gso_dispenser' },
    'admin_uid',
    { collection: 'users' }
  );
  assert.equal('gsoVerificationCode' in demotedPayload, false);

  const gsoHeadInvite = buildInvitePayloadFromUser(existingUsers[0], 'admin_uid');
  assert.ok(gsoHeadInvite);
  assert.equal(gsoHeadInvite.gsoVerificationCode, 'GSO-HD-9012');

  const demotedInvite = buildInvitePayloadFromUser(
    { ...existingUsers[0], role: 'requester' },
    'admin_uid'
  );
  assert.ok(demotedInvite);
  assert.equal('gsoVerificationCode' in demotedInvite, false);

  // CredentialLogin proof lookup docs NEVER expose gsoVerificationCode
  const loginPayloads = buildCredentialLoginPayloadsFromUser(
    {
      ...existingUsers[0],
      username: 'gso_head',
      passwordHash: hashPassword('BaisGsoHead2026!'),
    },
    'admin_uid'
  );
  assert.ok(loginPayloads.length > 0);
  for (const lp of loginPayloads) {
    assert.equal('gsoVerificationCode' in lp, false);
  }
});

test('immutable audit trail helpers enforce latest-first sorting, category routing, secret redaction, and Admin-only visibility', () => {
  // Only System Administrator can inspect audit logs
  assert.equal(canViewAuditLogs('admin'), true);
  assert.equal(canViewAuditLogs('gso_head'), false);
  assert.equal(canViewAuditLogs('gso_dispenser'), false);
  assert.equal(canViewAuditLogs('auditor'), false);
  assert.equal(canViewAuditLogs('approver'), false);
  assert.equal(canViewAuditLogs('pmc_staff'), false);
  assert.equal(canViewAuditLogs('department_head'), false);
  assert.equal(canViewAuditLogs('requester'), false);

  // Secret redaction never leaks passwords, hashes, or GSO verification codes
  const redacted = sanitizeAuditDetails(
    'Method: Login | password=MySecret123 | gsoVerificationCode: GSO-HD-9012 | Outcome: Failed'
  );
  assert.ok(redacted);
  assert.equal(redacted.includes('MySecret123'), false);
  assert.equal(redacted.includes('GSO-HD-9012'), false);
  assert.ok(redacted.includes('password=[REDACTED]'));
  assert.ok(redacted.includes('gsoVerificationCode=[REDACTED]'));

  // Timestamp formatting includes full YYYY-MM-DD HH:mm:ss
  assert.equal(formatAuditTimestamp('2026-11-12T08:15:42.123Z'), '2026-11-12 08:15:42');

  const sampleLogs = [
    {
      id: 'aud_old',
      actorUid: 'u1',
      actorEmail: 'eng@baiscity.gov.ph',
      actorRole: 'department_head',
      action: 'WORKPLAN_CREATED',
      entityType: 'workPlan',
      entityId: 'wp_1',
      summary: 'Created work plan',
      createdAt: '2026-11-10T07:00:00Z',
    },
    {
      id: 'aud_newest',
      actorUid: 'u_admin',
      actorEmail: 'internalaudit.baiscity@gmail.com',
      actorName: 'Bais Internal Audit Admin',
      actorRole: 'admin',
      action: 'CREDENTIAL_LOGIN_SUCCESS',
      entityType: 'session',
      entityId: 'u_admin',
      summary: 'Admin signed in successfully',
      details: 'Method: Local Credential Registry | Role: admin | Environment: SANDBOX',
      createdAt: '2026-11-12T10:30:15Z',
    },
    {
      id: 'aud_mid',
      actorUid: 'u_gso',
      actorEmail: 'gso.head@baiscity.gov.ph',
      actorRole: 'gso_head',
      action: 'STORAGE_TANK_UPDATED',
      entityType: 'storageTank',
      entityId: 'tank_1',
      summary: 'Updated UST-GSO-01 specs',
      createdAt: '2026-11-11T15:20:00Z',
    },
  ];

  // Latest transactions strictly at the top
  const sorted = sortAuditLogsLatestFirst(sampleLogs);
  assert.deepEqual(
    sorted.map((l) => l.id),
    ['aud_newest', 'aud_mid', 'aud_old']
  );

  // Automatic category classification
  assert.equal(classifyAuditLogCategory(sampleLogs[0]), 'transaction');
  assert.equal(classifyAuditLogCategory(sampleLogs[1]), 'credential');
  assert.equal(classifyAuditLogCategory(sampleLogs[2]), 'registry');

  // Filtering by category & search
  const credOnly = filterAuditLogs(sampleLogs, { category: 'credential' });
  assert.deepEqual(
    credOnly.map((l) => l.id),
    ['aud_newest']
  );
  const detailsEntries = parseAuditDetailsEntries(sampleLogs[1].details);
  assert.equal(detailsEntries.length, 3);
  assert.deepEqual(detailsEntries[0], { label: 'Method', value: 'Local Credential Registry' });

  // Firestore payload sanitization preserves valid optional fields & strips secrets/invalid enums
  const sanitizedDoc = prepareFirestoreRecordPayload(
    {
      ...sampleLogs[1],
      category: 'credential',
      environment: 'sandbox',
      details: 'Method: Login | password=LeakMeNot',
    },
    'firebase_uid_1',
    { isCreate: true, collection: 'auditLogs' }
  );
  assert.equal(sanitizedDoc.actorUid, 'firebase_uid_1');
  assert.equal(sanitizedDoc.category, 'credential');
  assert.equal(sanitizedDoc.environment, 'sandbox');
  assert.equal(String(sanitizedDoc.details).includes('LeakMeNot'), false);
});

test('buildFuelClassLedger builds separate immutable Diesel and Gasoline ledgers with running volume balance and effected WAC cost', () => {
  const depots: FuelDepot[] = [
    {
      id: 'depot_1',
      name: 'GSO Central Fuel Depot',
      location: 'City Hall',
      gasolineCapacityLiters: 15000,
      gasolineCurrentLiters: 3100,
      gasolinePricePerLiter: 65.0,
      dieselCapacityLiters: 30000,
      dieselCurrentLiters: 1930,
      dieselPricePerLiter: 59.0,
      updatedAt: '2026-11-12T12:00:00Z',
    },
  ];

  // Diesel movements (opening = 1000 L @ ₱56.00/L):
  // 1) Delivery +1000 L @ ₱62.00/L -> Running Vol = 2000 L, Effected WAC = (1000*56 + 1000*62)/2000 = ₱59.00/L, Running Cost = ₱118,000.00
  // 2) Dispense -100 L -> Running Vol = 1900 L, Effected WAC = ₱59.00/L, Tx Cost = ₱5,900.00, Running Cost = ₱112,100.00
  // 3) Verified Overage Adjustment +30 L -> Running Vol = 1930 L, Effected WAC = ₱59.00/L, Tx Cost = +₱1,770.00, Running Cost = ₱113,870.00
  // 4) Pending Shrinkage -50 L (unverified) -> Running Vol MUST stay 1930 L until verified!
  // Gasoline movement (opening = 2100 L @ ₱63.00/L):
  // 1) Delivery +1000 L @ ₱69.20/L -> Running Vol = 3100 L, Effected WAC = ₱65.00/L, Running Cost = ₱201,500.00
  const logs: InventoryLog[] = [
    {
      id: 'dsl_in_1',
      depotId: 'depot_1',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 1000,
      balanceBefore: 1000,
      balanceAfter: 2000,
      deliveryUnitCostPhp: 62.0,
      deliveryTotalAmountPhp: 62000,
      weightedAverageCostBefore: 56.0,
      weightedAverageCostAfter: 59.0,
      prevailingWeightedAverageCostPhp: 59.0,
      gsoTransactionCode: 'DL00001',
      referenceNumber: 'DR-1001',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 'gas_in_1',
      depotId: 'depot_1',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'gasoline',
      transactionType: 'delivery',
      litersDelta: 1000,
      balanceBefore: 2100,
      balanceAfter: 3100,
      deliveryUnitCostPhp: 69.2,
      deliveryTotalAmountPhp: 69200,
      weightedAverageCostBefore: 63.0,
      weightedAverageCostAfter: 65.0,
      prevailingWeightedAverageCostPhp: 65.0,
      gsoTransactionCode: 'DL00002',
      referenceNumber: 'DR-1002',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-10T09:00:00Z',
    },
    {
      id: 'dsl_out_1',
      depotId: 'depot_1',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'diesel',
      transactionType: 'dispense',
      litersDelta: -100,
      balanceBefore: 2000,
      balanceAfter: 1900,
      prevailingWeightedAverageCostPhp: 59.0,
      gsoTransactionCode: 'DS00001',
      tripTicketNumber: '0000001',
      referenceNumber: '0000001',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-11T10:00:00Z',
    },
    {
      id: 'dsl_adj_1',
      depotId: 'depot_1',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'diesel',
      transactionType: 'overage_adjustment',
      litersDelta: 30,
      balanceBefore: 1900,
      balanceAfter: 1930,
      gsoTransactionCode: 'OV00001',
      referenceNumber: 'DIP-OV-1',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-12T08:00:00Z',
    },
    {
      id: 'dsl_adj_pending',
      depotId: 'depot_1',
      depotName: 'GSO Central Fuel Depot',
      fuelType: 'diesel',
      transactionType: 'shrinkage_adjustment',
      litersDelta: -50,
      balanceBefore: 1930,
      balanceAfter: 1930,
      gsoTransactionCode: 'SH00001',
      referenceNumber: 'DIP-SH-1',
      approvalStatus: 'pending_gso_approval',
      ownerId: 'admin',
      createdAt: '2026-11-12T11:00:00Z',
    },
  ];

  const dieselLedger = buildFuelClassLedger({
    fuelType: 'diesel',
    inventoryLogs: logs,
    depots,
  });

  // Only Diesel entries appear, sorted latest-first
  assert.deepEqual(
    dieselLedger.rows.map((r) => r.log.id),
    ['dsl_adj_pending', 'dsl_adj_1', 'dsl_out_1', 'dsl_in_1']
  );

  // Verify chronological running balances & WAC cost on each row
  const rowDelivery = dieselLedger.rows.find((r) => r.log.id === 'dsl_in_1')!;
  assert.equal(rowDelivery.inLiters, 1000);
  assert.equal(rowDelivery.runningVolumeLiters, 2000);
  assert.equal(rowDelivery.effectedWacPhp, 59);
  assert.equal(rowDelivery.transactionCostPhp, 62000);
  assert.equal(rowDelivery.runningCostPhp, 118000);

  const rowDispense = dieselLedger.rows.find((r) => r.log.id === 'dsl_out_1')!;
  assert.equal(rowDispense.outLiters, 100);
  assert.equal(rowDispense.runningVolumeLiters, 1900);
  assert.equal(rowDispense.effectedWacPhp, 59);
  assert.equal(rowDispense.transactionCostPhp, 5900);
  assert.equal(rowDispense.runningCostPhp, 112100);

  const rowOverage = dieselLedger.rows.find((r) => r.log.id === 'dsl_adj_1')!;
  assert.equal(rowOverage.adjustmentLiters, 30);
  assert.equal(rowOverage.runningVolumeLiters, 1930);
  assert.equal(rowOverage.transactionCostPhp, 1770);
  assert.equal(rowOverage.runningCostPhp, 113870);

  const rowPending = dieselLedger.rows.find((r) => r.log.id === 'dsl_adj_pending')!;
  assert.equal(rowPending.isVerified, false);
  assert.equal(rowPending.runningVolumeLiters, 1930); // unverified adjustment does not mutate verified running balance
  assert.equal(rowPending.runningCostPhp, 113870);

  // Summary checks
  assert.equal(dieselLedger.summary.openingVolumeLiters, 1000);
  assert.equal(dieselLedger.summary.totalInLiters, 1000);
  assert.equal(dieselLedger.summary.totalOutLiters, 100);
  assert.equal(dieselLedger.summary.netAdjustmentLiters, 30);
  assert.equal(dieselLedger.summary.closingVolumeLiters, 1930);
  assert.equal(dieselLedger.summary.currentEffectedWacPhp, 59);
  assert.equal(dieselLedger.summary.closingInventoryCostPhp, 113870);
  assert.equal(dieselLedger.summary.verifiedCount, 3);
  assert.equal(dieselLedger.summary.pendingCount, 1);

  // Separate Gasoline ledger contains ONLY gasoline entries
  const gasolineLedger = buildFuelClassLedger({
    fuelType: 'gasoline',
    inventoryLogs: logs,
    depots,
  });
  assert.deepEqual(
    gasolineLedger.rows.map((r) => r.log.id),
    ['gas_in_1']
  );
  assert.equal(gasolineLedger.summary.openingVolumeLiters, 2100);
  assert.equal(gasolineLedger.summary.closingVolumeLiters, 3100);
  assert.equal(gasolineLedger.summary.currentEffectedWacPhp, 65);
  assert.equal(gasolineLedger.summary.closingInventoryCostPhp, 201500);
});

test('pre-delivery dipstick variance adjustment and delivery require separate GSO Head verification approval', () => {
  // 1. Dipstick shrinkage variance (< book) creates shrinkage_adjustment spec
  const shrinkage = buildPreDeliveryDipVarianceAdjustment({
    calculatedDipVolumeLiters: 21500,
    bookVolumeLiters: 21850,
    tankCode: 'UST-GSO-01',
    bolNumber: 'BOL-9901',
    timestampIso: '2026-11-20T09:00:00Z',
  });
  assert.ok(shrinkage);
  assert.equal(shrinkage.transactionType, 'shrinkage_adjustment');
  assert.equal(shrinkage.litersAmount, 350);
  assert.equal(shrinkage.signedVarianceLiters, -350);
  assert.equal(shrinkage.referenceNumber, 'DIP-BOL-9901');

  // 2. Dipstick overage variance (> book) creates overage_adjustment spec
  const overage = buildPreDeliveryDipVarianceAdjustment({
    calculatedDipVolumeLiters: 22125.5,
    bookVolumeLiters: 21850,
    tankCode: 'UST-GSO-01',
    bolNumber: 'BOL-9902',
    timestampIso: '2026-11-20T09:05:00Z',
  });
  assert.ok(overage);
  assert.equal(overage.transactionType, 'overage_adjustment');
  assert.equal(overage.litersAmount, 275.5);
  assert.equal(overage.signedVarianceLiters, 275.5);

  // 3. Exact physical match (< 0.1 L diff) posts no spurious adjustment
  const exact = buildPreDeliveryDipVarianceAdjustment({
    calculatedDipVolumeLiters: 21850.04,
    bookVolumeLiters: 21850,
    tankCode: 'UST-GSO-01',
    bolNumber: 'BOL-9903',
    timestampIso: '2026-11-20T09:10:00Z',
  });
  assert.equal(exact, null);

  // 4. Both pre-delivery adjustment and delivery remain pending_gso_approval when requireSeparateGsoApproval=true
  const adjVerification = resolveDepotTransactionVerification({
    transactionType: 'shrinkage_adjustment',
    actorDisplayName: 'GSO Dispenser',
    gsoTransactionCode: 'SH00002',
    postImmediately: true,
    requireSeparateGsoApproval: true,
  });
  assert.equal(adjVerification.isVerifiedNow, false);
  assert.equal(adjVerification.approvalStatus, 'pending_gso_approval');

  const deliveryVerification = resolveDepotTransactionVerification({
    transactionType: 'delivery',
    actorDisplayName: 'GSO Dispenser',
    gsoTransactionCode: 'DL00005',
    digitalVerificationCode: 'GSO-HD-9012',
    postImmediately: true,
    requireSeparateGsoApproval: true,
  });
  assert.equal(deliveryVerification.isVerifiedNow, false);
  assert.equal(deliveryVerification.approvalStatus, 'pending_gso_approval');
});

test('per-tank WAC isolates differing delivery prices across tanks of the same fuel class and aggregates accurately in ledger', () => {
  const depots: FuelDepot[] = [
    {
      id: 'depot_a',
      name: 'GSO Central Fuel Depot',
      location: 'City Hall',
      gasolineCapacityLiters: 15000,
      gasolineCurrentLiters: 10000,
      dieselCapacityLiters: 50000,
      dieselCurrentLiters: 3000, // Tank 1: 2000 L + Tank 2: 1000 L
      gasolinePricePerLiter: 64.5,
      dieselPricePerLiter: 58.0,
      updatedAt: '2026-11-10T00:00:00Z',
    },
  ];

  const storageTanks: StorageTank[] = [
    {
      id: 'tank_diesel_1',
      depotId: 'depot_a',
      tankCode: 'UST-DSL-01',
      name: 'Main Diesel Tank 1',
      locationZone: 'Bay 1',
      installationType: 'underground_ust',
      material: 'double_wall_fiberglass',
      fuelProduct: 'diesel',
      mappedFuelType: 'diesel',
      connectedDispensers: ['Pump 1'],
      geometry: 'horizontal_cylinder_flat',
      diameterCm: 250,
      lengthCm: 600,
      riserOffsetCm: 0,
      tiltAngleDegrees: 0,
      overfillBufferPct: 5,
      deadstockClearanceCm: 10,
      lowStockAlertLiters: 2000,
      grossCapacityLiters: 25000,
      safeFillCapacityLiters: 23750,
      deadstockVolumeLiters: 500,
      netWorkingVolumeLiters: 23250,
      openingDipLiters: 1000,
      currentBookVolumeLiters: 2000,
      currentWacPhp: 62.0,
      ownerId: 'admin',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-11T00:00:00Z',
    },
    {
      id: 'tank_diesel_2',
      depotId: 'depot_a',
      tankCode: 'UST-DSL-02',
      name: 'Reserve Diesel Tank 2',
      locationZone: 'Bay 2',
      installationType: 'underground_ust',
      material: 'double_wall_fiberglass',
      fuelProduct: 'diesel',
      mappedFuelType: 'diesel',
      connectedDispensers: ['Pump 2'],
      geometry: 'horizontal_cylinder_flat',
      diameterCm: 250,
      lengthCm: 600,
      riserOffsetCm: 0,
      tiltAngleDegrees: 0,
      overfillBufferPct: 5,
      deadstockClearanceCm: 10,
      lowStockAlertLiters: 2000,
      grossCapacityLiters: 25000,
      safeFillCapacityLiters: 23750,
      deadstockVolumeLiters: 500,
      netWorkingVolumeLiters: 23250,
      openingDipLiters: 1000,
      currentBookVolumeLiters: 1000,
      currentWacPhp: 58.0,
      ownerId: 'admin',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  // Delivery ONLY to tank_diesel_1: 1,000 L @ ₱66.00/L added to 1,000 L @ ₱58.00/L -> Tank 1 WAC = ₱62.00/L
  // Tank 2 receives NO delivery -> Tank 2 WAC MUST remain ₱58.00/L!
  const logs: InventoryLog[] = [
    {
      id: 'del_tank1',
      depotId: 'depot_a',
      depotName: 'GSO Central Fuel Depot',
      tankId: 'tank_diesel_1',
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 1000,
      balanceBefore: 1000,
      balanceAfter: 2000,
      deliveryUnitCostPhp: 66.0,
      deliveryTotalAmountPhp: 66000,
      weightedAverageCostBefore: 58.0,
      weightedAverageCostAfter: 62.0,
      prevailingWeightedAverageCostPhp: 62.0,
      gsoTransactionCode: 'DL00001',
      referenceNumber: 'DR-T1-001',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-11T08:00:00Z',
      verifiedAt: '2026-11-11T08:15:00Z',
    },
    {
      id: 'disp_tank2',
      depotId: 'depot_a',
      depotName: 'GSO Central Fuel Depot',
      tankId: 'tank_diesel_2',
      fuelType: 'diesel',
      transactionType: 'dispense',
      litersDelta: -200,
      balanceBefore: 1200,
      balanceAfter: 1000,
      prevailingWeightedAverageCostPhp: 58.0,
      gsoTransactionCode: 'DS00001',
      referenceNumber: '0000001',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-11T10:00:00Z',
      verifiedAt: '2026-11-11T10:00:00Z',
    },
  ];

  // Strict per-tank isolation in resolvePrevailingWeightedAverageCost
  const tank1Wac = resolvePrevailingWeightedAverageCost({
    fuelType: 'diesel',
    timestampIso: '2026-11-11T12:00:00Z',
    inventoryLogs: logs,
    depots,
    storageTanks,
    depotId: 'depot_a',
    tankId: 'tank_diesel_1',
  });
  const tank2Wac = resolvePrevailingWeightedAverageCost({
    fuelType: 'diesel',
    timestampIso: '2026-11-11T12:00:00Z',
    inventoryLogs: logs,
    depots,
    storageTanks,
    depotId: 'depot_a',
    tankId: 'tank_diesel_2',
  });
  assert.equal(tank1Wac, 62.0);
  assert.equal(tank2Wac, 58.0);

  // Volume-weighted depot aggregate WAC: (2000*62 + 1000*58) / 3000 = 182000 / 3000 = 60.6667
  const aggWac = computeAggregateDepotWacFromTanks({
    depotId: 'depot_a',
    fuelType: 'diesel',
    storageTanks,
    fallbackWacPhp: 58.0,
  });
  assert.equal(aggWac, 60.6667);

  // Ledger with All Tanks preserves separate tankBreakdown and exact combined valuation (2000*62 + 1000*58 = 182,000)
  const allDieselLedger = buildFuelClassLedger({
    fuelType: 'diesel',
    inventoryLogs: logs,
    depots,
    storageTanks,
  });
  assert.equal(allDieselLedger.summary.closingVolumeLiters, 3000);
  assert.equal(allDieselLedger.summary.closingInventoryCostPhp, 182000);
  assert.equal(allDieselLedger.summary.tankBreakdown?.length, 2);
  const t1Snap = allDieselLedger.summary.tankBreakdown!.find((t) => t.tankId === 'tank_diesel_1')!;
  const t2Snap = allDieselLedger.summary.tankBreakdown!.find((t) => t.tankId === 'tank_diesel_2')!;
  assert.equal(t1Snap.currentWacPhp, 62.0);
  assert.equal(t1Snap.runningVolumeLiters, 2000);
  assert.equal(t2Snap.currentWacPhp, 58.0);
  assert.equal(t2Snap.runningVolumeLiters, 1000);

  // Single-tank filtered ledger isolates only Tank 2's rows and ₱58.00/L WAC
  const tank2Ledger = buildFuelClassLedger({
    fuelType: 'diesel',
    inventoryLogs: logs,
    depots,
    storageTanks,
    tankId: 'tank_diesel_2',
  });
  assert.deepEqual(tank2Ledger.rows.map((r) => r.log.id), ['disp_tank2']);
  assert.equal(tank2Ledger.summary.currentEffectedWacPhp, 58.0);
  assert.equal(tank2Ledger.summary.closingVolumeLiters, 1000);
  assert.equal(tank2Ledger.summary.closingInventoryCostPhp, 58000);

  // WAC monitoring ledger tags each delivery with its tankCode
  const wacRows = buildWeightedAverageCostLedger(logs, depots, {}, storageTanks);
  assert.equal(wacRows.length, 1);
  assert.equal(wacRows[0].tankId, 'tank_diesel_1');
  assert.equal(wacRows[0].tankCode, 'UST-DSL-01');
  assert.equal(wacRows[0].newPrevailingWacPhp, 62.0);
});




