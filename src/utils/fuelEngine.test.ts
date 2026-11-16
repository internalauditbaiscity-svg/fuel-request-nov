import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyReconciliationReport,
  buildDispensingCsvContent,
  calculateFuelLimit,
  canAccessDepartmentRecord,
  canEditOrDeleteRecords,
  canExportDispensingRecords,
  canManageUsers,
  canPreviewAndDownloadPdf,
  canPreviewDispensingFullRecord,
  canUserDeleteRecords,
  canUserEditRecords,
  canViewAuditLogs,
  canViewDailyReconciliation,
  categorizeAndFilterDispensingTickets,
  categorizeDepartmentWorkPlans,
  computeSingleDispenseOutcome,
  computeWorkPlanFuelTotals,
  evaluateTabletopApproval,
  filterVehiclesForTicket,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getMissingTicketMandatoryFields,
  getRemainingInactivityMs,
  hashPassword,
  hasValidPumpReadingProof,
  INACTIVITY_TIMEOUT_MS,
  isSessionExpired,
  isWorkPlanInactive,
  parsePersistedSession,
} from './fuelEngine';
import { FleetVehicle, FuelDepot, InventoryLog, TripTicket, WorkPlan } from '../types/fuel';

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

