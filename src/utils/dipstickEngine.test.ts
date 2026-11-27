import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole, FuelDepot, InventoryLog } from '../types/fuel';
import { canViewDepotTankRunningBalances } from './fuelEngine';
import {
  buildDipstickSubmissionPayload,
  buildInitialUstTanks,
  convertDipHeightCmToLiters,
  evaluatePreDeliveryPostingForm,
  evaluateUstDipstickCalculation,
  findMatchingLedgerDeliveryForDipstick,
  OVERFILL_SAFETY_BUFFER_LITERS,
  UST_FUEL_GRADE_STYLES,
} from './dipstickEngine';

const SAMPLE_DEPOTS: FuelDepot[] = [
  {
    id: 'depot-main',
    name: 'Bais City GSO Central Depot',
    location: 'National Highway, Brgy. Hangyad',
    gasolineCapacityLiters: 15000,
    gasolineCurrentLiters: 10420,
    dieselCapacityLiters: 25000,
    dieselCurrentLiters: 21850,
    gasolinePricePerLiter: 64.5,
    dieselPricePerLiter: 58.2,
    lastDipVerifiedBy: 'Engr. Roberto Silva',
    lastDipVerifiedAt: '2026-11-12T08:15:00Z',
    updatedAt: '2026-11-12T08:15:00Z',
  },
  {
    id: 'depot-motorpool',
    name: 'Motorpool Sub-Depot',
    location: 'City Engineering Compound',
    gasolineCapacityLiters: 12000,
    gasolineCurrentLiters: 7200,
    dieselCapacityLiters: 18000,
    dieselCurrentLiters: 12100,
    gasolinePricePerLiter: 64.5,
    dieselPricePerLiter: 58.2,
    lastDipVerifiedBy: 'Engr. Roberto Silva',
    lastDipVerifiedAt: '2026-11-11T16:30:00Z',
    updatedAt: '2026-11-11T16:30:00Z',
  },
];

test('canViewDepotTankRunningBalances permits ONLY admin and gso_head', () => {
  const allRoles: UserRole[] = [
    'admin',
    'gso_head',
    'gso_dispenser',
    'approver',
    'auditor',
    'department_head',
    'requester',
    'pmc_staff',
  ];

  const allowed = allRoles.filter((role) => canViewDepotTankRunningBalances(role));
  assert.deepEqual(allowed, ['admin', 'gso_head']);
  assert.equal(canViewDepotTankRunningBalances('gso_dispenser'), false);
});

test('buildInitialUstTanks creates 4 API color-coded UST tanks synced with depot book stock', () => {
  const tanks = buildInitialUstTanks(SAMPLE_DEPOTS);
  assert.equal(tanks.length, 4);
  assert.deepEqual(
    tanks.map((t) => t.fuelGrade),
    ['diesel', 'regular_91', 'mid_grade', 'premium_95']
  );

  // API Standard Color Codes
  assert.equal(UST_FUEL_GRADE_STYLES.diesel.hex, '#F59E0B');
  assert.equal(UST_FUEL_GRADE_STYLES.regular_91.hex, '#EF4444');
  assert.equal(UST_FUEL_GRADE_STYLES.mid_grade.hex, '#3B82F6');
  assert.equal(UST_FUEL_GRADE_STYLES.premium_95.hex, '#10B981');

  // Tank 1 (Diesel) syncs with primary depot
  assert.equal(tanks[0].tankId, 'UST-01');
  assert.equal(tanks[0].capacityLiters, 25000);
  assert.equal(tanks[0].bookVolumeLiters, 21850);

  // Tank 2 (Regular 91) syncs with primary depot gasoline
  assert.equal(tanks[1].tankId, 'UST-02');
  assert.equal(tanks[1].capacityLiters, 15000);
  assert.equal(tanks[1].bookVolumeLiters, 10420);
});

test('convertDipHeightCmToLiters converts height via strapping chart and clamps to tank capacity', () => {
  assert.equal(
    convertDipHeightCmToLiters({
      dipHeightCm: 190,
      strappingLitersPerCm: 115,
      capacityLiters: 25000,
    }),
    21850
  );

  // Clamp at total capacity
  assert.equal(
    convertDipHeightCmToLiters({
      dipHeightCm: 300,
      strappingLitersPerCm: 115,
      capacityLiters: 25000,
    }),
    25000
  );

  // Clamp negative dip to 0
  assert.equal(
    convertDipHeightCmToLiters({
      dipHeightCm: -5,
      strappingLitersPerCm: 115,
      capacityLiters: 25000,
    }),
    0
  );
});

test('evaluateUstDipstickCalculation flags Re-dip Recommended when variance exceeds ±0.5%', () => {
  const tank = buildInitialUstTanks(SAMPLE_DEPOTS)[0]; // Diesel: 25000L cap, 115 L/cm, 21850L book (190cm exact)

  const withinTolerance = evaluateUstDipstickCalculation({
    tank,
    mode: 'routine_check',
    dipHeightCmInput: '190',
    waterHeightCmInput: '0.0',
    bolNumber: '',
    plannedDropLitersInput: '',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(withinTolerance.calculatedVolumeLiters, 21850);
  assert.equal(withinTolerance.varianceLiters, 0);
  assert.equal(withinTolerance.variancePct, 0);
  assert.equal(withinTolerance.reDipRecommended, false);
  assert.equal(withinTolerance.canSubmit, true);

  const exceedsTolerance = evaluateUstDipstickCalculation({
    tank,
    mode: 'routine_check',
    dipHeightCmInput: '180', // 20700 L vs 21850 L book -> -1150 L (-5.26%)
    waterHeightCmInput: '0.0',
    bolNumber: '',
    plannedDropLitersInput: '',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(exceedsTolerance.calculatedVolumeLiters, 20700);
  assert.equal(exceedsTolerance.varianceLiters, -1150);
  assert.ok(exceedsTolerance.variancePct < -5);
  assert.equal(exceedsTolerance.reDipRecommended, true);
  assert.equal(exceedsTolerance.canSubmit, true);
});

test('evaluateUstDipstickCalculation enforces 500L overfill safety buffer in pre-delivery mode', () => {
  const tank = buildInitialUstTanks(SAMPLE_DEPOTS)[1]; // Regular 91: 15000L cap, 80 L/cm
  // Dip 140 cm -> 11,200 L -> Ullage = 3,800 L -> Max Safe Drop = 3,300 L (3800 - 500)
  assert.equal(OVERFILL_SAFETY_BUFFER_LITERS, 500);

  const overfill = evaluateUstDipstickCalculation({
    tank,
    mode: 'pre_delivery_check',
    dipHeightCmInput: '140',
    waterHeightCmInput: '0.0',
    bolNumber: 'BOL-2026-881',
    plannedDropLitersInput: '4000',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(overfill.calculatedVolumeLiters, 11200);
  assert.equal(overfill.ullageLiters, 3800);
  assert.equal(overfill.maxSafeDropLiters, 3300);
  assert.equal(overfill.overfillStatus, 'overfill_risk');
  assert.equal(overfill.overfillExcessLiters, 700);
  assert.equal(overfill.canSubmit, false);
  assert.match(overfill.blockingReason ?? '', /OVERFILL RISK/i);

  const safe = evaluateUstDipstickCalculation({
    tank,
    mode: 'pre_delivery_check',
    dipHeightCmInput: '140',
    waterHeightCmInput: '0.0',
    bolNumber: 'BOL-2026-881',
    plannedDropLitersInput: '3300',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(safe.overfillStatus, 'safe');
  assert.equal(safe.overfillExcessLiters, 0);
  assert.equal(safe.canSubmit, true);
});

test('evaluateUstDipstickCalculation requires note or photo when water paste exceeds 0.5 cm', () => {
  const tank = buildInitialUstTanks(SAMPLE_DEPOTS)[0];

  const blocked = evaluateUstDipstickCalculation({
    tank,
    mode: 'routine_check',
    dipHeightCmInput: '190',
    waterHeightCmInput: '0.8',
    bolNumber: '',
    plannedDropLitersInput: '',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(blocked.waterAlertTriggered, true);
  assert.equal(blocked.waterConfirmationSatisfied, false);
  assert.equal(blocked.canSubmit, false);

  const confirmedWithNote = evaluateUstDipstickCalculation({
    tank,
    mode: 'routine_check',
    dipHeightCmInput: '190',
    waterHeightCmInput: '0.8',
    bolNumber: '',
    plannedDropLitersInput: '',
    notes: 'Water trace confirmed; sump pump scheduled.',
    hasPhoto: false,
  });
  assert.equal(confirmedWithNote.waterAlertTriggered, true);
  assert.equal(confirmedWithNote.waterConfirmationSatisfied, true);
  assert.equal(confirmedWithNote.canSubmit, true);

  const confirmedWithPhoto = evaluateUstDipstickCalculation({
    tank,
    mode: 'routine_check',
    dipHeightCmInput: '190',
    waterHeightCmInput: '0.8',
    bolNumber: '',
    plannedDropLitersInput: '',
    notes: '',
    hasPhoto: true,
  });
  assert.equal(confirmedWithPhoto.waterConfirmationSatisfied, true);
  assert.equal(confirmedWithPhoto.canSubmit, true);
});

test('buildDipstickSubmissionPayload produces exact 12-field structured JSON schema', () => {
  const tank = buildInitialUstTanks(SAMPLE_DEPOTS)[1];
  const evaluation = evaluateUstDipstickCalculation({
    tank,
    mode: 'pre_delivery_check',
    dipHeightCmInput: '140',
    waterHeightCmInput: '0.2',
    bolNumber: 'bol-2026-881',
    plannedDropLitersInput: '3000',
    notes: '',
    hasPhoto: false,
  });

  const payload = buildDipstickSubmissionPayload({
    tank,
    mode: 'pre_delivery_check',
    bolNumber: 'bol-2026-881',
    plannedDropLiters: 3000,
    dipHeightCm: 140,
    waterHeightCm: 0.2,
    evaluation,
    operatorId: 'gso_depot',
    timestamp: '2026-11-19T10:30:00.000Z',
  });

  assert.deepEqual(Object.keys(payload), [
    'stationId',
    'tankId',
    'logType',
    'bolNumber',
    'plannedDropLiters',
    'dipHeightCm',
    'waterHeightCm',
    'calculatedVolumeLiters',
    'varianceLiters',
    'ullageLiters',
    'operatorId',
    'timestamp',
  ]);
  assert.equal(payload.tankId, 'UST-02');
  assert.equal(payload.logType, 'pre_delivery_check');
  assert.equal(payload.bolNumber, 'BOL-2026-881');
  assert.equal(payload.plannedDropLiters, 3000);
  assert.equal(payload.dipHeightCm, 140);
  assert.equal(payload.waterHeightCm, 0.2);
  assert.equal(payload.calculatedVolumeLiters, 11200);
  assert.equal(payload.varianceLiters, 780);
  assert.equal(payload.ullageLiters, 3800);
  assert.equal(payload.operatorId, 'gso_depot');
});

test('evaluatePreDeliveryPostingForm enforces mandatory delivery fields, overfill guard, and derives unit cost', () => {
  const empty = evaluatePreDeliveryPostingForm({
    volumeLitersInput: '',
    totalAmountPhpInput: '',
    deliveryReceiptRef: '',
    purchaseOrderRef: '',
    supplierName: '',
    deliveryDate: '',
    maxSafeDropLiters: 4000,
  });
  assert.equal(empty.valid, false);
  assert.equal(empty.unitCostPhp, null);
  assert.deepEqual(empty.missingFields, [
    'Delivered Volume (L)',
    'Total Amount (₱)',
    'Delivery Receipt Ref #',
    'Purchase Order Ref #',
    'Supplier / Hauler',
    'Delivery Date',
  ]);

  const overfill = evaluatePreDeliveryPostingForm({
    volumeLitersInput: '4500',
    totalAmountPhpInput: '281250',
    deliveryReceiptRef: 'dr-2026-905',
    purchaseOrderRef: 'po-2026-412',
    supplierName: 'Petron Bulk Depot',
    deliveryDate: '2026-11-20',
    maxSafeDropLiters: 4000,
  });
  assert.equal(overfill.valid, false);
  assert.equal(overfill.overfillExceeded, true);
  assert.match(overfill.blockingReason ?? '', /exceeds verified Max Safe Drop/i);

  const valid = evaluatePreDeliveryPostingForm({
    volumeLitersInput: '2500',
    totalAmountPhpInput: '156250',
    deliveryReceiptRef: '  dr-2026-905 ',
    purchaseOrderRef: ' po-2026-412 ',
    supplierName: ' Petron Bulk Depot ',
    deliveryDate: '2026-11-20',
    gsoVerificationCode: 'GSO-905',
    remarks: 'Seal #88412',
    maxSafeDropLiters: 4000,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.overfillExceeded, false);
  assert.equal(valid.unitCostPhp, 62.5);
  assert.equal(valid.sanitized?.deliveredVolumeLiters, 2500);
  assert.equal(valid.sanitized?.totalAmountPhp, 156250);
  assert.equal(valid.sanitized?.unitCostPhp, 62.5);
  assert.equal(valid.sanitized?.deliveryReceiptRef, 'DR-2026-905');
  assert.equal(valid.sanitized?.purchaseOrderRef, 'PO-2026-412');
  assert.equal(valid.sanitized?.supplierName, 'Petron Bulk Depot');
  assert.equal(valid.sanitized?.deliveryDate, '2026-11-20');
  assert.equal(valid.sanitized?.gsoVerificationCode, 'GSO-905');
});

test('findMatchingLedgerDeliveryForDipstick reconciles dipstick submissions against Depot Ledger Register', () => {
  const logs: InventoryLog[] = [
    {
      id: 'inv_del_1',
      depotId: 'depot-main',
      depotName: 'Bais City GSO Central Depot',
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 2500,
      balanceBefore: 21850,
      balanceAfter: 24350,
      gsoTransactionCode: 'DL00003',
      referenceNumber: 'DR-2026-905',
      purchaseOrderRef: 'PO-2026-412',
      supplierName: 'Petron Bulk Depot',
      deliveryDate: '2026-11-20',
      notes: 'BOL: BOL-2026-881 · PO: PO-2026-412',
      approvalStatus: 'verified',
      ownerId: 'admin',
      createdAt: '2026-11-20T09:00:00Z',
    },
  ];

  // Matches by inventoryLogId
  assert.equal(
    findMatchingLedgerDeliveryForDipstick({
      inventoryLogs: logs,
      inventoryLogId: 'inv_del_1',
    })?.gsoTransactionCode,
    'DL00003'
  );

  // Matches by DR reference (case-insensitive)
  assert.equal(
    findMatchingLedgerDeliveryForDipstick({
      inventoryLogs: logs,
      deliveryReceiptRef: 'dr-2026-905',
      depotId: 'depot-main',
    })?.id,
    'inv_del_1'
  );

  // Matches by BOL note fallback
  assert.equal(
    findMatchingLedgerDeliveryForDipstick({
      inventoryLogs: logs,
      bolNumber: 'BOL-2026-881',
      depotId: 'depot-main',
    })?.id,
    'inv_del_1'
  );

  // Returns null when no delivery exists in Depot Ledger Register
  assert.equal(
    findMatchingLedgerDeliveryForDipstick({
      inventoryLogs: logs,
      deliveryReceiptRef: 'DR-2026-999',
      bolNumber: 'BOL-UNRECORDED',
      depotId: 'depot-main',
    }),
    null
  );
});

