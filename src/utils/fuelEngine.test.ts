import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysIso,
  authenticateLocalUserCredentials,
  buildCredentialLoginPayloadsFromUser,
  buildDailyReconciliationReport,
  buildDispensingCsvContent,
  buildInvitePayloadFromUser,
  calculateFuelLimit,
  canAccessDepartmentRecord,
  canAccessNavSection,
  canDispenseAtGso,
  canEditOrDeleteRecords,
  canExportDispensingRecords,
  canManageUsers,
  canPreviewAndDownloadPdf,
  canPreviewDispensingFullRecord,
  canUserDeleteRecords,
  canUserEditRecords,
  canUserSwitchToLive,
  canViewAuditLogs,
  canViewDailyReconciliation,
  categorizeAndFilterApprovals,
  categorizeAndFilterDispensingTickets,
  categorizeDepartmentWorkPlans,
  computeCredentialProofId,
  computeSingleDispenseOutcome,
  computeWorkPlanFuelTotals,
  deduplicateUsersByEmail,
  evaluateTabletopApproval,
  filterAndCategorizeWorkPrograms,
  filterVehiclesForTicket,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getAllowedNavSections,
  getDefaultNavSection,
  getDynamicProgressiveYearOptions,
  getMissingTicketMandatoryFields,
  getRemainingInactivityMs,
  getWorkPlansForPeriod,
  hashPassword,
  hasValidPumpReadingProof,
  INACTIVITY_TIMEOUT_MS,
  isSessionExpired,
  isWorkPlanInactive,
  mergeClaimedUserProfile,
  normalizeEmailToId,
  parsePersistedSession,
  prepareFirestoreRecordPayload,
  reconcileCollectionRecords,
  replaceYearInProjectCode,
  resolveEffectiveEnvironmentAfterGoogleAuth,
  shiftIsoDateToYear,
  stripUndefinedFields,
  validateWorkProgramMandatoryFilters,
} from './fuelEngine';
import { FleetVehicle, FuelDepot, InventoryLog, TripTicket, UserAccount, WorkPlan } from '../types/fuel';

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

test('getMissingTicketMandatoryFields detects missing mandatory fields and activates only when complete', () => {
  const incomplete = getMissingTicketMandatoryFields({
    vehicleId: 'v1',
    driverName: '   ',
    depotId: 'd1',
    purposeOrProject: '',
    destination: '',
    scheduledDate: '2026-11-13',
    requestedLiters: 0,
  });
  assert.deepEqual(incomplete, [
    'driverName',
    'purposeOrProject',
    'destination',
    'requestedLiters',
  ]);

  const complete = getMissingTicketMandatoryFields({
    vehicleId: 'v1',
    driverName: 'Juan Dela Cruz',
    depotId: 'd1',
    purposeOrProject: 'Road grading maintenance',
    destination: 'Brgy. Mabunao to City Hall',
    scheduledDate: '2026-11-13',
    requestedLiters: 30,
  });
  assert.deepEqual(complete, []);
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
  assert.equal(canExportDispensingRecords('gso_dispenser'), true);
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
  assert.ok(lines[0].startsWith('Ticket Number,Work Plan Number,Category,Department'));
  assert.ok(lines[1].includes('0000001,WP-2026-0001,Dispensed,"City Engineering, ""North"" Office"'));
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

  assert.deepEqual(getAllowedNavSections('gso_head'), ['dispensing', 'inventory']);
  assert.deepEqual(getAllowedNavSections('gso_dispenser'), ['dispensing', 'inventory']);
  assert.equal(getDefaultNavSection('gso_head'), 'dispensing');
  assert.equal(getDefaultNavSection('gso_dispenser'), 'dispensing');

  assert.deepEqual(getAllowedNavSections('approver'), ['approvals']);
  assert.equal(getDefaultNavSection('approver'), 'approvals');

  assert.deepEqual(getAllowedNavSections('admin'), [
    'dashboard',
    'fleet',
    'work_plans',
    'approvals',
    'dispensing',
    'inventory',
    'users',
    'reports',
    'audit',
  ]);
  assert.equal(getDefaultNavSection('admin'), 'dashboard');

  assert.equal(canAccessNavSection('department_head', 'dashboard'), false);
  assert.equal(canAccessNavSection('department_head', 'work_plans'), true);
  assert.equal(canAccessNavSection('gso_head', 'dispensing'), true);
  assert.equal(canAccessNavSection('gso_head', 'inventory'), true);
  assert.equal(canAccessNavSection('gso_head', 'approvals'), false);
  assert.equal(canAccessNavSection('approver', 'approvals'), true);
  assert.equal(canAccessNavSection('approver', 'dispensing'), false);

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









