import { ChangeEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Lock,
  Plus,
  Ruler,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import {
  FuelDepot,
  InventoryLog,
  StorageTank,
  StrappingPoint,
  TankFuelProduct,
  TankGeometryType,
  TankInstallationType,
  TankMaterialType,
  UserAccount,
} from '../types/fuel';
import {
  calculateVolumeFromDip,
  computeTankSpecifications,
  computeTankTheoreticalBookStock,
  generateStrappingTable,
  getCalibrationHealthStatus,
  getTankMaxLiquidHeightCm,
  parseCustomStrappingCsv,
  reconcilePumpsAndFuelClassesWithInventoryLogs,
  TANK_FUEL_PRODUCT_STYLES,
  TANK_GEOMETRY_LABELS,
  TANK_MATERIAL_LABELS,
} from '../utils/tankRegistryEngine';

export interface DepotTankRegistryViewProps {
  depots: FuelDepot[];
  storageTanks: StorageTank[];
  inventoryLogs: InventoryLog[];
  currentUser: UserAccount;
  canViewTankBalances: boolean;
  onSaveDepotInfo: (
    depotId: string,
    updates: Partial<
      Pick<
        FuelDepot,
        | 'siteCode'
        | 'name'
        | 'location'
        | 'coordinates'
        | 'permitNumber'
        | 'calibrationExpiryDate'
        | 'stationManager'
        | 'reorderThresholdPct'
      >
    >
  ) => Promise<void>;
  onSaveStorageTank: (
    tankDraft: Omit<
      StorageTank,
      | 'id'
      | 'mappedFuelType'
      | 'grossCapacityLiters'
      | 'safeFillCapacityLiters'
      | 'deadstockVolumeLiters'
      | 'netWorkingVolumeLiters'
      | 'ownerId'
      | 'createdAt'
      | 'updatedAt'
    >,
    existingTankId?: string
  ) => Promise<StorageTank>;
  onDeleteStorageTank: (tank: StorageTank) => Promise<void>;
}

const FUEL_PRODUCT_OPTIONS: TankFuelProduct[] = [
  'diesel',
  'regular_91',
  'mid_grade',
  'premium_95',
  'kerosene',
  'bio_diesel',
];

const GEOMETRY_OPTIONS: Array<{ value: TankGeometryType; label: string; short: string }> = [
  {
    value: 'horizontal_cylinder_flat',
    label: 'Horizontal Cylinder (Flat Ends)',
    short: 'Horiz. Flat Cyl.',
  },
  {
    value: 'horizontal_cylinder_dished',
    label: 'Horizontal Cylinder (Dished / Hemispherical Ends)',
    short: 'Horiz. Dished Cyl.',
  },
  {
    value: 'vertical_cylinder',
    label: 'Vertical Cylinder',
    short: 'Vertical Cyl.',
  },
  {
    value: 'rectangular_box',
    label: 'Rectangular / Box Tank',
    short: 'Rectangular Box',
  },
];

const BAY_ZONE_SUGGESTIONS = [
  'City Hall Yard Bay 1',
  'City Hall Yard Bay 2',
  'Bulk Storage Yard West',
  'Service Bay Skid Pad',
  'Forecourt Island A',
  'Forecourt Island B',
];

const PUMP_SUGGESTIONS = [
  'GSO-DSL-1',
  'GSO-DSL-2',
  'GSO-GAS-1',
  'GSO-GAS-2',
  'MTP-DSL-1',
  'MTP-GAS-1',
];

function formatNum(value: number, decimals = 1): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDimensionsSummary(tank: StorageTank): string {
  if (tank.geometry === 'rectangular_box') {
    const w = tank.widthCm ?? tank.diameterCm;
    const h = tank.heightCm ?? tank.diameterCm;
    return `${w} × ${tank.lengthCm} × ${h} cm`;
  }
  if (tank.geometry === 'vertical_cylinder') {
    return `Ø ${tank.diameterCm} × H ${tank.lengthCm} cm`;
  }
  return `Ø ${tank.diameterCm} × L ${tank.lengthCm} cm`;
}

export function DepotTankRegistryView({
  depots,
  storageTanks,
  inventoryLogs,
  currentUser,
  canViewTankBalances,
  onSaveDepotInfo,
  onSaveStorageTank,
  onDeleteStorageTank,
}: DepotTankRegistryViewProps) {
  const canEditMasterSpecs = currentUser.role === 'admin' || currentUser.role === 'gso_head';

  const defaultDepotId = useMemo(() => depots[0]?.id ?? '', [depots]);

  const [selectedDepotId, setSelectedDepotId] = useState<string>(defaultDepotId);
  const [activeView, setActiveView] = useState<'directory' | 'form'>('directory');
  const [editingTankId, setEditingTankId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Modals
  const [editDepotOpen, setEditDepotOpen] = useState(false);
  const [strappingModalTank, setStrappingModalTank] = useState<{
    title: string;
    tankCode: string;
    fuelProduct: TankFuelProduct;
    geometry: TankGeometryType;
    diameterCm: number;
    lengthCm: number;
    widthCm?: number;
    heightCm?: number;
    riserOffsetCm: number;
    tiltAngleDegrees: number;
    overfillBufferPct: number;
    deadstockClearanceCm: number;
    customStrappingPoints?: StrappingPoint[];
  } | null>(null);
  const [dispenserModalTank, setDispenserModalTank] = useState<StorageTank | null>(null);
  const [dispenserDraftList, setDispenserDraftList] = useState<string[]>([]);
  const [dispenserQuickInput, setDispenserQuickInput] = useState('');

  // Edit Depot Info form state (streamlined — no address, GPS, or DOE permit clutter)
  const [depotForm, setDepotForm] = useState({
    siteCode: '',
    name: '',
    calibrationExpiryDate: '',
    stationManager: '',
    reorderThresholdPct: 20,
  });

  // View 2: Tank Registration / Edit Form state
  const [dimUnit, setDimUnit] = useState<'cm' | 'mm'>('cm');
  const [tankCode, setTankCode] = useState('');
  const [tankName, setTankName] = useState('');
  const [locationZone, setLocationZone] = useState('City Hall Yard Bay 1');
  const [installationType, setInstallationType] = useState<TankInstallationType>('underground_ust');
  const [material, setMaterial] = useState<TankMaterialType>('double_wall_steel');
  const [fuelProduct, setFuelProduct] = useState<TankFuelProduct>('diesel');
  const [connectedDispensers, setConnectedDispensers] = useState<string[]>([]);
  const [dispenserTagInput, setDispenserTagInput] = useState('');
  const [geometry, setGeometry] = useState<TankGeometryType>('horizontal_cylinder_flat');
  const [diameterCm, setDiameterCm] = useState<number>(240);
  const [lengthCm, setLengthCm] = useState<number>(553);
  const [widthCm, setWidthCm] = useState<number>(220);
  const [heightCm, setHeightCm] = useState<number>(200);
  const [riserOffsetCm, setRiserOffsetCm] = useState<number>(15);
  const [tiltAngleDegrees, setTiltAngleDegrees] = useState<number>(0);
  const [overfillBufferPct, setOverfillBufferPct] = useState<number>(5);
  const [deadstockClearanceCm, setDeadstockClearanceCm] = useState<number>(10);
  const [lowStockAlertLiters, setLowStockAlertLiters] = useState<number>(3500);
  const [calibrationCertificateNo, setCalibrationCertificateNo] = useState<string>('');
  const [calibrationExpiryDate, setCalibrationExpiryDate] = useState<string>('2027-06-30');
  const [openingDipLiters, setOpeningDipLiters] = useState<number>(0);
  const [customCsvText, setCustomCsvText] = useState<string>('');
  const [customStrappingPoints, setCustomStrappingPoints] = useState<StrappingPoint[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [testDipInput, setTestDipInput] = useState<string>('120');
  const [saving, setSaving] = useState(false);

  const activeDepot = useMemo(
    () => depots.find((d) => d.id === selectedDepotId) ?? depots[0],
    [depots, selectedDepotId]
  );

  const depotTanks = useMemo(
    () =>
      storageTanks
        .filter((t) => t.depotId === activeDepot?.id)
        .sort((a, b) => a.tankCode.localeCompare(b.tankCode)),
    [storageTanks, activeDepot?.id]
  );

  const depotPermitHealth = useMemo(
    () => getCalibrationHealthStatus(activeDepot?.calibrationExpiryDate),
    [activeDepot?.calibrationExpiryDate]
  );

  const depotSummary = useMemo(() => {
    let gross = 0;
    let safeFill = 0;
    let deadstock = 0;
    let bookStock = 0;
    const dispensers = new Set<string>();
    for (const t of depotTanks) {
      gross += t.grossCapacityLiters;
      safeFill += t.safeFillCapacityLiters;
      deadstock += t.deadstockVolumeLiters;
      bookStock += t.currentBookVolumeLiters;
      t.connectedDispensers.forEach((p) => dispensers.add(p));
    }
    return {
      tankCount: depotTanks.length,
      grossLiters: Math.round(gross * 10) / 10,
      safeFillLiters: Math.round(safeFill * 10) / 10,
      deadstockLiters: Math.round(deadstock * 10) / 10,
      bookStockLiters: Math.round(bookStock * 10) / 10,
      dispenserCount: dispensers.size,
    };
  }, [depotTanks]);

  const pumpReconciliation = useMemo(
    () => reconcilePumpsAndFuelClassesWithInventoryLogs(storageTanks, inventoryLogs, activeDepot?.id),
    [storageTanks, inventoryLogs, activeDepot?.id]
  );

  // Live computed specs for View 2 form
  const liveFormSpecs = useMemo(
    () =>
      computeTankSpecifications({
        geometry,
        diameterCm,
        lengthCm,
        widthCm: geometry === 'rectangular_box' ? widthCm : undefined,
        heightCm: geometry === 'rectangular_box' ? heightCm : undefined,
        tiltAngleDegrees,
        overfillBufferPct,
        deadstockClearanceCm,
        customStrappingPoints: customStrappingPoints.length >= 2 ? customStrappingPoints : undefined,
      }),
    [
      geometry,
      diameterCm,
      lengthCm,
      widthCm,
      heightCm,
      tiltAngleDegrees,
      overfillBufferPct,
      deadstockClearanceCm,
      customStrappingPoints,
    ]
  );

  // Live test dipstick simulation in View 2 form
  const liveTestDipResult = useMemo(() => {
    const parsed = Number(testDipInput.trim());
    if (testDipInput.trim() === '' || !Number.isFinite(parsed) || parsed < 0) return null;
    const tempTank: StorageTank = {
      id: '__preview__',
      depotId: activeDepot?.id ?? 'preview',
      tankCode: tankCode || 'UST-NEW',
      name: tankName || 'New Tank',
      locationZone,
      installationType,
      material,
      fuelProduct,
      mappedFuelType: TANK_FUEL_PRODUCT_STYLES[fuelProduct].mappedDepotFuelType,
      connectedDispensers,
      geometry,
      diameterCm,
      lengthCm,
      widthCm: geometry === 'rectangular_box' ? widthCm : undefined,
      heightCm: geometry === 'rectangular_box' ? heightCm : undefined,
      riserOffsetCm,
      tiltAngleDegrees,
      overfillBufferPct,
      deadstockClearanceCm,
      lowStockAlertLiters,
      grossCapacityLiters: liveFormSpecs.grossCapacityLiters,
      safeFillCapacityLiters: liveFormSpecs.safeFillCapacityLiters,
      deadstockVolumeLiters: liveFormSpecs.deadstockVolumeLiters,
      netWorkingVolumeLiters: liveFormSpecs.netWorkingVolumeLiters,
      customStrappingPoints: customStrappingPoints.length >= 2 ? customStrappingPoints : undefined,
      openingDipLiters,
      currentBookVolumeLiters: openingDipLiters,
      ownerId: currentUser.uid,
      createdAt: '',
      updatedAt: '',
    };
    return calculateVolumeFromDip('__preview__', parsed, [tempTank]);
  }, [
    testDipInput,
    activeDepot?.id,
    tankCode,
    tankName,
    locationZone,
    installationType,
    material,
    fuelProduct,
    connectedDispensers,
    geometry,
    diameterCm,
    lengthCm,
    widthCm,
    heightCm,
    riserOffsetCm,
    tiltAngleDegrees,
    overfillBufferPct,
    deadstockClearanceCm,
    lowStockAlertLiters,
    liveFormSpecs,
    customStrappingPoints,
    openingDipLiters,
    currentUser.uid,
  ]);

  const strappingModalRows = useMemo(() => {
    if (!strappingModalTank) return [];
    return generateStrappingTable(strappingModalTank, 5);
  }, [strappingModalTank]);

  useEscapeClose(editDepotOpen, () => setEditDepotOpen(false), 2);
  useEscapeClose(Boolean(strappingModalTank), () => setStrappingModalTank(null), 2);
  useEscapeClose(Boolean(dispenserModalTank), () => setDispenserModalTank(null), 2);

  const openEditDepotModal = () => {
    if (!activeDepot) return;
    setDepotForm({
      siteCode: activeDepot.siteCode || '',
      name: activeDepot.name,
      calibrationExpiryDate: activeDepot.calibrationExpiryDate || '',
      stationManager: activeDepot.stationManager || '',
      reorderThresholdPct: activeDepot.reorderThresholdPct ?? 20,
    });
    setEditDepotOpen(true);
  };

  const handleSaveDepotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDepot) return;
    setSaving(true);
    try {
      await onSaveDepotInfo(activeDepot.id, {
        siteCode: depotForm.siteCode,
        name: depotForm.name,
        calibrationExpiryDate: depotForm.calibrationExpiryDate,
        stationManager: depotForm.stationManager,
        reorderThresholdPct: depotForm.reorderThresholdPct,
      });
      setEditDepotOpen(false);
      setFeedback({ type: 'ok', msg: `Updated Depot profile for ${depotForm.name}.` });
    } finally {
      setSaving(false);
    }
  };

  const openAddTankForm = () => {
    const nextNum = depotTanks.length + 1;
    const sitePrefix = (activeDepot?.siteCode || 'UST').split('-')[0] || 'UST';
    setEditingTankId(null);
    setDimUnit('cm');
    setTankCode(`UST-${sitePrefix}-${String(nextNum).padStart(2, '0')}`);
    setTankName(`${activeDepot?.name || 'Depot'} Tank ${nextNum}`);
    setLocationZone(BAY_ZONE_SUGGESTIONS[nextNum % BAY_ZONE_SUGGESTIONS.length]);
    setInstallationType('underground_ust');
    setMaterial('double_wall_steel');
    setFuelProduct('diesel');
    setConnectedDispensers([`${sitePrefix}-DSL-${nextNum}`]);
    setDispenserTagInput('');
    setGeometry('horizontal_cylinder_flat');
    setDiameterCm(220);
    setLengthCm(525);
    setWidthCm(220);
    setHeightCm(200);
    setRiserOffsetCm(15);
    setTiltAngleDegrees(0);
    setOverfillBufferPct(5);
    setDeadstockClearanceCm(10);
    setLowStockAlertLiters(3500);
    setCalibrationCertificateNo(`CAL-2026-${String(nextNum).padStart(2, '0')}`);
    setCalibrationExpiryDate('2027-06-30');
    setOpeningDipLiters(8000);
    setCustomCsvText('');
    setCustomStrappingPoints([]);
    setCsvErrors([]);
    setTestDipInput('120');
    setFeedback(null);
    setActiveView('form');
  };

  const openEditTankForm = (tank: StorageTank) => {
    setEditingTankId(tank.id);
    setDimUnit('cm');
    setTankCode(tank.tankCode);
    setTankName(tank.name);
    setLocationZone(tank.locationZone);
    setInstallationType(tank.installationType);
    setMaterial(tank.material);
    setFuelProduct(tank.fuelProduct);
    setConnectedDispensers([...tank.connectedDispensers]);
    setDispenserTagInput('');
    setGeometry(tank.geometry);
    setDiameterCm(tank.diameterCm);
    setLengthCm(tank.lengthCm);
    setWidthCm(tank.widthCm ?? tank.diameterCm);
    setHeightCm(tank.heightCm ?? tank.diameterCm);
    setRiserOffsetCm(tank.riserOffsetCm);
    setTiltAngleDegrees(tank.tiltAngleDegrees);
    setOverfillBufferPct(tank.overfillBufferPct);
    setDeadstockClearanceCm(tank.deadstockClearanceCm);
    setLowStockAlertLiters(tank.lowStockAlertLiters);
    setCalibrationCertificateNo(tank.calibrationCertificateNo || '');
    setCalibrationExpiryDate(tank.calibrationExpiryDate || '');
    setOpeningDipLiters(tank.currentBookVolumeLiters);
    if (tank.customStrappingPoints && tank.customStrappingPoints.length >= 2) {
      setCustomStrappingPoints(tank.customStrappingPoints);
      setCustomCsvText(
        'height_cm,volume_liters\n' +
          tank.customStrappingPoints.map((p) => `${p.heightCm},${p.volumeLiters}`).join('\n')
      );
    } else {
      setCustomStrappingPoints([]);
      setCustomCsvText('');
    }
    setCsvErrors([]);
    const midDip = Math.round(getTankMaxLiquidHeightCm(tank) * 0.5 + tank.riserOffsetCm);
    setTestDipInput(String(midDip));
    setFeedback(null);
    setActiveView('form');
  };

  const handleAddDispenserTag = (tagValue?: string) => {
    const clean = (tagValue ?? dispenserTagInput).trim();
    if (!clean) return;
    if (!connectedDispensers.includes(clean)) {
      setConnectedDispensers((prev) => [...prev, clean]);
    }
    if (!tagValue) setDispenserTagInput('');
  };

  const handleRemoveDispenserTag = (tag: string) => {
    setConnectedDispensers((prev) => prev.filter((p) => p !== tag));
  };

  const handleParseCsvText = (raw: string) => {
    setCustomCsvText(raw);
    if (!raw.trim()) {
      setCustomStrappingPoints([]);
      setCsvErrors([]);
      return;
    }
    const parsed = parseCustomStrappingCsv(raw);
    setCustomStrappingPoints(parsed.points);
    setCsvErrors(parsed.error ? [parsed.error] : []);
  };

  const handleCsvFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleParseCsvText(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const displayDim = (cmVal: number) =>
    dimUnit === 'mm' ? Math.round(cmVal * 10) : Math.round(cmVal * 10) / 10;

  const parseDimInputToCm = (raw: string): number => {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return dimUnit === 'mm' ? Math.round((num / 10) * 10) / 10 : Math.round(num * 10) / 10;
  };

  const handleSaveTankSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDepot || !tankCode.trim() || !tankName.trim() || !locationZone.trim()) return;
    if (liveFormSpecs.grossCapacityLiters <= 0) return;

    setSaving(true);
    try {
      const existing = editingTankId
        ? storageTanks.find((t) => t.id === editingTankId)
        : undefined;
      const saved = await onSaveStorageTank(
        {
          depotId: activeDepot.id,
          tankCode: tankCode.trim().toUpperCase(),
          name: tankName.trim(),
          locationZone: locationZone.trim(),
          installationType,
          material,
          fuelProduct,
          connectedDispensers,
          geometry,
          diameterCm: Math.max(10, diameterCm),
          lengthCm: Math.max(10, lengthCm),
          widthCm: geometry === 'rectangular_box' ? Math.max(10, widthCm) : undefined,
          heightCm: geometry === 'rectangular_box' ? Math.max(10, heightCm) : undefined,
          riserOffsetCm: Math.max(0, riserOffsetCm),
          tiltAngleDegrees: Math.max(-15, Math.min(15, tiltAngleDegrees)),
          overfillBufferPct: Math.max(0, Math.min(30, overfillBufferPct)),
          deadstockClearanceCm: Math.max(0, Math.min(100, deadstockClearanceCm)),
          lowStockAlertLiters: Math.max(0, lowStockAlertLiters),
          calibrationCertificateNo: calibrationCertificateNo.trim() || undefined,
          calibrationExpiryDate: calibrationExpiryDate.trim() || undefined,
          customStrappingPoints:
            customStrappingPoints.length >= 2 ? customStrappingPoints : undefined,
          openingDipLiters: Math.min(
            liveFormSpecs.grossCapacityLiters,
            Math.max(0, openingDipLiters)
          ),
          currentBookVolumeLiters: existing
            ? Math.min(liveFormSpecs.grossCapacityLiters, existing.currentBookVolumeLiters)
            : Math.min(liveFormSpecs.grossCapacityLiters, Math.max(0, openingDipLiters)),
          lastDipVolumeLiters: existing?.lastDipVolumeLiters ?? openingDipLiters,
          lastDipAt: existing?.lastDipAt ?? new Date().toISOString(),
        },
        editingTankId ?? undefined
      );
      setFeedback({
        type: 'ok',
        msg: `${editingTankId ? 'Updated' : 'Registered'} ${saved.tankCode} (${saved.name}) — Gross ${formatNum(saved.grossCapacityLiters)} L / Safe Fill ${formatNum(saved.safeFillCapacityLiters)} L. All Dipstick, Delivery & Dispensing modules are now synced.`,
      });
      setActiveView('directory');
      setEditingTankId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCurrentTank = async () => {
    if (!editingTankId) return;
    const tank = storageTanks.find((t) => t.id === editingTankId);
    if (!tank) return;
    setSaving(true);
    try {
      await onDeleteStorageTank(tank);
      setFeedback({ type: 'ok', msg: `Removed ${tank.tankCode} (${tank.name}) from Master Registry.` });
      setActiveView('directory');
      setEditingTankId(null);
    } finally {
      setSaving(false);
    }
  };

  const openDispenserModal = (tank: StorageTank) => {
    setDispenserModalTank(tank);
    setDispenserDraftList([...tank.connectedDispensers]);
    setDispenserQuickInput('');
  };

  const handleSaveDispenserMapping = async () => {
    if (!dispenserModalTank) return;
    setSaving(true);
    try {
      await onSaveStorageTank(
        {
          depotId: dispenserModalTank.depotId,
          tankCode: dispenserModalTank.tankCode,
          name: dispenserModalTank.name,
          locationZone: dispenserModalTank.locationZone,
          manholeTag: dispenserModalTank.manholeTag,
          installationType: dispenserModalTank.installationType,
          material: dispenserModalTank.material,
          fuelProduct: dispenserModalTank.fuelProduct,
          connectedDispensers: dispenserDraftList,
          geometry: dispenserModalTank.geometry,
          diameterCm: dispenserModalTank.diameterCm,
          lengthCm: dispenserModalTank.lengthCm,
          widthCm: dispenserModalTank.widthCm,
          heightCm: dispenserModalTank.heightCm,
          riserOffsetCm: dispenserModalTank.riserOffsetCm,
          tiltAngleDegrees: dispenserModalTank.tiltAngleDegrees,
          overfillBufferPct: dispenserModalTank.overfillBufferPct,
          deadstockClearanceCm: dispenserModalTank.deadstockClearanceCm,
          lowStockAlertLiters: dispenserModalTank.lowStockAlertLiters,
          calibrationCertificateNo: dispenserModalTank.calibrationCertificateNo,
          calibrationExpiryDate: dispenserModalTank.calibrationExpiryDate,
          customStrappingPoints: dispenserModalTank.customStrappingPoints,
          openingDipLiters: dispenserModalTank.openingDipLiters,
          currentBookVolumeLiters: dispenserModalTank.currentBookVolumeLiters,
          lastDipVolumeLiters: dispenserModalTank.lastDipVolumeLiters,
          lastDipAt: dispenserModalTank.lastDipAt,
        },
        dispenserModalTank.id
      );
      setFeedback({
        type: 'ok',
        msg: `Updated connected dispenser nozzles for ${dispenserModalTank.tankCode} (${dispenserDraftList.join(', ') || 'None'}).`,
      });
      setDispenserModalTank(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadStrappingCsv = () => {
    if (!strappingModalTank || strappingModalRows.length === 0) return;
    const header = 'net_height_cm,raw_dip_with_riser_cm,volume_liters,fill_pct,zone\n';
    const body = strappingModalRows
      .map(
        (r) =>
          `${r.heightCm},${r.rawDipWithRiserCm},${r.volumeLiters},${r.percentFull},${
            r.isDeadstock ? 'deadstock' : r.isOverfillZone ? 'overfill_buffer' : 'working'
          }`
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${strappingModalTank.tankCode}_Strapping_Chart_5cm.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const productStyle = TANK_FUEL_PRODUCT_STYLES[fuelProduct];

  return (
    <div
      data-testid="depot-tank-registry-view"
      className="rounded-2xl border border-[#D1D5DB] bg-[#F9FAFB] p-3 sm:p-5 text-[#111827] space-y-5"
    >
      {feedback && (
        <div
          role="status"
          data-testid="registry-feedback-banner"
          className={`flex items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-xs sm:text-sm font-bold ${
            feedback.type === 'ok'
              ? 'border-[#059669] bg-[#ECFDF5] text-[#065F46]'
              : 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.msg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded p-1 hover:bg-black/5"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* VIEW 1: DEPOT & TANK REGISTRY DIRECTORY (MASTER OVERVIEW)           */}
      {/* =================================================================== */}
      {activeView === 'directory' && (
        <div data-testid="registry-directory-view" className="space-y-4">
          {/* Streamlined Depot Header & Action Bar */}
          <header className="rounded-xl border border-[#D1D5DB] bg-white p-3.5 sm:p-4 space-y-3.5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1 rounded-md bg-[#111827] px-2 py-1 font-mono text-[11px] font-bold text-white shrink-0">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{activeDepot?.siteCode || 'SITE'}</span>
                </span>
                <label htmlFor="registry-depot-selector" className="sr-only">
                  Select Active Fuel Depot
                </label>
                <select
                  id="registry-depot-selector"
                  data-testid="registry-depot-selector"
                  value={activeDepot?.id ?? ''}
                  onChange={(e) => setSelectedDepotId(e.target.value)}
                  className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] px-2.5 py-1.5 text-sm font-extrabold text-[#111827] focus:border-[#111827] focus:bg-white focus:outline-none max-w-full"
                >
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <span
                  data-testid="depot-cal-status-badge"
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold ${depotPermitHealth.badgeClass}`}
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Cal: {depotPermitHealth.label}
                    {activeDepot?.calibrationExpiryDate
                      ? ` · ${activeDepot.calibrationExpiryDate}`
                      : ''}
                  </span>
                </span>
                {activeDepot?.stationManager && (
                  <span className="text-xs text-[#4B5563]">
                    Custodian: <strong className="text-[#111827]">{activeDepot.stationManager}</strong>
                  </span>
                )}
              </div>

              {canEditMasterSpecs && (
                <div className="grid grid-cols-2 md:flex md:items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="edit-depot-info-btn"
                    onClick={openEditDepotModal}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#111827] bg-white px-3 py-2 text-xs font-bold text-[#111827] hover:bg-[#F3F4F6] min-h-[40px]"
                  >
                    <Edit3 className="h-3.5 w-3.5 shrink-0" />
                    <span>Edit Depot</span>
                  </button>

                  <button
                    type="button"
                    data-testid="add-new-tank-btn"
                    onClick={openAddTankForm}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#111827] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1F2937] min-h-[40px]"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span>Add Tank</span>
                  </button>
                </div>
              )}
            </div>

            {/* Compact 4-Card KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 pt-3 border-t border-[#E5E7EB]">
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                  Tanks &amp; Pumps
                </div>
                <div
                  data-testid="depot-kpi-tank-count"
                  className="mt-0.5 font-mono text-lg font-black tabular-nums text-[#111827]"
                >
                  {depotSummary.tankCount} {depotSummary.tankCount === 1 ? 'Tank' : 'Tanks'}
                </div>
                <div className="text-[11px] text-[#4B5563]">
                  {depotSummary.dispenserCount} {depotSummary.dispenserCount === 1 ? 'pump' : 'pumps'} ·{' '}
                  {pumpReconciliation.registeredFuelClasses.length} fuel{' '}
                  {pumpReconciliation.registeredFuelClasses.length === 1 ? 'class' : 'classes'}
                </div>
              </div>

              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                  Gross Capacity
                </div>
                <div
                  data-testid="depot-kpi-gross-cap"
                  className="mt-0.5 font-mono text-lg font-black tabular-nums text-[#111827]"
                >
                  {formatNum(depotSummary.grossLiters, 0)} L
                </div>
                <div className="text-[11px] text-[#4B5563]">
                  Deadstock: {formatNum(depotSummary.deadstockLiters, 0)} L
                </div>
              </div>

              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                  Max Safe Fill
                </div>
                <div
                  data-testid="depot-kpi-safe-cap"
                  className="mt-0.5 font-mono text-lg font-black tabular-nums text-[#065F46]"
                >
                  {formatNum(depotSummary.safeFillLiters, 0)} L
                </div>
                <div className="text-[11px] text-[#4B5563]">Overfill buffer enforced</div>
              </div>

              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                  Book Stock
                </div>
                {canViewTankBalances ? (
                  <>
                    <div
                      data-testid="depot-kpi-book-stock"
                      className="mt-0.5 font-mono text-lg font-black tabular-nums text-[#111827]"
                    >
                      {formatNum(depotSummary.bookStockLiters, 0)} L
                    </div>
                    <div className="text-[11px] text-[#4B5563]">
                      Synced with Inventory Log
                    </div>
                  </>
                ) : (
                  <div
                    data-testid="depot-kpi-book-restricted"
                    className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-[#4B5563]"
                  >
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>Admin / GSO Head Only</span>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Pump & Fuel Class Reconciliation Strip (Registry vs. Inventory Logs) */}
          <section
            data-testid="pump-reconciliation-panel"
            className="rounded-xl border border-[#D1D5DB] bg-white p-3.5 sm:p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-[#111827] shrink-0" />
                <h3 className="text-xs sm:text-sm font-extrabold text-[#111827]">
                  Pump &amp; Fuel Class Reconciliation (Inventory Log Sync)
                </h3>
              </div>
              <span
                data-testid="pump-reconciliation-status"
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                  pumpReconciliation.isFullyReconciled
                    ? 'border-[#059669] bg-[#ECFDF5] text-[#065F46]'
                    : 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]'
                }`}
              >
                {pumpReconciliation.isFullyReconciled ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Reconciled ({pumpReconciliation.totalRegisteredPumps} Pumps)</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Check Unlinked Logs / Variance</span>
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {pumpReconciliation.byFuelClass.map((fc) => {
                const badgeHex = fc.fuelType === 'diesel' ? '#F59E0B' : '#EF4444';
                return (
                  <div
                    key={fc.fuelType}
                    data-testid={`recon-fuel-${fc.fuelType}`}
                    className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: badgeHex }}
                        />
                        <span className="text-xs font-extrabold text-[#111827]">{fc.label}</span>
                        <span className="font-mono text-[11px] text-[#4B5563]">
                          {fc.tankCount} tank · {fc.pumpCount} {fc.pumpCount === 1 ? 'pump' : 'pumps'}
                        </span>
                      </div>
                      <span
                        className={`font-mono text-[10px] font-bold ${
                          fc.isReconciled ? 'text-[#065F46]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {fc.isReconciled
                          ? 'Matched'
                          : `Var ${fc.varianceLiters > 0 ? '+' : ''}${fc.varianceLiters} L`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {fc.pumpIds.map((pid) => {
                        const pumpStat = pumpReconciliation.byPump.find((p) => p.pumpId === pid);
                        return (
                          <span
                            key={pid}
                            className="inline-flex items-center gap-1 rounded border border-[#D1D5DB] bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-[#111827]"
                          >
                            <span>{pid}</span>
                            {pumpStat && pumpStat.dispensedLiters > 0 && (
                              <span className="text-[#4B5563]">
                                ({formatNum(pumpStat.dispensedLiters, 0)} L)
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] pt-1.5 font-mono text-[10px] text-[#4B5563]">
                      <span>
                        Logs: <strong className="text-[#111827]">{fc.logCount}</strong> · In:{' '}
                        {fc.verifiedDeliveriesLiters > 0
                          ? `+${formatNum(fc.verifiedDeliveriesLiters, 0)}`
                          : '0'}{' '}
                        L · Out:{' '}
                        {fc.dispensedLiters > 0 ? `−${formatNum(fc.dispensedLiters, 0)}` : '0'} L
                      </span>
                      {canViewTankBalances && (
                        <span>
                          Book:{' '}
                          <strong className="text-[#111827]">
                            {formatNum(fc.bookVolumeLiters, 0)} L
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Tank Inventory Directory: Empty State */}
          {depotTanks.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-[#D1D5DB] bg-white p-8 text-center space-y-3">
              <Fuel className="mx-auto h-9 w-9 text-[#6B7280]" />
              <div className="text-sm font-extrabold text-[#111827]">
                No storage tanks registered for {activeDepot?.name}
              </div>
              <p className="text-xs text-[#4B5563] max-w-md mx-auto">
                Register storage tanks with physical dimensions to auto-compute capacities,
                strapping charts, and dispenser reconciliation.
              </p>
              {canEditMasterSpecs && (
                <button
                  type="button"
                  onClick={openAddTankForm}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#111827] px-4 py-2 text-xs font-bold text-white hover:bg-[#1F2937]"
                >
                  <Plus className="h-4 w-4" />
                  <span>Register First Tank</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop Master Registry Table (lg+) */}
              <section className="hidden lg:block rounded-xl border border-[#D1D5DB] bg-white overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2.5">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#111827]">
                    Registered Storage Tanks ({depotTanks.length})
                  </h3>
                  <span className="font-mono text-[11px] text-[#4B5563]">
                    Live Dipstick &amp; Dispenser Source of Truth
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table
                    data-testid="tank-registry-desktop-table"
                    className="w-full text-left text-xs"
                  >
                    <thead className="border-b border-[#D1D5DB] bg-[#F3F4F6] text-[10px] font-extrabold uppercase tracking-wider text-[#374151]">
                      <tr>
                        <th className="px-3 py-2">Tank &amp; Bay</th>
                        <th className="px-2.5 py-2">Fuel Class</th>
                        <th className="px-2.5 py-2">Dimensions</th>
                        <th className="px-2.5 py-2 text-right">Gross / Safe</th>
                        <th className="px-2.5 py-2 text-right">Heel / Net</th>
                        <th className="px-2.5 py-2">Registered Pumps</th>
                        <th className="px-2.5 py-2">Calibration</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {depotTanks.map((tank) => {
                        const style = TANK_FUEL_PRODUCT_STYLES[tank.fuelProduct];
                        const calHealth = getCalibrationHealthStatus(tank.calibrationExpiryDate);
                        const recon = computeTankTheoreticalBookStock(tank, inventoryLogs, depotTanks);

                        return (
                          <tr
                            key={tank.id}
                            data-testid={`registry-tank-row-${tank.tankCode}`}
                            className="hover:bg-[#F9FAFB] align-top"
                          >
                            <td className="px-3 py-2.5 max-w-[200px]">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: style.hex }}
                                />
                                <span className="font-mono text-xs font-black text-[#111827]">
                                  {tank.tankCode}
                                </span>
                                <span className="rounded border border-[#D1D5DB] bg-[#F3F4F6] px-1 py-0.5 font-mono text-[10px] font-bold text-[#374151]">
                                  {tank.installationType === 'underground_ust' ? 'UST' : 'AST'}
                                </span>
                              </div>
                              <div className="mt-0.5 font-bold text-[#111827] leading-snug">
                                {tank.name}
                              </div>
                              <div className="text-[11px] text-[#4B5563] leading-snug">
                                {tank.locationZone}
                              </div>
                              {canViewTankBalances && (
                                <div className="mt-1 font-mono text-[10px] text-[#374151]">
                                  Book:{' '}
                                  <strong className="text-[#111827]">
                                    {formatNum(tank.currentBookVolumeLiters, 0)} L
                                  </strong>{' '}
                                  <span className="text-[#6B7280]">
                                    (Log: {formatNum(recon.theoreticalBookLiters, 0)} L)
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="px-2.5 py-2.5 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${style.badgeBgClass} ${style.badgeTextClass}`}
                              >
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ backgroundColor: style.hex }}
                                />
                                <span>{style.label}</span>
                              </span>
                            </td>

                            <td className="px-2.5 py-2.5 max-w-[165px]">
                              <div className="font-mono text-[11px] font-bold text-[#111827]">
                                {formatDimensionsSummary(tank)}
                              </div>
                              <div className="text-[10px] text-[#4B5563] leading-snug">
                                {TANK_GEOMETRY_LABELS[tank.geometry]}
                              </div>
                              <div className="font-mono text-[10px] text-[#6B7280]">
                                Riser +{tank.riserOffsetCm} cm · Tilt {tank.tiltAngleDegrees}°
                              </div>
                            </td>

                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap font-mono tabular-nums">
                              <div className="font-black text-[#111827]">
                                {formatNum(tank.grossCapacityLiters, 0)} L
                              </div>
                              <div className="text-[11px] font-bold text-[#065F46]">
                                Safe: {formatNum(tank.safeFillCapacityLiters, 0)} L
                              </div>
                            </td>

                            <td className="px-2.5 py-2.5 text-right whitespace-nowrap font-mono tabular-nums">
                              <div className="font-bold text-[#111827]">
                                {formatNum(tank.deadstockVolumeLiters)} L
                              </div>
                              <div className="text-[10px] text-[#4B5563]">
                                Net: {formatNum(tank.netWorkingVolumeLiters, 0)} L
                              </div>
                            </td>

                            <td className="px-2.5 py-2.5">
                              <div className="flex flex-wrap gap-1 max-w-[130px]">
                                {tank.connectedDispensers.length > 0 ? (
                                  tank.connectedDispensers.map((pump) => (
                                    <span
                                      key={pump}
                                      className="rounded border border-[#D1D5DB] bg-[#F9FAFB] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#111827] whitespace-nowrap"
                                    >
                                      {pump}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-[#6B7280]">Unmapped</span>
                                )}
                              </div>
                            </td>

                            <td className="px-2.5 py-2.5 whitespace-nowrap">
                              <span
                                data-testid={`cal-status-${tank.tankCode}`}
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-extrabold ${calHealth.badgeClass}`}
                              >
                                {calHealth.label}
                              </span>
                              {tank.calibrationExpiryDate && (
                                <div className="mt-1 font-mono text-[10px] text-[#4B5563]">
                                  {tank.calibrationExpiryDate}
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  data-testid={`view-strapping-btn-${tank.tankCode}`}
                                  onClick={() =>
                                    setStrappingModalTank({
                                      title: `${tank.tankCode} · ${tank.name}`,
                                      tankCode: tank.tankCode,
                                      fuelProduct: tank.fuelProduct,
                                      geometry: tank.geometry,
                                      diameterCm: tank.diameterCm,
                                      lengthCm: tank.lengthCm,
                                      widthCm: tank.widthCm,
                                      heightCm: tank.heightCm,
                                      riserOffsetCm: tank.riserOffsetCm,
                                      tiltAngleDegrees: tank.tiltAngleDegrees,
                                      overfillBufferPct: tank.overfillBufferPct,
                                      deadstockClearanceCm: tank.deadstockClearanceCm,
                                      customStrappingPoints: tank.customStrappingPoints,
                                    })
                                  }
                                  title="View 5 cm Strapping Chart"
                                  className="inline-flex items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] font-bold text-[#111827] hover:border-[#111827]"
                                >
                                  <FileSpreadsheet className="h-3 w-3 shrink-0" />
                                  <span>Chart</span>
                                </button>

                                {canEditMasterSpecs && (
                                  <>
                                    <button
                                      type="button"
                                      data-testid={`map-dispensers-btn-${tank.tankCode}`}
                                      onClick={() => openDispenserModal(tank)}
                                      title="Map Dispenser Pumps"
                                      className="inline-flex items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] font-bold text-[#111827] hover:border-[#111827]"
                                    >
                                      <Sliders className="h-3 w-3 shrink-0" />
                                      <span>Pumps</span>
                                    </button>
                                    <button
                                      type="button"
                                      data-testid={`edit-specs-btn-${tank.tankCode}`}
                                      onClick={() => openEditTankForm(tank)}
                                      title="Edit Tank Specs"
                                      className="inline-flex items-center gap-1 rounded-md bg-[#111827] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#374151]"
                                    >
                                      <Edit3 className="h-3 w-3 shrink-0" />
                                      <span>Edit</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Streamlined Mobile / Tablet Tank Cards (< lg) */}
              <div
                data-testid="tank-registry-mobile-cards"
                className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:hidden"
              >
                {depotTanks.map((tank) => {
                  const style = TANK_FUEL_PRODUCT_STYLES[tank.fuelProduct];
                  const calHealth = getCalibrationHealthStatus(tank.calibrationExpiryDate);
                  return (
                    <article
                      key={tank.id}
                      data-testid={`registry-tank-card-${tank.tankCode}`}
                      className="overflow-hidden rounded-xl border border-[#D1D5DB] bg-white"
                    >
                      <div className="h-2 w-full" style={{ backgroundColor: style.hex }} />
                      <div className="p-3.5 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-black text-[#111827]">
                                {tank.tankCode}
                              </span>
                              <span className="rounded border border-[#D1D5DB] bg-[#F3F4F6] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#374151]">
                                {tank.installationType === 'underground_ust' ? 'UST' : 'AST'}
                              </span>
                            </div>
                            <h4 className="mt-0.5 text-sm font-extrabold text-[#111827] truncate">
                              {tank.name}
                            </h4>
                            <p className="text-[11px] text-[#4B5563]">{tank.locationZone}</p>
                          </div>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold shrink-0 ${calHealth.badgeClass}`}
                          >
                            {calHealth.label}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-extrabold uppercase ${style.badgeBgClass} ${style.badgeTextClass}`}
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: style.hex }}
                            />
                            <span>{style.label}</span>
                          </span>
                          <span className="font-mono text-[11px] font-bold text-[#374151]">
                            {formatDimensionsSummary(tank)}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-2 font-mono text-xs tabular-nums">
                          <div>
                            <div className="text-[10px] font-sans font-bold uppercase text-[#4B5563]">
                              Gross
                            </div>
                            <div className="font-black text-[#111827]">
                              {formatNum(tank.grossCapacityLiters, 0)} L
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-sans font-bold uppercase text-[#4B5563]">
                              Safe Fill
                            </div>
                            <div className="font-black text-[#065F46]">
                              {formatNum(tank.safeFillCapacityLiters, 0)} L
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-sans font-bold uppercase text-[#4B5563]">
                              {canViewTankBalances ? 'Book' : 'Heel'}
                            </div>
                            <div className="font-bold text-[#111827]">
                              {canViewTankBalances
                                ? `${formatNum(tank.currentBookVolumeLiters, 0)} L`
                                : `${formatNum(tank.deadstockVolumeLiters)} L`}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="font-bold text-[#4B5563]">Pumps:</span>
                          {tank.connectedDispensers.map((pump) => (
                            <span
                              key={pump}
                              className="rounded border border-[#D1D5DB] bg-[#F9FAFB] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#111827]"
                            >
                              {pump}
                            </span>
                          ))}
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-[#E5E7EB]">
                          <button
                            type="button"
                            onClick={() =>
                              setStrappingModalTank({
                                title: `${tank.tankCode} · ${tank.name}`,
                                tankCode: tank.tankCode,
                                fuelProduct: tank.fuelProduct,
                                geometry: tank.geometry,
                                diameterCm: tank.diameterCm,
                                lengthCm: tank.lengthCm,
                                widthCm: tank.widthCm,
                                heightCm: tank.heightCm,
                                riserOffsetCm: tank.riserOffsetCm,
                                tiltAngleDegrees: tank.tiltAngleDegrees,
                                overfillBufferPct: tank.overfillBufferPct,
                                deadstockClearanceCm: tank.deadstockClearanceCm,
                                customStrappingPoints: tank.customStrappingPoints,
                              })
                            }
                            className="min-h-[42px] inline-flex items-center justify-center gap-1 rounded-lg border border-[#D1D5DB] bg-white px-2 text-xs font-bold text-[#111827]"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                            <span>Chart</span>
                          </button>
                          {canEditMasterSpecs && (
                            <>
                              <button
                                type="button"
                                onClick={() => openDispenserModal(tank)}
                                className="min-h-[42px] inline-flex items-center justify-center gap-1 rounded-lg border border-[#D1D5DB] bg-white px-2 text-xs font-bold text-[#111827]"
                              >
                                <Sliders className="h-3.5 w-3.5 shrink-0" />
                                <span>Pumps</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditTankForm(tank)}
                                className="min-h-[42px] inline-flex items-center justify-center gap-1 rounded-lg bg-[#111827] px-2 text-xs font-bold text-white"
                              >
                                <Edit3 className="h-3.5 w-3.5 shrink-0" />
                                <span>Edit</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* VIEW 2: TANK REGISTRATION & DIMENSION SPECIFICATION FORM            */}
      {/* =================================================================== */}
      {activeView === 'form' && (
        <form
          data-testid="tank-spec-form"
          onSubmit={handleSaveTankSubmit}
          className="space-y-4"
        >
          {/* Context Top Bar */}
          <div className="overflow-hidden rounded-xl border-2 border-[#D1D5DB] bg-white">
            <div className="h-2.5 w-full" style={{ backgroundColor: productStyle.hex }} />
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="tank-form-back-btn"
                  onClick={() => {
                    setActiveView('directory');
                    setEditingTankId(null);
                  }}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border-2 border-[#111827] bg-white px-3.5 text-xs font-extrabold text-[#111827] hover:bg-[#F3F4F6]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Directory</span>
                </button>
                <div>
                  <h2 className="text-base sm:text-lg font-black text-[#111827]">
                    {editingTankId
                      ? `Edit Tank Specifications — ${tankCode}`
                      : `Register New Storage Tank — ${activeDepot?.name}`}
                  </h2>
                  <p className="text-xs text-[#4B5563]">
                    Live geometric capacity &amp; strapping calibration engine updates all dipstick,
                    delivery &amp; dispensing modules on save.
                  </p>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 rounded-md border-2 px-3 py-1 text-xs font-extrabold uppercase ${productStyle.badgeBgClass} ${productStyle.badgeTextClass}`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: productStyle.hex }}
                />
                <span>{productStyle.label}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left Column: Specification Sections */}
            <div className="lg:col-span-7 space-y-4">
              {/* 1. Identity & Bay Zone */}
              <section className="rounded-xl border border-[#D1D5DB] bg-white p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2.5">
                  <Building2 className="h-4 w-4 text-[#111827]" />
                  <h3 className="text-sm font-extrabold text-[#111827]">
                    1. Identity &amp; Bay Zone
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tank-code-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Tank ID / Code *
                    </label>
                    <input
                      id="tank-code-input"
                      data-testid="tank-code-input"
                      type="text"
                      required
                      placeholder="e.g. UST-GSO-03"
                      value={tankCode}
                      onChange={(e) => setTankCode(e.target.value)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold uppercase text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="tank-name-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Tank Name *
                    </label>
                    <input
                      id="tank-name-input"
                      data-testid="tank-name-input"
                      type="text"
                      required
                      placeholder="e.g. GSO Central Reserve Diesel UST"
                      value={tankName}
                      onChange={(e) => setTankName(e.target.value)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 text-sm font-semibold text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="tank-zone-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Bay Zone / Tank Pad *
                    </label>
                    <input
                      id="tank-zone-input"
                      data-testid="tank-zone-input"
                      type="text"
                      list="bay-zone-suggestions"
                      required
                      placeholder="e.g. City Hall Yard Bay 1"
                      value={locationZone}
                      onChange={(e) => setLocationZone(e.target.value)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 text-sm text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                    <datalist id="bay-zone-suggestions">
                      {BAY_ZONE_SUGGESTIONS.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label htmlFor="tank-install-select" className="block text-xs font-bold text-[#111827] mb-1">
                      Installation Type
                    </label>
                    <select
                      id="tank-install-select"
                      data-testid="tank-install-select"
                      value={installationType}
                      onChange={(e) => setInstallationType(e.target.value as TankInstallationType)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] bg-white px-3 text-sm font-semibold text-[#111827] focus:border-[#111827] focus:outline-none"
                    >
                      <option value="underground_ust">Underground Storage Tank (UST)</option>
                      <option value="aboveground_ast">Aboveground Storage Tank (AST)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="tank-material-select" className="block text-xs font-bold text-[#111827] mb-1">
                      Tank Material / Wall Type
                    </label>
                    <select
                      id="tank-material-select"
                      value={material}
                      onChange={(e) => setMaterial(e.target.value as TankMaterialType)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] bg-white px-3 text-sm font-semibold text-[#111827] focus:border-[#111827] focus:outline-none"
                    >
                      {(Object.keys(TANK_MATERIAL_LABELS) as TankMaterialType[]).map((mat) => (
                        <option key={mat} value={mat}>
                          {TANK_MATERIAL_LABELS[mat]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* 2. Fuel Type Assignment & Connected Dispensers */}
              <section className="rounded-xl border border-[#D1D5DB] bg-white p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2.5">
                  <Fuel className="h-4 w-4 text-[#111827]" />
                  <h3 className="text-sm font-extrabold text-[#111827]">
                    2. Fuel Product Assignment &amp; Dispenser Mapping
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tank-fuel-product-select" className="block text-xs font-bold text-[#111827] mb-1">
                      Fuel Product Stored *
                    </label>
                    <select
                      id="tank-fuel-product-select"
                      data-testid="tank-fuel-product-select"
                      value={fuelProduct}
                      onChange={(e) => setFuelProduct(e.target.value as TankFuelProduct)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] bg-white px-3 text-sm font-bold text-[#111827] focus:border-[#111827] focus:outline-none"
                    >
                      {FUEL_PRODUCT_OPTIONS.map((fp) => (
                        <option key={fp} value={fp}>
                          {TANK_FUEL_PRODUCT_STYLES[fp].label} ({TANK_FUEL_PRODUCT_STYLES[fp].hex})
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-[#4B5563]">
                      Auto-assigns API color coding ({productStyle.hex}) across Dipstick, Delivery &amp;
                      Cross-Drop checks.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="tank-dispenser-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Connected Dispenser Pumps / Nozzles
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="tank-dispenser-input"
                        data-testid="tank-dispenser-input"
                        type="text"
                        list="pump-suggestions"
                        placeholder="e.g. Pump 1A"
                        value={dispenserTagInput}
                        onChange={(e) => setDispenserTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddDispenserTag();
                          }
                        }}
                        className="min-h-[46px] flex-1 rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-xs font-bold text-[#111827] focus:border-[#111827] focus:outline-none"
                      />
                      <button
                        type="button"
                        data-testid="add-dispenser-tag-btn"
                        onClick={() => handleAddDispenserTag()}
                        className="min-h-[46px] rounded-lg bg-[#111827] px-3.5 text-xs font-bold text-white hover:bg-[#374151]"
                      >
                        Add
                      </button>
                    </div>
                    <datalist id="pump-suggestions">
                      {PUMP_SUGGESTIONS.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {connectedDispensers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {connectedDispensers.map((pump) => (
                      <span
                        key={pump}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#111827] bg-[#F3F4F6] px-2.5 py-1 font-mono text-xs font-bold text-[#111827]"
                      >
                        <span>{pump}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDispenserTag(pump)}
                          aria-label={`Remove ${pump}`}
                          className="rounded hover:bg-black/10 p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* 3. Physical Dimensions & Automated Capacity Engine */}
              <section className="rounded-xl border border-[#D1D5DB] bg-white p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-2.5">
                  <div className="flex items-center gap-2">
                    <Ruler className="h-4 w-4 text-[#111827]" />
                    <h3 className="text-sm font-extrabold text-[#111827]">
                      3. Physical Dimensions &amp; Geometry Engine
                    </h3>
                  </div>

                  {/* cm / mm Unit Toggle */}
                  <div
                    role="group"
                    aria-label="Dimension Units"
                    className="inline-flex rounded-lg border border-[#D1D5DB] bg-[#F3F4F6] p-0.5 text-xs font-bold"
                  >
                    <button
                      type="button"
                      data-testid="unit-toggle-cm"
                      onClick={() => setDimUnit('cm')}
                      className={`rounded-md px-2.5 py-1 ${
                        dimUnit === 'cm' ? 'bg-[#111827] text-white' : 'text-[#374151]'
                      }`}
                    >
                      cm
                    </button>
                    <button
                      type="button"
                      data-testid="unit-toggle-mm"
                      onClick={() => setDimUnit('mm')}
                      className={`rounded-md px-2.5 py-1 ${
                        dimUnit === 'mm' ? 'bg-[#111827] text-white' : 'text-[#374151]'
                      }`}
                    >
                      mm
                    </button>
                  </div>
                </div>

                {/* Geometry Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {GEOMETRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`geometry-opt-${opt.value}`}
                      onClick={() => setGeometry(opt.value)}
                      className={`rounded-lg border-2 px-3 py-2.5 text-left text-xs font-bold transition-colors ${
                        geometry === opt.value
                          ? 'border-[#111827] bg-[#111827] text-white'
                          : 'border-[#D1D5DB] bg-[#F9FAFB] text-[#111827] hover:border-[#6B7280]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Dimensions Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {geometry === 'rectangular_box' ? (
                    <>
                      <div>
                        <label htmlFor="tank-width-input" className="block text-xs font-bold text-[#111827] mb-1">
                          Internal Width ({dimUnit}) *
                        </label>
                        <input
                          id="tank-width-input"
                          data-testid="tank-width-input"
                          type="number"
                          min={dimUnit === 'mm' ? 100 : 10}
                          step="any"
                          required
                          value={displayDim(widthCm)}
                          onChange={(e) => setWidthCm(parseDimInputToCm(e.target.value))}
                          className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="tank-length-input" className="block text-xs font-bold text-[#111827] mb-1">
                          Internal Length ({dimUnit}) *
                        </label>
                        <input
                          id="tank-length-input"
                          data-testid="tank-length-input"
                          type="number"
                          min={dimUnit === 'mm' ? 100 : 10}
                          step="any"
                          required
                          value={displayDim(lengthCm)}
                          onChange={(e) => setLengthCm(parseDimInputToCm(e.target.value))}
                          className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="tank-height-input" className="block text-xs font-bold text-[#111827] mb-1">
                          Internal Height ({dimUnit}) *
                        </label>
                        <input
                          id="tank-height-input"
                          data-testid="tank-height-input"
                          type="number"
                          min={dimUnit === 'mm' ? 100 : 10}
                          step="any"
                          required
                          value={displayDim(heightCm)}
                          onChange={(e) => setHeightCm(parseDimInputToCm(e.target.value))}
                          className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="tank-diameter-input" className="block text-xs font-bold text-[#111827] mb-1">
                          Internal Diameter D ({dimUnit}) *
                        </label>
                        <input
                          id="tank-diameter-input"
                          data-testid="tank-diameter-input"
                          type="number"
                          min={dimUnit === 'mm' ? 100 : 10}
                          step="any"
                          required
                          value={displayDim(diameterCm)}
                          onChange={(e) => setDiameterCm(parseDimInputToCm(e.target.value))}
                          className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="tank-length-input" className="block text-xs font-bold text-[#111827] mb-1">
                          {geometry === 'vertical_cylinder'
                            ? `Cylinder Height H (${dimUnit}) *`
                            : `Internal Length L (${dimUnit}) *`}
                        </label>
                        <input
                          id="tank-length-input"
                          data-testid="tank-length-input"
                          type="number"
                          min={dimUnit === 'mm' ? 100 : 10}
                          step="any"
                          required
                          value={displayDim(lengthCm)}
                          onChange={(e) => setLengthCm(parseDimInputToCm(e.target.value))}
                          className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="tank-riser-input" className="block text-xs font-bold text-[#111827] mb-1">
                          Riser / Manhole Offset (cm)
                        </label>
                        <input
                          id="tank-riser-input"
                          data-testid="tank-riser-input"
                          type="number"
                          min={0}
                          max={500}
                          step="0.5"
                          value={riserOffsetCm}
                          onChange={(e) => setRiserOffsetCm(Math.max(0, Number(e.target.value) || 0))}
                          className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {geometry === 'rectangular_box' && (
                    <div>
                      <label htmlFor="tank-riser-rect-input" className="block text-xs font-bold text-[#111827] mb-1">
                        Riser / Manhole Offset (cm)
                      </label>
                      <input
                        id="tank-riser-rect-input"
                        data-testid="tank-riser-input"
                        type="number"
                        min={0}
                        max={500}
                        step="0.5"
                        value={riserOffsetCm}
                        onChange={(e) => setRiserOffsetCm(Math.max(0, Number(e.target.value) || 0))}
                        className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="tank-tilt-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Tank Tilt / Inclination (°)
                    </label>
                    <input
                      id="tank-tilt-input"
                      type="number"
                      min={-15}
                      max={15}
                      step="0.1"
                      value={tiltAngleDegrees}
                      onChange={(e) => setTiltAngleDegrees(Number(e.target.value) || 0)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="tank-buffer-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Overfill Protection Buffer (%)
                    </label>
                    <input
                      id="tank-buffer-input"
                      data-testid="tank-buffer-input"
                      type="number"
                      min={0}
                      max={30}
                      step="0.5"
                      value={overfillBufferPct}
                      onChange={(e) => setOverfillBufferPct(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="tank-deadstock-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Deadstock Clearance (cm)
                    </label>
                    <input
                      id="tank-deadstock-input"
                      data-testid="tank-deadstock-input"
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={deadstockClearanceCm}
                      onChange={(e) =>
                        setDeadstockClearanceCm(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                      }
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>
                </div>
              </section>

              {/* 4. Thresholds, Calibration & Custom CSV Strapping Override */}
              <section className="rounded-xl border border-[#D1D5DB] bg-white p-4 sm:p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2.5">
                  <ShieldCheck className="h-4 w-4 text-[#111827]" />
                  <h3 className="text-sm font-extrabold text-[#111827]">
                    4. Thresholds, Calibration &amp; Custom Strapping Override
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tank-low-stock-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Low-Stock Reorder Alert (Liters)
                    </label>
                    <input
                      id="tank-low-stock-input"
                      type="number"
                      min={0}
                      step="50"
                      value={lowStockAlertLiters}
                      onChange={(e) => setLowStockAlertLiters(Math.max(0, Number(e.target.value) || 0))}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>

                  {canViewTankBalances && (
                    <div>
                      <label htmlFor="tank-opening-vol-input" className="block text-xs font-bold text-[#111827] mb-1">
                        Opening Dip / Baseline Stock (Liters)
                      </label>
                      <input
                        id="tank-opening-vol-input"
                        data-testid="tank-opening-vol-input"
                        type="number"
                        min={0}
                        max={liveFormSpecs.grossCapacityLiters}
                        step="10"
                        value={openingDipLiters}
                        onChange={(e) => setOpeningDipLiters(Math.max(0, Number(e.target.value) || 0))}
                        className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-sm font-bold tabular-nums text-[#111827] focus:border-[#111827] focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="tank-cal-cert-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Calibration Certificate #
                    </label>
                    <input
                      id="tank-cal-cert-input"
                      type="text"
                      placeholder="e.g. CAL-2026-STA042-04"
                      value={calibrationCertificateNo}
                      onChange={(e) => setCalibrationCertificateNo(e.target.value)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-xs text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="tank-cal-expiry-input" className="block text-xs font-bold text-[#111827] mb-1">
                      Calibration Expiry Date
                    </label>
                    <input
                      id="tank-cal-expiry-input"
                      type="date"
                      value={calibrationExpiryDate}
                      onChange={(e) => setCalibrationExpiryDate(e.target.value)}
                      className="min-h-[46px] w-full rounded-lg border-2 border-[#D1D5DB] px-3 font-mono text-xs text-[#111827] focus:border-[#111827] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Custom Strapping Chart CSV Override */}
                <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-extrabold text-[#111827]">
                        Custom Strapping Chart CSV Override (Optional)
                      </div>
                      <p className="text-[11px] text-[#4B5563]">
                        Upload or paste manufacturer calibration table (<code>height_cm,volume_liters</code>)
                        to override geometric calculations.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-[#111827] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] hover:bg-[#F3F4F6]">
                        <Upload className="h-3.5 w-3.5" />
                        <span>Upload CSV</span>
                        <input
                          type="file"
                          accept=".csv,text/csv,text/plain"
                          onChange={handleCsvFileUpload}
                          className="hidden"
                        />
                      </label>
                      {customCsvText && (
                        <button
                          type="button"
                          onClick={() => handleParseCsvText('')}
                          className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1.5 text-xs font-bold text-[#B91C1C] hover:bg-[#FEF2F2]"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <textarea
                    data-testid="custom-strapping-csv-input"
                    rows={3}
                    placeholder={'height_cm,volume_liters\n0,0\n50,3100\n100,7900\n150,12600\n200,15000'}
                    value={customCsvText}
                    onChange={(e) => handleParseCsvText(e.target.value)}
                    className="w-full rounded-lg border border-[#D1D5DB] bg-white p-2.5 font-mono text-xs text-[#111827] focus:border-[#111827] focus:outline-none"
                  />

                  {customStrappingPoints.length >= 2 && (
                    <div
                      data-testid="custom-csv-active-badge"
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#059669] bg-[#ECFDF5] px-2.5 py-1 text-xs font-bold text-[#065F46]"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>
                        Custom CSV Override Active ({customStrappingPoints.length} calibration points
                        loaded)
                      </span>
                    </div>
                  )}
                  {csvErrors.length > 0 && (
                    <div className="rounded-md border border-[#DC2626] bg-[#FEF2F2] p-2 text-xs font-semibold text-[#991B1B]">
                      {csvErrors.slice(0, 2).join(' ')}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right Column: Live Computed Specifications Card */}
            <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-4">
              <section
                data-testid="live-computed-specs-card"
                className="overflow-hidden rounded-xl border-2 border-[#111827] bg-white shadow-sm"
              >
                <div className="h-2.5 w-full" style={{ backgroundColor: productStyle.hex }} />
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] pb-2.5">
                    <h3 className="text-sm font-black text-[#111827]">
                      Live Computed Specifications
                    </h3>
                    <span className="rounded bg-[#F3F4F6] px-2 py-0.5 font-mono text-[10px] font-bold text-[#374151]">
                      {customStrappingPoints.length >= 2 ? 'CUSTOM CSV' : 'AUTO-GEOMETRY'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                        Gross Geometric Cap
                      </div>
                      <div
                        data-testid="live-spec-gross"
                        className="mt-1 font-mono text-xl font-black tabular-nums text-[#111827]"
                      >
                        {formatNum(liveFormSpecs.grossCapacityLiters)} L
                      </div>
                    </div>

                    <div className="rounded-lg border-2 border-[#059669] bg-[#ECFDF5] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#065F46]">
                        Max Safe Fill ({100 - overfillBufferPct}%)
                      </div>
                      <div
                        data-testid="live-spec-safefill"
                        className="mt-1 font-mono text-xl font-black tabular-nums text-[#065F46]"
                      >
                        {formatNum(liveFormSpecs.safeFillCapacityLiters)} L
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                        Deadstock / Heel ({deadstockClearanceCm} cm)
                      </div>
                      <div
                        data-testid="live-spec-deadstock"
                        className="mt-1 font-mono text-lg font-extrabold tabular-nums text-[#B45309]"
                      >
                        {formatNum(liveFormSpecs.deadstockVolumeLiters)} L
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
                        Net Usable Working Vol
                      </div>
                      <div
                        data-testid="live-spec-working"
                        className="mt-1 font-mono text-lg font-extrabold tabular-nums text-[#111827]"
                      >
                        {formatNum(liveFormSpecs.netWorkingVolumeLiters)} L
                      </div>
                    </div>
                  </div>

                  {/* Max Dip & Riser Summary */}
                  <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[#4B5563] font-semibold">Max Liquid Depth:</span>
                      <span className="font-mono font-bold text-[#111827]">
                        {liveFormSpecs.maxLiquidHeightCm} cm
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#4B5563] font-semibold">
                        Max Raw Dip Height (incl. +{riserOffsetCm} cm riser):
                      </span>
                      <span className="font-mono font-bold text-[#111827]">
                        {Math.round((liveFormSpecs.maxLiquidHeightCm + riserOffsetCm) * 10) / 10} cm
                      </span>
                    </div>
                  </div>

                  {/* Live Dipstick Simulator */}
                  <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="live-test-dip-input" className="text-xs font-extrabold text-[#111827] flex items-center gap-1.5">
                        <Gauge className="h-3.5 w-3.5" />
                        <span>Live Strapping Test Dip (cm)</span>
                      </label>
                      <input
                        id="live-test-dip-input"
                        type="number"
                        min={0}
                        step="1"
                        value={testDipInput}
                        onChange={(e) => setTestDipInput(e.target.value)}
                        className="w-24 rounded border border-[#9CA3AF] bg-white px-2 py-1 text-right font-mono text-xs font-bold text-[#111827]"
                      />
                    </div>
                    {liveTestDipResult && (
                      <div className="font-mono text-[11px] flex flex-wrap items-center justify-between gap-1 text-[#374151]">
                        {liveTestDipResult.exceedsMaxHeight ? (
                          <span className="font-bold text-[#B91C1C]">
                            Exceeds max dip height ({liveTestDipResult.maxRawDipCm} cm)
                          </span>
                        ) : (
                          <>
                            <span>
                              Net {liveTestDipResult.netHeightCm} cm →{' '}
                              <strong className="text-[#111827]">
                                {formatNum(liveTestDipResult.volumeLiters)} L
                              </strong>
                            </span>
                            <span className="text-[#065F46] font-bold">
                              Ullage: {formatNum(liveTestDipResult.availableUllageLiters)} L
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Preview Strapping Table Modal Button */}
                  <button
                    type="button"
                    data-testid="preview-strapping-table-btn"
                    onClick={() =>
                      setStrappingModalTank({
                        title: `${tankCode || 'NEW TANK'} · ${tankName || 'Preview'}`,
                        tankCode: tankCode || 'UST-PREVIEW',
                        fuelProduct,
                        geometry,
                        diameterCm,
                        lengthCm,
                        widthCm: geometry === 'rectangular_box' ? widthCm : undefined,
                        heightCm: geometry === 'rectangular_box' ? heightCm : undefined,
                        riserOffsetCm,
                        tiltAngleDegrees,
                        overfillBufferPct,
                        deadstockClearanceCm,
                        customStrappingPoints:
                          customStrappingPoints.length >= 2 ? customStrappingPoints : undefined,
                      })
                    }
                    className="min-h-[46px] w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-[#111827] bg-white px-4 py-2.5 text-xs font-extrabold text-[#111827] hover:bg-[#F3F4F6]"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>Preview Strapping Table (Every 5 cm)</span>
                  </button>

                  {/* Submit / Cancel / Delete */}
                  <div className="pt-2 border-t border-[#E5E7EB] space-y-2">
                    <button
                      type="submit"
                      data-testid="save-tank-specs-btn"
                      disabled={saving || liveFormSpecs.grossCapacityLiters <= 0}
                      className="min-h-[52px] w-full rounded-xl bg-[#111827] px-5 py-3 text-sm font-black uppercase tracking-wide text-white hover:bg-[#1F2937] disabled:opacity-50"
                    >
                      {saving
                        ? 'Saving to Master Registry...'
                        : editingTankId
                          ? 'Save Tank Specifications'
                          : 'Register Tank in Master Registry'}
                    </button>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView('directory');
                          setEditingTankId(null);
                        }}
                        className="flex-1 rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] px-3 py-2 text-xs font-bold text-[#374151] hover:bg-[#E5E7EB]"
                      >
                        Cancel
                      </button>
                      {editingTankId && (
                        <button
                          type="button"
                          data-testid="delete-tank-btn"
                          onClick={handleDeleteCurrentTank}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#DC2626] bg-[#FEF2F2] px-3 py-2 text-xs font-bold text-[#991B1B] hover:bg-[#FEE2E2]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Remove Tank</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </form>
      )}

      {/* =================================================================== */}
      {/* MODAL 1: EDIT DEPOT INFO                                            */}
      {/* =================================================================== */}
      {editDepotOpen && activeDepot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/60 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Fuel Depot Master Information"
          data-testid="edit-depot-modal"
        >
          <form
            onSubmit={handleSaveDepotSubmit}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border-2 border-[#111827] bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3.5">
              <h3 className="text-sm sm:text-base font-black text-[#111827]">
                Edit Depot Master Information
              </h3>
              <button
                type="button"
                onClick={() => setEditDepotOpen(false)}
                className="rounded-lg p-1.5 text-[#4B5563] hover:bg-[#E5E7EB]"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="depot-site-code" className="block font-bold text-[#111827] mb-1">
                    Site Code
                  </label>
                  <input
                    id="depot-site-code"
                    data-testid="depot-site-code-input"
                    type="text"
                    value={depotForm.siteCode}
                    onChange={(e) => setDepotForm((p) => ({ ...p, siteCode: e.target.value }))}
                    className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 font-mono font-bold uppercase text-[#111827]"
                  />
                </div>
                <div>
                  <label htmlFor="depot-cal-exp" className="block font-bold text-[#111827] mb-1">
                    Calibration Expiry
                  </label>
                  <input
                    id="depot-cal-exp"
                    type="date"
                    value={depotForm.calibrationExpiryDate}
                    onChange={(e) =>
                      setDepotForm((p) => ({ ...p, calibrationExpiryDate: e.target.value }))
                    }
                    className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 font-mono text-[#111827]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="depot-name" className="block font-bold text-[#111827] mb-1">
                  Depot / Station Name *
                </label>
                <input
                  id="depot-name"
                  data-testid="depot-name-input"
                  type="text"
                  required
                  value={depotForm.name}
                  onChange={(e) => setDepotForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 font-semibold text-[#111827]"
                />
              </div>

              <div>
                <label htmlFor="depot-manager" className="block font-bold text-[#111827] mb-1">
                  Station Manager / Custodian
                </label>
                <input
                  id="depot-manager"
                  type="text"
                  value={depotForm.stationManager}
                  onChange={(e) => setDepotForm((p) => ({ ...p, stationManager: e.target.value }))}
                  className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-[#111827]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E5E7EB]">
                <button
                  type="button"
                  onClick={() => setEditDepotOpen(false)}
                  className="rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 font-bold text-[#374151]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="save-depot-info-btn"
                  disabled={saving}
                  className="rounded-lg bg-[#111827] px-4 py-2 font-extrabold text-white hover:bg-[#374151]"
                >
                  {saving ? 'Saving...' : 'Save Depot Info'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: 5 CM STRAPPING CHART MODAL                                 */}
      {/* =================================================================== */}
      {strappingModalTank && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/60 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Tank Strapping Calibration Chart"
          data-testid="strapping-chart-modal"
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border-2 border-[#111827] bg-white shadow-2xl">
            <div
              className="h-2.5 w-full shrink-0"
              style={{ backgroundColor: TANK_FUEL_PRODUCT_STYLES[strappingModalTank.fuelProduct].hex }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
              <div>
                <h3 className="text-sm sm:text-base font-black text-[#111827]">
                  Strapping Calibration Table (5 cm Increments) — {strappingModalTank.title}
                </h3>
                <p className="font-mono text-[11px] text-[#4B5563]">
                  {TANK_GEOMETRY_LABELS[strappingModalTank.geometry]} · Riser Offset: +
                  {strappingModalTank.riserOffsetCm} cm · Tilt:{' '}
                  {strappingModalTank.tiltAngleDegrees}° ·{' '}
                  {strappingModalTank.customStrappingPoints &&
                  strappingModalTank.customStrappingPoints.length >= 2
                    ? 'Custom CSV Override'
                    : 'Exact Geometric Formula'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadStrappingCsv}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#111827] bg-white px-3 py-1.5 text-xs font-bold text-[#111827] hover:bg-[#F3F4F6]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  data-testid="close-strapping-modal-btn"
                  onClick={() => setStrappingModalTank(null)}
                  className="rounded-lg bg-[#111827] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#374151]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="sticky top-0 border-b border-[#D1D5DB] bg-[#F3F4F6] font-sans text-[11px] font-extrabold uppercase text-[#374151]">
                  <tr>
                    <th className="px-4 py-2">Net Depth (cm)</th>
                    <th className="px-4 py-2">Raw Dip w/ Riser (cm)</th>
                    <th className="px-4 py-2 text-right">Volume (Liters)</th>
                    <th className="px-4 py-2 text-right">% Full</th>
                    <th className="px-4 py-2 text-center">Operational Zone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {strappingModalRows.map((row) => (
                    <tr
                      key={row.heightCm}
                      className={
                        row.isDeadstock
                          ? 'bg-[#FFFBEB]'
                          : row.isOverfillZone
                            ? 'bg-[#FEF2F2]'
                            : 'hover:bg-[#F9FAFB]'
                      }
                    >
                      <td className="px-4 py-1.5 font-bold text-[#111827]">{row.heightCm} cm</td>
                      <td className="px-4 py-1.5 text-[#374151]">{row.rawDipWithRiserCm} cm</td>
                      <td className="px-4 py-1.5 text-right font-black text-[#111827]">
                        {formatNum(row.volumeLiters)} L
                      </td>
                      <td className="px-4 py-1.5 text-right text-[#4B5563]">
                        {row.percentFull.toFixed(1)}%
                      </td>
                      <td className="px-4 py-1.5 text-center font-sans text-[10px] font-extrabold uppercase">
                        {row.isDeadstock ? (
                          <span className="rounded bg-[#FEF3C7] px-2 py-0.5 text-[#92400E]">
                            Deadstock Heel
                          </span>
                        ) : row.isOverfillZone ? (
                          <span className="rounded bg-[#FEE2E2] px-2 py-0.5 text-[#991B1B]">
                            Overfill Buffer
                          </span>
                        ) : (
                          <span className="rounded bg-[#ECFDF5] px-2 py-0.5 text-[#065F46]">
                            Safe Working
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: QUICK MAP DISPENSERS MODAL                                 */}
      {/* =================================================================== */}
      {dispenserModalTank && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/60 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Map Connected Dispenser Pumps"
          data-testid="map-dispensers-modal"
        >
          <div className="w-full max-w-md rounded-xl border-2 border-[#111827] bg-white shadow-2xl overflow-hidden">
            <div
              className="h-2 w-full"
              style={{ backgroundColor: TANK_FUEL_PRODUCT_STYLES[dispenserModalTank.fuelProduct].hex }}
            />
            <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
              <div>
                <h3 className="text-sm font-black text-[#111827]">
                  Map Dispenser Nozzles — {dispenserModalTank.tankCode}
                </h3>
                <p className="text-xs text-[#4B5563]">{dispenserModalTank.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDispenserModalTank(null)}
                className="rounded p-1 hover:bg-[#E5E7EB]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  data-testid="quick-dispenser-input"
                  placeholder="Enter pump/nozzle (e.g. Pump 5A)"
                  value={dispenserQuickInput}
                  onChange={(e) => setDispenserQuickInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const clean = dispenserQuickInput.trim();
                      if (clean && !dispenserDraftList.includes(clean)) {
                        setDispenserDraftList((prev) => [...prev, clean]);
                        setDispenserQuickInput('');
                      }
                    }
                  }}
                  className="flex-1 rounded-lg border-2 border-[#D1D5DB] px-3 py-2 font-mono text-xs font-bold text-[#111827]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = dispenserQuickInput.trim();
                    if (clean && !dispenserDraftList.includes(clean)) {
                      setDispenserDraftList((prev) => [...prev, clean]);
                      setDispenserQuickInput('');
                    }
                  }}
                  className="rounded-lg bg-[#111827] px-3 py-2 text-xs font-bold text-white"
                >
                  Add
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {dispenserDraftList.length === 0 ? (
                  <p className="text-xs text-[#6B7280]">No dispenser nozzles mapped yet.</p>
                ) : (
                  dispenserDraftList.map((pump) => (
                    <span
                      key={pump}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#111827] bg-[#F3F4F6] px-2.5 py-1 font-mono text-xs font-bold text-[#111827]"
                    >
                      <span>{pump}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDispenserDraftList((prev) => prev.filter((p) => p !== pump))
                        }
                        className="hover:text-[#B91C1C]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E5E7EB]">
                <button
                  type="button"
                  onClick={() => setDispenserModalTank(null)}
                  className="rounded-lg border border-[#D1D5DB] bg-white px-3.5 py-2 text-xs font-bold text-[#374151]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="save-dispenser-mapping-btn"
                  disabled={saving}
                  onClick={handleSaveDispenserMapping}
                  className="rounded-lg bg-[#111827] px-4 py-2 text-xs font-extrabold text-white"
                >
                  {saving ? 'Saving...' : 'Save Mapping'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
