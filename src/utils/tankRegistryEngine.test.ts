import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDispenserMappings,
  buildStrappingCurveForTank,
  calculateVolumeFromDip,
  computeAggregateDepotCapacitiesFromTanks,
  computeGeometricVolumeAtHeightLiters,
  computeTankSpecifications,
  computeTankTheoreticalBookStock,
  generateStrappingTable,
  getCalibrationHealthStatus,
  parseCustomStrappingCsv,
  reconcilePumpsAndFuelClassesWithInventoryLogs,
  validateDeliveryAgainstTank,
} from './tankRegistryEngine';
import {
  buildUstTanksFromMasterRegistry,
  evaluateUstDipstickCalculation,
} from './dipstickEngine';
import { SEED_DEPOTS, SEED_INVENTORY_LOGS, SEED_STORAGE_TANKS } from '../data/seedData';
import { InventoryLog, StorageTank } from '../types/fuel';

test('horizontal cylinder (flat ends) computes exact geometric capacity, half-full volume, safe fill, and deadstock', () => {
  // D = 200 cm (R = 100 cm), L = 500 cm => V_gross = pi * 100^2 * 500 / 1000 = 15,707.96 -> 15708.0 L
  const specs = computeTankSpecifications({
    geometry: 'horizontal_cylinder_flat',
    diameterCm: 200,
    lengthCm: 500,
    riserOffsetCm: 15,
    tiltAngleDegrees: 0,
    overfillBufferPct: 5,
    deadstockClearanceCm: 10,
  });

  assert.ok(Math.abs(specs.grossCapacityLiters - 15708.0) < 0.5);
  assert.equal(specs.maxLiquidHeightCm, 200);
  assert.equal(specs.maxRawDipCm, 215);
  assert.ok(Math.abs(specs.safeFillCapacityLiters - specs.grossCapacityLiters * 0.95) < 0.5);
  assert.ok(specs.deadstockVolumeLiters > 0 && specs.deadstockVolumeLiters < 600);
  assert.ok(
    Math.abs(
      specs.netWorkingVolumeLiters - (specs.safeFillCapacityLiters - specs.deadstockVolumeLiters)
    ) < 0.5
  );

  const halfVol = computeGeometricVolumeAtHeightLiters(
    {
      geometry: 'horizontal_cylinder_flat',
      diameterCm: 200,
      lengthCm: 500,
      tiltAngleDegrees: 0,
    },
    100
  );
  assert.ok(Math.abs(halfVol - specs.grossCapacityLiters / 2) < 0.5);
});

test('horizontal cylinder (dished/hemispherical ends), vertical cylinder, and rectangular box compute accurately', () => {
  // Dished ends: D = 200 cm (R = 100), L = 600 cm => barrel = 400 cm + 1 sphere(R=100)
  // V = (pi * 100^2 * 400 + 4/3 * pi * 100^3) / 1000 = 12566.37 + 4188.79 = 16755.16 L
  const dished = computeTankSpecifications({
    geometry: 'horizontal_cylinder_dished',
    diameterCm: 200,
    lengthCm: 600,
    overfillBufferPct: 10,
    deadstockClearanceCm: 0,
  });
  assert.ok(Math.abs(dished.grossCapacityLiters - 16755.2) < 0.5);
  assert.ok(Math.abs(dished.safeFillCapacityLiters - dished.grossCapacityLiters * 0.9) < 0.5);

  // Vertical cylinder: D = 200 cm (R = 100), height (lengthCm) = 300 cm => pi * 100^2 * 300 / 1000 = 9424.8 L
  const vertical = computeTankSpecifications({
    geometry: 'vertical_cylinder',
    diameterCm: 200,
    lengthCm: 300,
    overfillBufferPct: 5,
    deadstockClearanceCm: 15,
  });
  assert.equal(vertical.maxLiquidHeightCm, 300);
  assert.ok(Math.abs(vertical.grossCapacityLiters - 9424.8) < 0.5);
  assert.ok(Math.abs(vertical.deadstockVolumeLiters - 9424.8 * (15 / 300)) < 0.5);

  // Rectangular box: W = 200 cm, L = 400 cm, H = 150 cm => 12,000 L exact
  const rect = computeTankSpecifications({
    geometry: 'rectangular_box',
    diameterCm: 150,
    widthCm: 200,
    lengthCm: 400,
    heightCm: 150,
    overfillBufferPct: 5,
    deadstockClearanceCm: 10,
  });
  assert.equal(rect.maxLiquidHeightCm, 150);
  assert.equal(rect.grossCapacityLiters, 12000);
  assert.equal(rect.safeFillCapacityLiters, 11400);
  assert.equal(rect.deadstockVolumeLiters, 800);
  assert.equal(rect.netWorkingVolumeLiters, 10600);
});

test('calculateVolumeFromDip subtracts riser offset, rejects impossible dip heights, and uses custom CSV override', () => {
  const ust01 = SEED_STORAGE_TANKS.find((t) => t.tankCode === 'UST-GSO-01');
  assert.ok(ust01, 'SEED_STORAGE_TANKS must include UST-GSO-01 for GSO Central Fuel Depot');

  // Valid dip reading with riser offset subtracted
  const rawDip = 100 + ust01.riserOffsetCm;
  const calc = calculateVolumeFromDip(ust01.id, rawDip, SEED_STORAGE_TANKS);
  assert.equal(calc.found, true);
  assert.equal(calc.riserOffsetCm, ust01.riserOffsetCm);
  assert.equal(calc.netHeightCm, 100);
  assert.equal(calc.exceedsMaxHeight, false);
  assert.ok(calc.volumeLiters > 0 && calc.volumeLiters < calc.grossCapacityLiters);
  assert.equal(
    calc.availableUllageLiters,
    Math.round(Math.max(0, calc.safeFillCapacityLiters - calc.volumeLiters) * 10) / 10
  );

  // Lookup by tankCode also works
  const byCode = calculateVolumeFromDip('UST-GSO-01', rawDip, SEED_STORAGE_TANKS);
  assert.equal(byCode.found, true);
  assert.equal(byCode.volumeLiters, calc.volumeLiters);

  // Impossible dip height (> maxLiquidHeightCm + riserOffsetCm)
  const impossible = calculateVolumeFromDip(
    ust01.id,
    calc.maxRawDipCm + 25,
    SEED_STORAGE_TANKS
  );
  assert.equal(impossible.exceedsMaxHeight, true);

  // Custom CSV strapping override interpolation
  const customTank: StorageTank = {
    ...ust01,
    id: 'tank_custom_csv',
    tankCode: 'UST-CSV',
    riserOffsetCm: 10,
    customStrappingPoints: [
      { heightCm: 0, volumeLiters: 0 },
      { heightCm: 50, volumeLiters: 5000 },
      { heightCm: 100, volumeLiters: 12000 },
    ],
  };
  // Raw dip 85 cm - 10 cm riser = 75 cm net -> midpoint between 5000 and 12000 = 8500 L
  const customCalc = calculateVolumeFromDip(customTank.id, 85, [customTank]);
  assert.equal(customCalc.usedCustomCurve, true);
  assert.equal(customCalc.netHeightCm, 75);
  assert.equal(customCalc.volumeLiters, 8500);
});

test('parseCustomStrappingCsv validates headers, monotonicity, and negative inputs', () => {
  const valid = parseCustomStrappingCsv('height_cm,volume_liters\n0,0\n50,4200\n100,9100\n');
  assert.equal(valid.ok, true);
  assert.equal(valid.points.length, 3);
  assert.equal(valid.points[1].volumeLiters, 4200);

  const nonMonotonic = parseCustomStrappingCsv('0,0\n50,5000\n100,4500');
  assert.equal(nonMonotonic.ok, false);
  assert.match(nonMonotonic.error ?? '', /decrease/i);

  const negative = parseCustomStrappingCsv('-5,0\n50,5000');
  assert.equal(negative.ok, false);

  const tooFew = parseCustomStrappingCsv('0,0');
  assert.equal(tooFew.ok, false);
});

test('generateStrappingTable generates 5cm increments with deadstock and overfill zone flags', () => {
  const ust01 = SEED_STORAGE_TANKS.find((t) => t.tankCode === 'UST-GSO-01')!;
  const rows = generateStrappingTable(ust01, 5);
  assert.ok(rows.length >= 20);
  assert.equal(rows[0].heightCm, 0);
  assert.equal(rows[0].rawDipWithRiserCm, ust01.riserOffsetCm);
  assert.equal(rows[0].isDeadstock, true);
  assert.equal(rows[rows.length - 1].isOverfillZone, true);
  assert.equal(rows[rows.length - 1].volumeLiters, ust01.grossCapacityLiters);

  const curve = buildStrappingCurveForTank(ust01, 25);
  assert.equal(curve.mode, 'formula');
  assert.ok(curve.points.length >= 5);
});

test('validateDeliveryAgainstTank blocks Cross-Drop Contamination and Safe-Fill Overfill', () => {
  const ust01 = SEED_STORAGE_TANKS.find((t) => t.tankCode === 'UST-GSO-01')!; // Diesel tank

  // Cross-drop: trying to drop Regular 91 into Diesel tank
  const crossDrop = validateDeliveryAgainstTank({
    tank: ust01,
    deliveryFuelProduct: 'regular_91',
    plannedDropLiters: 1000,
    currentVolumeLiters: 10000,
  });
  assert.equal(crossDrop.ok, false);
  assert.equal(crossDrop.crossDropContamination, true);
  assert.match(crossDrop.errorMessage ?? '', /CROSS-DROP/i);

  // Overfill: drop exceeds safe fill ullage
  const overfill = validateDeliveryAgainstTank({
    tank: ust01,
    deliveryFuelProduct: 'diesel',
    plannedDropLiters: ust01.safeFillCapacityLiters,
    currentVolumeLiters: 10000,
  });
  assert.equal(overfill.ok, false);
  assert.equal(overfill.crossDropContamination, false);
  assert.equal(overfill.overfillRisk, true);
  assert.ok(overfill.excessLiters > 0);

  // Safe drop
  const safe = validateDeliveryAgainstTank({
    tank: ust01,
    deliveryFuelProduct: 'diesel',
    plannedDropLiters: 2000,
    currentVolumeLiters: 10000,
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.errorMessage, null);
});

test('getCalibrationHealthStatus classifies active, expiring_soon, and calibration_due dates', () => {
  const now = '2026-06-01T12:00:00.000Z';
  assert.equal(getCalibrationHealthStatus('2027-01-15', now).status, 'active');
  assert.equal(getCalibrationHealthStatus('2026-06-20', now).status, 'expiring_soon');
  assert.equal(getCalibrationHealthStatus('2026-05-01', now).status, 'calibration_due');
  assert.equal(getCalibrationHealthStatus(undefined, now).status, 'calibration_due');
});

test('computeTankTheoreticalBookStock reconciles Opening Dip + Deliveries - Dispensed', () => {
  const ust01 = SEED_STORAGE_TANKS.find((t) => t.tankCode === 'UST-GSO-01')!;
  const tank: StorageTank = { ...ust01, openingDipLiters: 12000 };

  const logs: InventoryLog[] = [
    {
      id: 'inv_1',
      depotId: tank.depotId,
      depotName: 'GSO Central Fuel Depot',
      tankId: tank.id,
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 5000,
      balanceBefore: 12000,
      balanceAfter: 17000,
      referenceNumber: 'DR-100',
      approvalStatus: 'verified',
      ownerId: 'uid_admin',
      createdAt: '2026-06-01T08:00:00Z',
    },
    {
      id: 'inv_2',
      depotId: tank.depotId,
      depotName: 'Station #042',
      tankId: tank.id,
      pumpId: 'Pump 1A',
      fuelType: 'diesel',
      transactionType: 'dispense',
      litersDelta: -1250,
      balanceBefore: 17000,
      balanceAfter: 15750,
      referenceNumber: '0000101',
      approvalStatus: 'verified',
      ownerId: 'uid_gso',
      createdAt: '2026-06-01T10:00:00Z',
    },
    {
      id: 'inv_3_rejected',
      depotId: tank.depotId,
      depotName: 'Station #042',
      tankId: tank.id,
      fuelType: 'diesel',
      transactionType: 'delivery',
      litersDelta: 9000,
      balanceBefore: 15750,
      balanceAfter: 15750,
      referenceNumber: 'DR-REJ',
      approvalStatus: 'rejected',
      ownerId: 'uid_admin',
      createdAt: '2026-06-01T11:00:00Z',
    },
  ];

  const recon = computeTankTheoreticalBookStock(tank, logs);
  assert.equal(recon.openingDipLiters, 12000);
  assert.equal(recon.deliveriesLiters, 5000);
  assert.equal(recon.dispensedLiters, 1250);
  assert.equal(recon.theoreticalBookLiters, 15750);
});

test('Master Registry dynamically feeds Dipstick Engine, Dispenser Mappings, and Depot Capacities', () => {
  const gsoTanks = SEED_STORAGE_TANKS.filter((t) => t.depotId === 'depot_gso_central');
  assert.equal(gsoTanks.length, 2);

  const mappings = buildDispenserMappings(gsoTanks);
  assert.equal(mappings.length, 4);
  assert.ok(mappings.some((m) => m.pumpId === 'GSO-DSL-1' && m.fuelProduct === 'diesel'));
  assert.ok(mappings.some((m) => m.pumpId === 'GSO-GAS-1' && m.fuelProduct === 'regular_91'));

  const agg = computeAggregateDepotCapacitiesFromTanks('depot_gso_central', SEED_STORAGE_TANKS);
  const gsoDepot = SEED_DEPOTS.find((d) => d.id === 'depot_gso_central')!;
  assert.equal(agg.dieselCapacityLiters, gsoDepot.dieselCapacityLiters);
  assert.equal(agg.gasolineCapacityLiters, gsoDepot.gasolineCapacityLiters);

  const ustRecords = buildUstTanksFromMasterRegistry(gsoTanks, SEED_DEPOTS);
  assert.equal(ustRecords.length, 2);

  // End-to-end dipstick check using Master Registry tank & cross-drop detection
  const ust01Record = ustRecords.find((t) => t.tankId === 'UST-GSO-01')!;
  const crossDropEval = evaluateUstDipstickCalculation({
    tank: ust01Record,
    storageTanks: SEED_STORAGE_TANKS,
    deliveryFuelProduct: 'regular_91',
    mode: 'pre_delivery_check',
    dipHeightCmInput: '135',
    waterHeightCmInput: '0',
    bolNumber: 'BOL-TEST-01',
    plannedDropLitersInput: '2500',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(crossDropEval.crossDropMismatch, true);
  assert.equal(crossDropEval.canSubmit, false);

  const safeEval = evaluateUstDipstickCalculation({
    tank: ust01Record,
    storageTanks: SEED_STORAGE_TANKS,
    deliveryFuelProduct: 'diesel',
    mode: 'pre_delivery_check',
    dipHeightCmInput: '135',
    waterHeightCmInput: '0',
    bolNumber: 'BOL-TEST-01',
    plannedDropLitersInput: '2500',
    notes: '',
    hasPhoto: false,
  });
  assert.equal(safeEval.crossDropMismatch, false);
  assert.equal(safeEval.exceedsMaxHeight, false);
  assert.equal(safeEval.riserOffsetCm, ust01Record.riserOffsetCm);
  assert.equal(safeEval.netLiquidHeightCm, 135 - (ust01Record.riserOffsetCm ?? 0));
  assert.equal(safeEval.overfillStatus, 'safe');
  assert.equal(safeEval.canSubmit, true);
});

test('SEED depots, tanks, pumps, fuel classes, and trial inventory logs are 100% reconciled', () => {
  // System-wide reconciliation
  const allRecon = reconcilePumpsAndFuelClassesWithInventoryLogs(
    SEED_STORAGE_TANKS,
    SEED_INVENTORY_LOGS
  );
  assert.equal(allRecon.totalRegisteredTanks, 4);
  assert.equal(allRecon.totalRegisteredPumps, 6);
  assert.deepEqual(allRecon.registeredFuelClasses, ['diesel', 'gasoline']);
  assert.deepEqual(allRecon.inventoryLogFuelClasses, ['diesel', 'gasoline']);
  assert.equal(allRecon.fuelClassesReconciled, true);
  assert.deepEqual(allRecon.unmappedPumpIdsInLogs, []);
  assert.equal(allRecon.unlinkedLogCount, 0);
  assert.equal(allRecon.isFullyReconciled, true);

  // Per-depot reconciliation & capacity parity
  for (const depot of SEED_DEPOTS) {
    const depotRecon = reconcilePumpsAndFuelClassesWithInventoryLogs(
      SEED_STORAGE_TANKS,
      SEED_INVENTORY_LOGS,
      depot.id
    );
    assert.equal(depotRecon.isFullyReconciled, true, `Depot ${depot.id} must be fully reconciled`);
    assert.equal(depotRecon.unlinkedLogCount, 0);
    assert.deepEqual(depotRecon.unmappedPumpIdsInLogs, []);
    const caps = computeAggregateDepotCapacitiesFromTanks(depot.id, SEED_STORAGE_TANKS);
    assert.equal(depot.dieselCapacityLiters, caps.dieselCapacityLiters);
    assert.equal(depot.gasolineCapacityLiters, caps.gasolineCapacityLiters);
  }

  // Verify GSO-DSL-1 dispense log is attributed to its registered pump
  const gsoDsl1 = allRecon.byPump.find((p) => p.pumpId === 'GSO-DSL-1');
  assert.ok(gsoDsl1);
  assert.equal(gsoDsl1.dispenseCount, 1);
  assert.equal(gsoDsl1.dispensedLiters, 60);

  // Discrepancy detection when an unregistered pump appears in a log
  const badLog: InventoryLog = {
    ...SEED_INVENTORY_LOGS[3],
    id: 'inv_bad_pump',
    pumpId: 'UNREGISTERED-PUMP-99',
  };
  const badRecon = reconcilePumpsAndFuelClassesWithInventoryLogs(
    SEED_STORAGE_TANKS,
    [...SEED_INVENTORY_LOGS, badLog],
    'depot_gso_central'
  );
  assert.equal(badRecon.isFullyReconciled, false);
  assert.deepEqual(badRecon.unmappedPumpIdsInLogs, ['UNREGISTERED-PUMP-99']);
});
