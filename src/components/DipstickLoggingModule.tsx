import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Droplets,
  Gauge,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  FuelDepot,
  FuelType,
  InventoryLog,
  StorageTank,
  TankFuelProduct,
  UserAccount,
} from '../types/fuel';
import {
  buildDipstickSubmissionPayload,
  buildInitialUstTanks,
  buildUstTanksFromMasterRegistry,
  DipstickLogMode,
  DipstickSubmissionPayload,
  evaluateUstDipstickCalculation,
  findMatchingLedgerDeliveryForDipstick,
  OVERFILL_SAFETY_BUFFER_LITERS,
  PreDeliveryPostingSanitized,
  UST_FUEL_GRADE_STYLES,
  UstTankRecord,
  WATER_ALERT_THRESHOLD_CM,
} from '../utils/dipstickEngine';
import { buildPreDeliveryDipVarianceAdjustment } from '../utils/fuelEngine';
import {
  PostedDipAdjustmentSummary,
  PreDeliveryModalContext,
  PreDeliveryRecordModal,
} from './PreDeliveryRecordModal';

interface PostedDeliveryReceipt {
  inventoryLogId?: string;
  gsoTransactionCode?: string;
  deliveryReceiptRef: string;
  purchaseOrderRef: string;
  supplierName: string;
  deliveryDate: string;
  deliveredVolumeLiters: number;
  totalAmountPhp: number;
  unitCostPhp: number;
  verifiedNow: boolean;
  postedAt: string;
}

interface DipstickSubmissionRecord {
  id: string;
  payload: DipstickSubmissionPayload;
  depotId?: string;
  storageTankId?: string;
  tankNumber: string;
  fuelGrade: UstTankRecord['fuelGrade'];
  stationName: string;
  operatorName: string;
  maxSafeDropLiters: number;
  variancePct: number;
  reDipRecommended: boolean;
  waterAlertTriggered: boolean;
  notes: string;
  photoName?: string;
  photoDataUrl?: string;
  postedDipAdjustment?: PostedDipAdjustmentSummary;
  postedDelivery?: PostedDeliveryReceipt;
}

interface DipstickLoggingModuleProps {
  depots: FuelDepot[];
  storageTanks?: StorageTank[];
  inventoryLogs?: InventoryLog[];
  currentUser: UserAccount;
  canViewRunningBalances: boolean;
  isOnline: boolean;
  syncQueueCount: number;
  onRecordTankDip?: (params: {
    tankId: string;
    calculatedVolumeLiters: number;
    timestampIso: string;
  }) => Promise<void> | void;
  onPostPreDeliveryAdjustment?: (params: {
    depot: FuelDepot;
    fuelType: FuelType;
    tankId?: string;
    transactionType: 'shrinkage_adjustment' | 'overage_adjustment';
    litersAmount: number;
    physicalDipLiters: number;
    referenceNumber: string;
    notes: string;
  }) => Promise<InventoryLog | void>;
  onPostPreDelivery?: (params: {
    depot: FuelDepot;
    fuelType: FuelType;
    tankId?: string;
    litersAmount: number;
    deliveryUnitCostPhp: number;
    deliveryTotalAmountPhp: number;
    physicalDipLiters: number;
    referenceNumber: string;
    purchaseOrderRef: string;
    supplierName: string;
    deliveryDate: string;
    notes: string;
    gsoApproverName?: string;
    digitalVerificationCode?: string;
  }) => Promise<InventoryLog | void>;
  onOpenDepotLedger?: () => void;
  onSubmitDipstickLog?: (params: {
    payload: DipstickSubmissionPayload;
    tank: UstTankRecord;
    notes: string;
    photoName?: string;
  }) => Promise<void> | void;
}

const STORAGE_KEY = 'bais_fuel_ust_dipstick_logs_v1';

const DELIVERY_FUEL_OPTIONS: TankFuelProduct[] = [
  'diesel',
  'regular_91',
  'mid_grade',
  'premium_95',
  'kerosene',
  'bio_diesel',
];

function loadStoredDipstickRecords(): DipstickSubmissionRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DipstickSubmissionRecord[]) : [];
  } catch {
    return [];
  }
}

function saveStoredDipstickRecords(records: DipstickSubmissionRecord[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 30)));
  } catch {
    // Ignore storage quota issues
  }
}

function formatLiters(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatReadableTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function DipstickLoggingModule({
  depots,
  storageTanks = [],
  inventoryLogs = [],
  currentUser,
  canViewRunningBalances,
  isOnline,
  syncQueueCount,
  onRecordTankDip,
  onPostPreDeliveryAdjustment,
  onPostPreDelivery,
  onOpenDepotLedger,
  onSubmitDipstickLog,
}: DipstickLoggingModuleProps) {
  const defaultDepotFilter = useMemo(() => {
    const firstWithTanks = depots.find((d) => storageTanks.some((t) => t.depotId === d.id));
    return firstWithTanks?.id ?? depots[0]?.id ?? 'all';
  }, [depots, storageTanks]);

  const [selectedDepotFilter, setSelectedDepotFilter] = useState<string>(defaultDepotFilter);
  const [logMode, setLogMode] = useState<DipstickLogMode>('routine_check');
  const [activeView, setActiveView] = useState<'tanks' | 'entry' | 'confirmation'>('tanks');
  const [selectedTankKey, setSelectedTankKey] = useState<string | null>(null);
  const [nowClock, setNowClock] = useState<string>(() => new Date().toISOString());

  // Persistent session submissions
  const [submissions, setSubmissions] = useState<DipstickSubmissionRecord[]>(() =>
    typeof window !== 'undefined' ? loadStoredDipstickRecords() : []
  );
  const [lastSubmission, setLastSubmission] = useState<DipstickSubmissionRecord | null>(null);
  const [pendingDeliveryModal, setPendingDeliveryModal] = useState<{
    recordId: string;
    context: PreDeliveryModalContext;
  } | null>(null);

  // Entry form state
  const [lockedTimestamp, setLockedTimestamp] = useState<string>('');
  const [bolNumber, setBolNumber] = useState<string>('');
  const [plannedDropInput, setPlannedDropInput] = useState<string>('');
  const [deliveryFuelProduct, setDeliveryFuelProduct] = useState<TankFuelProduct>('diesel');
  const [dipHeightInput, setDipHeightInput] = useState<string>('');
  const [waterHeightInput, setWaterHeightInput] = useState<string>('0.0');
  const [notes, setNotes] = useState<string>('');
  const [photoName, setPhotoName] = useState<string>('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showJsonPayload, setShowJsonPayload] = useState<boolean>(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowClock(new Date().toISOString());
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Build tanks dynamically from the Master Registry (Single Source of Truth)
  const allTanks = useMemo<UstTankRecord[]>(() => {
    const base =
      storageTanks.length > 0
        ? buildUstTanksFromMasterRegistry(storageTanks, depots)
        : buildInitialUstTanks(depots);
    return base.map((tank) => {
      const latestForTank = submissions.find(
        (rec) => rec.payload.tankId === tank.tankId && rec.payload.stationId === tank.stationId
      );
      if (!latestForTank) return tank;
      return {
        ...tank,
        lastRecordedVolumeLiters: latestForTank.payload.calculatedVolumeLiters,
        lastRecordedAt: latestForTank.payload.timestamp,
      };
    });
  }, [storageTanks, depots, submissions]);

  const tanks = useMemo<UstTankRecord[]>(() => {
    if (selectedDepotFilter === 'all' || storageTanks.length === 0) return allTanks;
    const filtered = allTanks.filter((t) => t.depotId === selectedDepotFilter);
    return filtered.length > 0 ? filtered : allTanks;
  }, [allTanks, selectedDepotFilter, storageTanks.length]);

  const selectedTank = useMemo(
    () =>
      allTanks.find(
        (t) => (t.storageTankId ?? t.tankId) === selectedTankKey || t.tankId === selectedTankKey
      ) ?? null,
    [allTanks, selectedTankKey]
  );

  const activeDepotObj = useMemo(
    () => depots.find((d) => d.id === selectedDepotFilter) ?? depots[0],
    [depots, selectedDepotFilter]
  );

  const stationName =
    activeDepotObj?.name || tanks[0]?.stationName || 'Bais City GSO Central Depot';
  const stationId = activeDepotObj?.siteCode || tanks[0]?.stationId || 'STA-BAIS-01';

  const evaluation = useMemo(() => {
    if (!selectedTank) return null;
    return evaluateUstDipstickCalculation({
      tank: selectedTank,
      storageTanks,
      deliveryFuelProduct: logMode === 'pre_delivery_check' ? deliveryFuelProduct : undefined,
      mode: logMode,
      dipHeightCmInput: dipHeightInput,
      waterHeightCmInput: waterHeightInput,
      bolNumber,
      plannedDropLitersInput: plannedDropInput,
      notes,
      hasPhoto: Boolean(photoDataUrl || photoName),
    });
  }, [
    selectedTank,
    storageTanks,
    deliveryFuelProduct,
    logMode,
    dipHeightInput,
    waterHeightInput,
    bolNumber,
    plannedDropInput,
    notes,
    photoDataUrl,
    photoName,
  ]);

  const handleSelectTank = (tank: UstTankRecord) => {
    setSelectedTankKey(tank.storageTankId ?? tank.tankId);
    setLockedTimestamp(new Date().toISOString());
    setBolNumber('');
    setPlannedDropInput('');
    setDeliveryFuelProduct(tank.fuelGrade);
    setDipHeightInput('');
    setWaterHeightInput('0.0');
    setNotes('');
    setPhotoName('');
    setPhotoDataUrl('');
    setActiveView('entry');
  };

  const handleBackToTanks = () => {
    setActiveView('tanks');
    setSelectedTankKey(null);
  };

  const handlePhotoSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearPhoto = () => {
    setPhotoName('');
    setPhotoDataUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmitReading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTank || !evaluation || !evaluation.canSubmit) return;

    const timestamp = lockedTimestamp || new Date().toISOString();
    const parsedDip = Number(dipHeightInput.trim());
    const parsedWater = waterHeightInput.trim() === '' ? 0 : Number(waterHeightInput.trim());
    const parsedDrop =
      logMode === 'pre_delivery_check' && plannedDropInput.trim() !== ''
        ? Number(plannedDropInput.trim())
        : null;

    const payload = buildDipstickSubmissionPayload({
      tank: selectedTank,
      mode: logMode,
      bolNumber,
      plannedDropLiters: parsedDrop,
      dipHeightCm: Number.isFinite(parsedDip) ? parsedDip : 0,
      waterHeightCm: Number.isFinite(parsedWater) ? parsedWater : 0,
      evaluation,
      operatorId: currentUser.username || currentUser.uid,
      timestamp,
    });

    setSubmitting(true);
    try {
      if (selectedTank.storageTankId && onRecordTankDip) {
        await onRecordTankDip({
          tankId: selectedTank.storageTankId,
          calculatedVolumeLiters: evaluation.calculatedVolumeLiters,
          timestampIso: timestamp,
        });
      }

      if (onSubmitDipstickLog) {
        await onSubmitDipstickLog({
          payload,
          tank: selectedTank,
          notes: notes.trim(),
          photoName: photoName || undefined,
        });
      }

      let postedDipAdjustment: PostedDipAdjustmentSummary | undefined;
      if (logMode === 'pre_delivery_check' && onPostPreDeliveryAdjustment) {
        const dipVarianceSpec = buildPreDeliveryDipVarianceAdjustment({
          calculatedDipVolumeLiters: payload.calculatedVolumeLiters,
          bookVolumeLiters: selectedTank.bookVolumeLiters,
          tankCode: selectedTank.tankId,
          bolNumber: payload.bolNumber,
          timestampIso: timestamp,
        });
        if (dipVarianceSpec) {
          const targetDepot =
            (selectedTank.depotId ? depots.find((d) => d.id === selectedTank.depotId) : undefined) ??
            depots[0];
          if (targetDepot) {
            const mappedFuelType =
              UST_FUEL_GRADE_STYLES[selectedTank.fuelGrade].mappedDepotFuelType;
            const adjLog = await onPostPreDeliveryAdjustment({
              depot: targetDepot,
              fuelType: mappedFuelType,
              tankId: selectedTank.storageTankId,
              transactionType: dipVarianceSpec.transactionType,
              litersAmount: dipVarianceSpec.litersAmount,
              physicalDipLiters: payload.calculatedVolumeLiters,
              referenceNumber: dipVarianceSpec.referenceNumber,
              notes: notes.trim()
                ? `${dipVarianceSpec.notes} · Operator Note: ${notes.trim()}`.slice(0, 400)
                : dipVarianceSpec.notes,
            });
            postedDipAdjustment = {
              inventoryLogId: adjLog?.id,
              gsoTransactionCode: adjLog?.gsoTransactionCode,
              transactionType: dipVarianceSpec.transactionType,
              signedVarianceLiters: dipVarianceSpec.signedVarianceLiters,
              referenceNumber: dipVarianceSpec.referenceNumber,
            };
          }
        }
      }

      const record: DipstickSubmissionRecord = {
        id: `dip-${Date.now()}`,
        payload,
        depotId: selectedTank.depotId,
        storageTankId: selectedTank.storageTankId,
        tankNumber: selectedTank.tankNumber,
        fuelGrade: selectedTank.fuelGrade,
        stationName: selectedTank.stationName,
        operatorName: currentUser.displayName,
        maxSafeDropLiters: evaluation.maxSafeDropLiters,
        variancePct: evaluation.variancePct,
        reDipRecommended: evaluation.reDipRecommended,
        waterAlertTriggered: evaluation.waterAlertTriggered,
        notes: notes.trim(),
        photoName: photoName || undefined,
        photoDataUrl: photoDataUrl || undefined,
        ...(postedDipAdjustment ? { postedDipAdjustment } : {}),
      };

      const nextRecords = [record, ...submissions].slice(0, 30);
      setSubmissions(nextRecords);
      saveStoredDipstickRecords(
        nextRecords.map((item) => ({
          ...item,
          photoDataUrl:
            item.photoDataUrl && item.photoDataUrl.length < 100000 ? item.photoDataUrl : undefined,
        }))
      );
      setLastSubmission(record);
      setActiveView('confirmation');

      if (logMode === 'pre_delivery_check') {
        setPendingDeliveryModal({
          recordId: record.id,
          context: {
            depotId: selectedTank.depotId,
            depotName: selectedTank.stationName,
            tankId: selectedTank.tankId,
            storageTankId: selectedTank.storageTankId,
            tankNumber: selectedTank.tankNumber,
            fuelGrade: selectedTank.fuelGrade,
            bolNumber: payload.bolNumber,
            plannedDropLiters: payload.plannedDropLiters,
            calculatedDipVolumeLiters: payload.calculatedVolumeLiters,
            maxSafeDropLiters: evaluation.maxSafeDropLiters,
            dipHeightCm: payload.dipHeightCm,
            waterHeightCm: payload.waterHeightCm,
            preDeliveryNotes: notes.trim(),
            timestamp,
            postedDipAdjustment: postedDipAdjustment ?? null,
          },
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostDelivery = async (sanitized: PreDeliveryPostingSanitized) => {
    if (!pendingDeliveryModal) return;
    if (!onPostPreDelivery) {
      throw new Error('Depot Ledger Register posting handler is unavailable.');
    }
    const { recordId, context } = pendingDeliveryModal;
    const targetDepot =
      (context.depotId ? depots.find((d) => d.id === context.depotId) : undefined) ?? depots[0];
    if (!targetDepot) {
      throw new Error('No registered fuel depot is available to post this delivery.');
    }

    const mappedFuelType = UST_FUEL_GRADE_STYLES[context.fuelGrade].mappedDepotFuelType;
    const noteParts = [
      context.bolNumber ? `BOL: ${context.bolNumber}` : '',
      `PO: ${sanitized.purchaseOrderRef}`,
      `Supplier: ${sanitized.supplierName}`,
      `Date: ${sanitized.deliveryDate}`,
      sanitized.remarks,
    ].filter(Boolean);
    const combinedNotes = noteParts.join(' · ').slice(0, 400);

    const postedLog = await onPostPreDelivery({
      depot: targetDepot,
      fuelType: mappedFuelType,
      tankId: context.storageTankId,
      litersAmount: sanitized.deliveredVolumeLiters,
      deliveryUnitCostPhp: sanitized.unitCostPhp,
      deliveryTotalAmountPhp: sanitized.totalAmountPhp,
      physicalDipLiters: context.calculatedDipVolumeLiters,
      referenceNumber: sanitized.deliveryReceiptRef,
      purchaseOrderRef: sanitized.purchaseOrderRef,
      supplierName: sanitized.supplierName,
      deliveryDate: sanitized.deliveryDate,
      notes: combinedNotes,
      gsoApproverName: currentUser.displayName,
    });

    const postedReceipt: PostedDeliveryReceipt = {
      inventoryLogId: postedLog?.id,
      gsoTransactionCode: postedLog?.gsoTransactionCode,
      deliveryReceiptRef: sanitized.deliveryReceiptRef,
      purchaseOrderRef: sanitized.purchaseOrderRef,
      supplierName: sanitized.supplierName,
      deliveryDate: sanitized.deliveryDate,
      deliveredVolumeLiters: sanitized.deliveredVolumeLiters,
      totalAmountPhp: sanitized.totalAmountPhp,
      unitCostPhp: sanitized.unitCostPhp,
      verifiedNow: postedLog ? postedLog.approvalStatus === 'verified' : false,
      postedAt: postedLog?.createdAt || new Date().toISOString(),
    };

    setSubmissions((prev) => {
      const updated = prev.map((rec) =>
        rec.id === recordId ? { ...rec, postedDelivery: postedReceipt } : rec
      );
      saveStoredDipstickRecords(
        updated.map((item) => ({
          ...item,
          photoDataUrl:
            item.photoDataUrl && item.photoDataUrl.length < 100000 ? item.photoDataUrl : undefined,
        }))
      );
      return updated;
    });
    setLastSubmission((prev) =>
      prev && prev.id === recordId ? { ...prev, postedDelivery: postedReceipt } : prev
    );
    setPendingDeliveryModal(null);
  };

  const handleOpenRecoveryDeliveryModal = (rec: DipstickSubmissionRecord) => {
    setLastSubmission(rec);
    setActiveView('confirmation');
    setPendingDeliveryModal({
      recordId: rec.id,
      context: {
        depotId: rec.depotId,
        depotName: rec.stationName,
        tankId: rec.payload.tankId,
        storageTankId: rec.storageTankId,
        tankNumber: rec.tankNumber,
        fuelGrade: rec.fuelGrade,
        bolNumber: rec.payload.bolNumber,
        plannedDropLiters: rec.payload.plannedDropLiters,
        calculatedDipVolumeLiters: rec.payload.calculatedVolumeLiters,
        maxSafeDropLiters: rec.maxSafeDropLiters,
        dipHeightCm: rec.payload.dipHeightCm,
        waterHeightCm: rec.payload.waterHeightCm,
        preDeliveryNotes: rec.notes,
        timestamp: rec.payload.timestamp,
        postedDipAdjustment: rec.postedDipAdjustment ?? null,
      },
    });
  };

  const syncLabel = isOnline
    ? syncQueueCount > 0
      ? `Syncing (${syncQueueCount})`
      : 'Sync: OK'
    : `Offline - Queued${syncQueueCount > 0 ? ` (${syncQueueCount})` : ''}`;

  const renderTopBar = () => (
    <header
      data-testid="dipstick-top-bar"
      className="rounded-xl border-2 border-[#D1D5DB] bg-white p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-[#111827] px-2.5 py-1 font-mono text-xs font-bold tracking-wide text-white">
              {stationId}
            </span>
            {depots.length > 1 && storageTanks.length > 0 && activeView === 'tanks' ? (
              <div className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-[#4B5563] shrink-0" />
                <select
                  aria-label="Filter Dipstick Tanks by Depot"
                  data-testid="dipstick-depot-selector"
                  value={selectedDepotFilter}
                  onChange={(e) => setSelectedDepotFilter(e.target.value)}
                  className="rounded-lg border-2 border-[#D1D5DB] bg-[#F9FAFB] px-2.5 py-1 text-sm font-extrabold text-[#111827] focus:border-[#111827] focus:outline-none"
                >
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.siteCode || d.id})
                    </option>
                  ))}
                  <option value="all">All Registered Depots</option>
                </select>
              </div>
            ) : (
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-[#111827] truncate">
                {stationName}
              </h2>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-medium text-[#374151]">
            <Clock className="h-4 w-4 text-[#4B5563] shrink-0" />
            <span className="font-mono tabular-nums">{formatReadableTimestamp(nowClock)}</span>
            <span aria-hidden="true" className="text-[#9CA3AF]">
              •
            </span>
            <span>
              Operator: <strong className="text-[#111827]">{currentUser.displayName}</strong>
            </span>
            {storageTanks.length > 0 && (
              <>
                <span aria-hidden="true" className="text-[#9CA3AF]">
                  •
                </span>
                <span className="font-mono text-xs font-bold text-[#065F46]">
                  Master Registry Synced
                </span>
              </>
            )}
          </div>
        </div>

        <div
          data-testid="dipstick-sync-indicator"
          className={`inline-flex items-center justify-center gap-2 rounded-lg border-2 px-3.5 min-h-[44px] text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 ${
            isOnline
              ? 'border-[#059669] bg-[#ECFDF5] text-[#065F46]'
              : 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]'
          }`}
        >
          {isOnline ? <Wifi className="h-4 w-4 shrink-0" /> : <WifiOff className="h-4 w-4 shrink-0" />}
          <span>{syncLabel}</span>
        </div>
      </div>
    </header>
  );

  return (
    <div
      data-testid="dipstick-logging-module"
      className="rounded-2xl border border-[#D1D5DB] bg-[#F9FAFB] p-3 sm:p-5 text-[#111827] space-y-4"
    >
      {renderTopBar()}

      {/* =================================================================== */}
      {/* VIEW 1: TANK SELECTION & MODE SELECTOR                              */}
      {/* =================================================================== */}
      {activeView === 'tanks' && (
        <div data-testid="dipstick-view-tanks" className="space-y-4">
          {/* Segmented Mode Selector (Glove-friendly >= 56px) */}
          <div
            role="tablist"
            aria-label="Dipstick Logging Mode"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border-2 border-[#D1D5DB] bg-white p-2"
          >
            <button
              type="button"
              role="tab"
              aria-selected={logMode === 'routine_check'}
              data-testid="mode-toggle-routine"
              onClick={() => setLogMode('routine_check')}
              className={`min-h-[56px] rounded-lg px-4 py-3 flex items-center justify-center gap-2.5 text-sm sm:text-base font-extrabold transition-colors border-2 ${
                logMode === 'routine_check'
                  ? 'bg-[#111827] text-white border-[#111827] shadow-sm'
                  : 'bg-[#F9FAFB] text-[#111827] border-[#D1D5DB] hover:bg-[#F3F4F6]'
              }`}
            >
              <ClipboardCheck className="h-5 w-5 shrink-0" />
              <span>Routine / Random Check</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={logMode === 'pre_delivery_check'}
              data-testid="mode-toggle-pre-delivery"
              onClick={() => setLogMode('pre_delivery_check')}
              className={`min-h-[56px] rounded-lg px-4 py-3 flex items-center justify-center gap-2.5 text-sm sm:text-base font-extrabold transition-colors border-2 ${
                logMode === 'pre_delivery_check'
                  ? 'bg-[#111827] text-white border-[#111827] shadow-sm'
                  : 'bg-[#F9FAFB] text-[#111827] border-[#D1D5DB] hover:bg-[#F3F4F6]'
              }`}
            >
              <Truck className="h-5 w-5 shrink-0" />
              <span>Pre-Delivery Check</span>
            </button>
          </div>

          {/* Mode Guidance Strip */}
          <div className="rounded-lg border border-[#D1D5DB] bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-[#1F2937]">
            <div className="font-semibold">
              {logMode === 'routine_check'
                ? 'Routine / Random Inventory Check: Tap a registered tank below to log physical dipstick & water paste readings using its Master Registry strapping curve.'
                : 'Pre-Delivery Offload Check: Verify fuel product match (cross-drop protection) and physical ullage against Safe Fill Capacity & 500 L safety buffer.'}
            </div>
            {!canViewRunningBalances && (
              <span
                data-testid="dipstick-blind-mode-notice"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#9CA3AF] bg-[#F3F4F6] px-2.5 py-1 text-xs font-bold text-[#111827]"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Blind Dip Mode (Tank Book Balances Hidden)</span>
              </span>
            )}
          </div>

          {/* UST Tank List Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tanks.map((tank) => {
              const gradeStyle = UST_FUEL_GRADE_STYLES[tank.fuelGrade];
              const safeCap = tank.safeFillCapacityLiters ?? tank.capacityLiters;
              const bookUllageLiters = Math.max(0, Math.round((safeCap - tank.bookVolumeLiters) * 10) / 10);
              const lowUllageWarning =
                canViewRunningBalances && bookUllageLiters < tank.deliveryUllageThresholdLiters;

              return (
                <button
                  key={tank.storageTankId ?? tank.tankId}
                  type="button"
                  data-testid={`ust-tank-card-${tank.tankId}`}
                  onClick={() => handleSelectTank(tank)}
                  className="group relative flex flex-col overflow-hidden rounded-xl border-2 border-[#D1D5DB] bg-white text-left shadow-sm transition-all hover:border-[#111827] hover:shadow-md focus:outline-none focus:ring-4 focus:ring-[#111827]/20 min-h-[176px]"
                >
                  {/* API Standard Thick Top Accent Bar */}
                  <div
                    className={`h-2.5 w-full ${gradeStyle.topBarClass}`}
                    style={{ backgroundColor: gradeStyle.hex }}
                  />

                  <div className="flex flex-1 flex-col justify-between p-4 sm:p-5 space-y-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-black tracking-wide text-[#374151]">
                            {tank.tankId}
                          </span>
                          <span className="text-lg font-extrabold text-[#111827]">
                            {tank.tankNumber}
                          </span>
                        </div>
                        {tank.locationZone && (
                          <div className="text-xs font-medium text-[#4B5563]">
                            {tank.locationZone}
                            {tank.riserOffsetCm ? ` · Riser +${tank.riserOffsetCm} cm` : ''}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${gradeStyle.badgeBgClass} ${gradeStyle.badgeTextClass}`}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: gradeStyle.hex }}
                            />
                            <span>{gradeStyle.label}</span>
                          </span>
                          {tank.usingCustomStrapping && (
                            <span className="rounded border border-[#3B82F6] bg-[#DBEAFE] px-2 py-0.5 font-mono text-[10px] font-bold text-[#1E40AF]">
                              CSV STRAPPING
                            </span>
                          )}
                        </div>
                      </div>

                      {lowUllageWarning && (
                        <span
                          data-testid={`ust-low-ullage-${tank.tankId}`}
                          className="inline-flex items-center gap-1 rounded-md border-2 border-[#DC2626] bg-[#FEF2F2] px-2.5 py-1 text-xs font-extrabold text-[#991B1B]"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>Low Ullage</span>
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#4B5563]">
                          Last Recorded Vol
                        </div>
                        {canViewRunningBalances ? (
                          <div className="mt-0.5 font-mono text-base sm:text-lg font-extrabold tabular-nums text-[#111827]">
                            {formatLiters(tank.lastRecordedVolumeLiters)} L
                          </div>
                        ) : (
                          <div
                            data-testid={`ust-masked-balance-${tank.tankId}`}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-[#4B5563]"
                          >
                            <Lock className="h-3.5 w-3.5 shrink-0" />
                            <span>Restricted</span>
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-[11px] text-[#4B5563]">
                          {formatReadableTimestamp(tank.lastRecordedAt)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#4B5563]">
                          Safe Fill / Ullage
                        </div>
                        <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#111827]">
                          Safe: {Math.round(safeCap).toLocaleString()} L
                        </div>
                        {canViewRunningBalances ? (
                          <div
                            className={`mt-0.5 font-mono text-sm font-extrabold tabular-nums ${
                              lowUllageWarning ? 'text-[#B91C1C]' : 'text-[#065F46]'
                            }`}
                          >
                            Ullage: {formatLiters(bookUllageLiters)} L
                          </div>
                        ) : (
                          <div className="mt-0.5 text-xs font-semibold text-[#4B5563]">
                            Ullage: Dip to compute
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-xs sm:text-sm font-extrabold text-[#111827]">
                      <span>
                        {logMode === 'pre_delivery_check'
                          ? 'Tap to Run Pre-Delivery Ullage Check'
                          : 'Tap to Enter Dipstick Reading'}
                      </span>
                      <span className="inline-flex items-center justify-center rounded-md border-2 border-[#111827] bg-[#111827] px-3 py-1.5 text-xs font-bold text-white group-hover:bg-[#374151]">
                        Select Tank →
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Recent Dipstick Submissions */}
          {submissions.length > 0 && (
            <section className="rounded-xl border-2 border-[#D1D5DB] bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-extrabold text-[#111827]">
                  Recent Dipstick Logs ({submissions.length})
                </h3>
                <span className="font-mono text-xs text-[#4B5563]">
                  Stored locally &amp; synced
                </span>
              </div>
              <div className="divide-y divide-[#E5E7EB]">
                {submissions.slice(0, 5).map((rec) => {
                  const gradeStyle = UST_FUEL_GRADE_STYLES[rec.fuelGrade];
                  const isPreDel = rec.payload.logType === 'pre_delivery_check';
                  const matchedLedgerLog = isPreDel
                    ? findMatchingLedgerDeliveryForDipstick({
                        inventoryLogs,
                        inventoryLogId: rec.postedDelivery?.inventoryLogId,
                        deliveryReceiptRef: rec.postedDelivery?.deliveryReceiptRef,
                        bolNumber: rec.payload.bolNumber,
                        depotId: rec.depotId,
                      })
                    : null;
                  return (
                    <div
                      key={rec.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs sm:text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: gradeStyle.hex }}
                        />
                        <span className="font-mono font-bold text-[#111827]">
                          {rec.payload.tankId} ({rec.tankNumber})
                        </span>
                        <span className="rounded border border-[#D1D5DB] bg-[#F9FAFB] px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-[#111827]">
                          {isPreDel
                            ? `PRE-DELIVERY${rec.payload.bolNumber ? ` · ${rec.payload.bolNumber}` : ''}`
                            : 'ROUTINE'}
                        </span>
                        <span className="font-mono font-bold tabular-nums text-[#111827]">
                          Dip: {rec.payload.dipHeightCm} cm →{' '}
                          {formatLiters(rec.payload.calculatedVolumeLiters)} L
                        </span>
                        {isPreDel && matchedLedgerLog && (
                          <span
                            data-testid={`dipstick-ledger-recorded-${rec.id}`}
                            className="inline-flex items-center gap-1 rounded border border-[#059669] bg-[#ECFDF5] px-2 py-0.5 font-mono text-[11px] font-bold text-[#065F46]"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              In Ledger · {matchedLedgerLog.gsoTransactionCode || matchedLedgerLog.referenceNumber}
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isPreDel && !matchedLedgerLog && onPostPreDelivery && (
                          <button
                            type="button"
                            data-testid={`dipstick-repost-ledger-${rec.id}`}
                            onClick={() => handleOpenRecoveryDeliveryModal(rec)}
                            className="min-h-[44px] rounded-lg border-2 border-[#B45309] bg-[#FFFBEB] px-3 py-1.5 text-xs font-extrabold text-[#92400E] hover:bg-[#FEF3C7]"
                          >
                            Post to Depot Ledger
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setLastSubmission(rec);
                            setActiveView('confirmation');
                          }}
                          className="min-h-[44px] rounded-lg border-2 border-[#D1D5DB] bg-[#F9FAFB] px-3 py-1.5 text-xs font-extrabold text-[#111827] hover:border-[#111827]"
                        >
                          View Pass / Receipt
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* VIEW 2: DIPSTICK MEASUREMENT ENTRY FORM                             */}
      {/* =================================================================== */}
      {activeView === 'entry' && selectedTank && evaluation && (
        <form
          data-testid="dipstick-view-entry"
          onSubmit={handleSubmitReading}
          className="space-y-4"
        >
          {(() => {
            const gradeStyle = UST_FUEL_GRADE_STYLES[selectedTank.fuelGrade];
            return (
              <>
                {/* Context Header */}
                <div className="overflow-hidden rounded-xl border-2 border-[#D1D5DB] bg-white shadow-sm">
                  <div
                    className={`h-2.5 w-full ${gradeStyle.topBarClass}`}
                    style={{ backgroundColor: gradeStyle.hex }}
                  />
                  <div className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        data-testid="dipstick-back-btn"
                        onClick={handleBackToTanks}
                        className="min-h-[56px] inline-flex items-center justify-center gap-2 rounded-lg border-2 border-[#111827] bg-white px-4 text-sm font-extrabold text-[#111827] hover:bg-[#F3F4F6]"
                      >
                        <ArrowLeft className="h-5 w-5" />
                        <span>Tanks</span>
                      </button>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-base font-black text-[#111827]">
                            {selectedTank.tankId} · {selectedTank.tankNumber}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1 text-xs font-extrabold uppercase ${gradeStyle.badgeBgClass} ${gradeStyle.badgeTextClass}`}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: gradeStyle.hex }}
                            />
                            <span>{gradeStyle.label}</span>
                          </span>
                          <span className="rounded-md bg-[#111827] px-2.5 py-1 text-xs font-extrabold uppercase text-white">
                            {logMode === 'pre_delivery_check'
                              ? 'Pre-Delivery Check'
                              : 'Routine Check'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:text-sm font-medium text-[#374151]">
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Lock className="h-3.5 w-3.5 text-[#4B5563]" />
                            Locked: {formatReadableTimestamp(lockedTimestamp)}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span>
                            Operator: <strong className="text-[#111827]">{currentUser.displayName}</strong>{' '}
                            <span className="font-mono text-xs text-[#4B5563]">
                              ({currentUser.username})
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Responsive Two-Column Desktop / Stacked Mobile Form Body */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  {/* Left Column: Inputs */}
                  <div className="lg:col-span-7 space-y-4">
                    {/* Conditional Pre-Delivery Fields */}
                    {logMode === 'pre_delivery_check' && (
                      <section
                        data-testid="pre-delivery-fields"
                        className="rounded-xl border-2 border-[#111827] bg-white p-4 sm:p-5 space-y-4"
                      >
                        <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2.5">
                          <Truck className="h-5 w-5 text-[#111827]" />
                          <h3 className="text-sm sm:text-base font-extrabold text-[#111827]">
                            Pre-Delivery Tanker Manifest &amp; Cross-Drop Verification
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label
                              htmlFor="dipstick-bol-input"
                              className="block text-xs sm:text-sm font-extrabold text-[#111827]"
                            >
                              BOL / Delivery Ticket Number *
                            </label>
                            <input
                              id="dipstick-bol-input"
                              data-testid="bol-number-input"
                              type="text"
                              required
                              autoComplete="off"
                              placeholder="e.g. BOL-2026-881"
                              value={bolNumber}
                              onChange={(e) => setBolNumber(e.target.value)}
                              className="min-h-[56px] w-full rounded-lg border-2 border-[#9CA3AF] bg-white px-4 font-mono text-base font-bold uppercase text-[#111827] placeholder:text-[#6B7280] focus:border-[#111827] focus:outline-none"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label
                              htmlFor="dipstick-planned-drop-input"
                              className="block text-xs sm:text-sm font-extrabold text-[#111827]"
                            >
                              Planned Drop Volume (Liters) *
                            </label>
                            <input
                              id="dipstick-planned-drop-input"
                              data-testid="planned-drop-input"
                              type="text"
                              inputMode="decimal"
                              required
                              placeholder="e.g. 3000"
                              value={plannedDropInput}
                              onChange={(e) => setPlannedDropInput(e.target.value)}
                              className="min-h-[56px] w-full rounded-lg border-2 border-[#9CA3AF] bg-white px-4 font-mono text-lg font-extrabold tabular-nums text-[#111827] placeholder:text-[#6B7280] focus:border-[#111827] focus:outline-none"
                            />
                          </div>

                          <div className="sm:col-span-2 space-y-1.5">
                            <label
                              htmlFor="dipstick-delivery-product-select"
                              className="block text-xs sm:text-sm font-extrabold text-[#111827]"
                            >
                              Tanker Manifest Fuel Product (Cross-Drop Prevention) *
                            </label>
                            <select
                              id="dipstick-delivery-product-select"
                              data-testid="delivery-fuel-product-select"
                              value={deliveryFuelProduct}
                              onChange={(e) =>
                                setDeliveryFuelProduct(e.target.value as TankFuelProduct)
                              }
                              className={`min-h-[56px] w-full rounded-lg border-2 px-4 text-sm sm:text-base font-extrabold focus:outline-none ${
                                evaluation.crossDropMismatch
                                  ? 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]'
                                  : 'border-[#9CA3AF] bg-white text-[#111827] focus:border-[#111827]'
                              }`}
                            >
                              {DELIVERY_FUEL_OPTIONS.map((fp) => (
                                <option key={fp} value={fp}>
                                  {UST_FUEL_GRADE_STYLES[fp].label}
                                  {fp === selectedTank.fuelGrade ? ' (Matches Tank)' : ' — MISMATCH'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {evaluation.crossDropMismatch && evaluation.crossDropError && (
                          <div
                            role="alert"
                            data-testid="cross-drop-alert-banner"
                            className="rounded-xl border-2 border-[#991B1B] bg-[#DC2626] p-4 text-white space-y-1 shadow-md"
                          >
                            <div className="flex items-start gap-2.5 text-sm sm:text-base font-black">
                              <AlertOctagon className="h-6 w-6 shrink-0 mt-0.5" />
                              <span>{evaluation.crossDropError}</span>
                            </div>
                            <p className="text-xs font-semibold text-[#FEE2E2]">
                              Offload locked. Confirm the tanker compartment matches{' '}
                              {gradeStyle.label} or select the correct receiving storage tank.
                            </p>
                          </div>
                        )}
                      </section>
                    )}

                    {/* Physical Dipstick Inputs */}
                    <section className="rounded-xl border-2 border-[#D1D5DB] bg-white p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] pb-2.5">
                        <div className="flex items-center gap-2">
                          <Gauge className="h-5 w-5 text-[#111827]" />
                          <h3 className="text-sm sm:text-base font-extrabold text-[#111827]">
                            Physical Dipstick Measurements
                          </h3>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#4B5563]">
                          Max Raw Dip: {evaluation.maxRawDipCm || selectedTank.maxDipHeightCm} cm
                          {evaluation.riserOffsetCm > 0
                            ? ` (Riser +${evaluation.riserOffsetCm} cm)`
                            : ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label
                            htmlFor="dipstick-fuel-cm-input"
                            className={`block text-xs sm:text-sm font-extrabold ${
                              evaluation.exceedsMaxHeight ? 'text-[#B91C1C]' : 'text-[#111827]'
                            }`}
                          >
                            Fuel Dip Height (cm) *
                          </label>
                          <input
                            id="dipstick-fuel-cm-input"
                            data-testid="dip-height-input"
                            type="text"
                            inputMode="decimal"
                            required
                            placeholder={`0.0 – ${evaluation.maxRawDipCm || selectedTank.maxDipHeightCm}`}
                            value={dipHeightInput}
                            onChange={(e) => setDipHeightInput(e.target.value)}
                            className={`min-h-[56px] w-full rounded-lg border-2 px-4 font-mono text-xl font-black tabular-nums placeholder:text-[#6B7280] focus:outline-none ${
                              evaluation.exceedsMaxHeight
                                ? 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]'
                                : 'border-[#9CA3AF] bg-white text-[#111827] focus:border-[#111827]'
                            }`}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label
                            htmlFor="dipstick-water-cm-input"
                            className={`block text-xs sm:text-sm font-extrabold ${
                              evaluation.waterAlertTriggered ? 'text-[#B91C1C]' : 'text-[#111827]'
                            }`}
                          >
                            Water Paste Level (cm)
                          </label>
                          <input
                            id="dipstick-water-cm-input"
                            data-testid="water-height-input"
                            type="text"
                            inputMode="decimal"
                            placeholder="0.0"
                            value={waterHeightInput}
                            onChange={(e) => setWaterHeightInput(e.target.value)}
                            className={`min-h-[56px] w-full rounded-lg border-2 px-4 font-mono text-xl font-black tabular-nums focus:outline-none ${
                              evaluation.waterAlertTriggered
                                ? 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B] focus:border-[#991B1B]'
                                : 'border-[#9CA3AF] bg-white text-[#111827] focus:border-[#111827]'
                            }`}
                          />
                        </div>
                      </div>

                      {/* Impossible Dip Height Guardrail */}
                      {evaluation.exceedsMaxHeight && (
                        <div
                          role="alert"
                          data-testid="impossible-dip-height-banner"
                          className="rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] p-3.5 text-[#991B1B] space-y-1"
                        >
                          <div className="flex items-center gap-2 text-sm font-black uppercase">
                            <AlertOctagon className="h-5 w-5 shrink-0 text-[#DC2626]" />
                            <span>IMPOSSIBLE DIP READING — EXCEEDS TANK DEPTH</span>
                          </div>
                          <p className="text-xs sm:text-sm font-semibold">
                            Entered dipstick reading exceeds the Master Registry maximum height of{' '}
                            {evaluation.maxRawDipCm} cm (tank depth + {evaluation.riserOffsetCm} cm
                            riser pipe offset). Re-measure before locking.
                          </p>
                        </div>
                      )}

                      {/* Water Alert Guardrail (> 0.5 cm) */}
                      {evaluation.waterAlertTriggered && (
                        <div
                          role="alert"
                          data-testid="water-alert-banner"
                          className="rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] p-3.5 text-[#991B1B] space-y-1"
                        >
                          <div className="flex items-center gap-2 text-sm font-black uppercase">
                            <Droplets className="h-5 w-5 shrink-0 text-[#DC2626]" />
                            <span>
                              WATER ALERT — Paste Level Exceeds {WATER_ALERT_THRESHOLD_CM} cm
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm font-semibold">
                            Water contamination risk detected. You must enter an inspection note or
                            attach a dipstick photo below before locking this reading.
                          </p>
                        </div>
                      )}
                    </section>

                    {/* Verification: Photo & Notes */}
                    <section className="rounded-xl border-2 border-[#D1D5DB] bg-white p-4 sm:p-5 space-y-4">
                      <h3 className="text-sm sm:text-base font-extrabold text-[#111827]">
                        Verification &amp; Field Notes
                      </h3>

                      <div className="space-y-3">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={handlePhotoSelect}
                          className="hidden"
                          id="dipstick-photo-input"
                        />

                        <div className="flex flex-wrap items-center gap-3">
                          <label
                            htmlFor="dipstick-photo-input"
                            data-testid="attach-photo-btn"
                            className="min-h-[56px] cursor-pointer inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-lg border-2 border-[#111827] bg-[#F9FAFB] px-4 py-3 text-sm font-extrabold text-[#111827] hover:bg-[#E5E7EB]"
                          >
                            <Camera className="h-5 w-5 shrink-0" />
                            <span>
                              {photoName ? 'Replace Dipstick Photo' : 'Attach Dipstick Photo'}
                            </span>
                          </label>

                          {photoName && (
                            <div className="flex items-center gap-2 rounded-lg border-2 border-[#059669] bg-[#ECFDF5] px-3 py-2 text-xs font-bold text-[#065F46]">
                              {photoDataUrl && (
                                <img
                                  src={photoDataUrl}
                                  alt="Dipstick preview"
                                  className="h-9 w-9 rounded object-cover border border-[#059669]"
                                />
                              )}
                              <span className="max-w-[160px] truncate">{photoName}</span>
                              <button
                                type="button"
                                onClick={handleClearPhoto}
                                aria-label="Remove attached photo"
                                className="rounded p-1 hover:bg-[#D1FAE5]"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label
                            htmlFor="dipstick-notes-input"
                            className={`block text-xs sm:text-sm font-extrabold ${
                              evaluation.waterAlertTriggered && !evaluation.waterConfirmationSatisfied
                                ? 'text-[#B91C1C]'
                                : 'text-[#111827]'
                            }`}
                          >
                            Notes{' '}
                            {evaluation.waterAlertTriggered
                              ? '(Required unless photo attached)'
                              : '(Optional)'}
                          </label>
                          <textarea
                            id="dipstick-notes-input"
                            data-testid="dipstick-notes-input"
                            rows={2}
                            placeholder={
                              evaluation.waterAlertTriggered
                                ? 'Confirm water paste inspection, tank sump check, or supervisor notification...'
                                : 'Record stick condition, temperature remarks, or tanker seal number...'
                            }
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className={`min-h-[56px] w-full rounded-lg border-2 px-4 py-3 text-sm font-medium text-[#111827] placeholder:text-[#6B7280] focus:outline-none ${
                              evaluation.waterAlertTriggered && !evaluation.waterConfirmationSatisfied
                                ? 'border-[#DC2626] bg-[#FEF2F2] focus:border-[#991B1B]'
                                : 'border-[#9CA3AF] bg-white focus:border-[#111827]'
                            }`}
                          />
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Right Column: Live Strapping & Safety Calculation Card */}
                  <div className="lg:col-span-5 space-y-4">
                    <section
                      data-testid="live-strapping-card"
                      className="rounded-xl border-2 border-[#111827] bg-white p-4 sm:p-5 space-y-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] pb-2.5">
                        <h3 className="text-sm sm:text-base font-extrabold text-[#111827]">
                          Live Strapping &amp; Safety Calculation
                        </h3>
                        <span className="rounded bg-[#F3F4F6] px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#374151]">
                          {evaluation.strappingSource === 'custom_csv'
                            ? 'CUSTOM CSV'
                            : evaluation.strappingSource === 'geometric_formula'
                              ? 'MASTER GEOMETRY'
                              : 'READ-ONLY'}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {/* Calculated Fuel Volume */}
                        <div className="rounded-lg border-2 border-[#E5E7EB] bg-[#F9FAFB] p-3.5">
                          <div className="text-xs font-bold uppercase tracking-wider text-[#4B5563]">
                            Calculated Fuel Volume (L)
                          </div>
                          <div
                            data-testid="live-calc-volume"
                            className="mt-1 font-mono text-2xl sm:text-3xl font-black tabular-nums text-[#111827]"
                          >
                            {evaluation.hasValidDipHeight
                              ? `${formatLiters(evaluation.calculatedVolumeLiters)} L`
                              : '—'}
                          </div>
                          {evaluation.riserOffsetCm > 0 && evaluation.hasValidDipHeight && (
                            <div
                              data-testid="live-riser-offset-note"
                              className="mt-1 font-mono text-[11px] font-semibold text-[#4B5563]"
                            >
                              Net Depth: {evaluation.netLiquidHeightCm} cm (Raw dip −{' '}
                              {evaluation.riserOffsetCm} cm riser)
                            </div>
                          )}
                        </div>

                        {/* System / ATG Book Volume (RBAC Restricted) & Available Ullage */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-[#4B5563]">
                              System / ATG Book Vol
                            </div>
                            {canViewRunningBalances ? (
                              <div
                                data-testid="live-book-volume"
                                className="mt-1 font-mono text-lg font-extrabold tabular-nums text-[#111827]"
                              >
                                {formatLiters(evaluation.bookVolumeLiters)} L
                              </div>
                            ) : (
                              <div
                                data-testid="live-book-volume-restricted"
                                className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-[#4B5563]"
                              >
                                <Lock className="h-3.5 w-3.5 shrink-0" />
                                <span>Admin / GSO Head Only</span>
                              </div>
                            )}
                          </div>

                          {/* Available Ullage */}
                          <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-[#4B5563]">
                              Available Ullage (L)
                            </div>
                            <div
                              data-testid="live-ullage"
                              className="mt-1 font-mono text-lg font-extrabold tabular-nums text-[#065F46]"
                            >
                              {evaluation.hasValidDipHeight
                                ? `${formatLiters(evaluation.ullageLiters)} L`
                                : canViewRunningBalances
                                  ? `${formatLiters(evaluation.ullageLiters)} L`
                                  : 'Enter dip (cm)'}
                            </div>
                            <div className="font-mono text-[11px] text-[#4B5563]">
                              Safe Fill: {Math.round(evaluation.safeFillCapacityLiters).toLocaleString()} L
                            </div>
                          </div>
                        </div>

                        {/* Variance (L & %) + Re-dip Prompt (RBAC Restricted) */}
                        <div
                          data-testid="live-variance"
                          className={`rounded-lg border-2 p-3.5 ${
                            !canViewRunningBalances
                              ? 'border-[#D1D5DB] bg-[#F9FAFB]'
                              : evaluation.reDipRecommended
                                ? Math.abs(evaluation.variancePct) >= 2
                                  ? 'border-[#DC2626] bg-[#FEF2F2]'
                                  : 'border-[#D97706] bg-[#FFFBEB]'
                                : 'border-[#D1D5DB] bg-[#F9FAFB]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-[#4B5563]">
                              Variance (Dip − Book)
                            </span>
                            {canViewRunningBalances && evaluation.reDipRecommended && (
                              <span
                                data-testid="redip-recommended-badge"
                                className="inline-flex items-center gap-1 rounded-md border border-[#B45309] bg-[#FEF3C7] px-2 py-0.5 text-xs font-black text-[#92400E]"
                              >
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>Re-dip Recommended</span>
                              </span>
                            )}
                          </div>

                          {canViewRunningBalances ? (
                            <div className="mt-1 flex flex-wrap items-baseline gap-2 font-mono tabular-nums">
                              <span
                                className={`text-xl font-black ${
                                  evaluation.reDipRecommended
                                    ? Math.abs(evaluation.variancePct) >= 2
                                      ? 'text-[#B91C1C]'
                                      : 'text-[#B45309]'
                                    : 'text-[#111827]'
                                }`}
                              >
                                {evaluation.hasValidDipHeight
                                  ? `${evaluation.varianceLiters > 0 ? '+' : ''}${formatLiters(evaluation.varianceLiters)} L`
                                  : '—'}
                              </span>
                              {evaluation.hasValidDipHeight && (
                                <span
                                  className={`text-sm font-bold ${
                                    evaluation.reDipRecommended ? 'text-[#92400E]' : 'text-[#4B5563]'
                                  }`}
                                >
                                  ({evaluation.variancePct > 0 ? '+' : ''}
                                  {evaluation.variancePct.toFixed(2)}%)
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-[#4B5563]">
                              <Lock className="h-3.5 w-3.5 shrink-0" />
                              <span>Restricted — Admin / GSO Head Only</span>
                            </div>
                          )}
                        </div>

                        {/* Overfill Guardrail Banner (Pre-Delivery Mode Only) */}
                        {logMode === 'pre_delivery_check' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 text-xs font-bold text-[#374151]">
                              <span>Max Safe Drop (Ullage − {OVERFILL_SAFETY_BUFFER_LITERS} L buffer):</span>
                              <span className="font-mono text-sm font-black text-[#111827] whitespace-nowrap shrink-0">
                                {evaluation.hasValidDipHeight
                                  ? `${formatLiters(evaluation.maxSafeDropLiters)} L`
                                  : 'Enter dip (cm)'}
                              </span>
                            </div>

                            {evaluation.overfillStatus === 'safe' && !evaluation.crossDropMismatch && (
                              <div
                                role="status"
                                data-testid="overfill-guardrail-banner"
                                data-overfill-status="safe"
                                className="rounded-xl border-2 border-[#059669] bg-[#ECFDF5] p-4 text-[#065F46] space-y-1"
                              >
                                <div className="flex items-center gap-2 text-sm sm:text-base font-black">
                                  <ShieldCheck className="h-6 w-6 shrink-0 text-[#059669]" />
                                  <span>SAFE TO DELIVER — Fits within available ullage</span>
                                </div>
                                <p className="text-xs font-semibold">
                                  Planned drop leaves at least {OVERFILL_SAFETY_BUFFER_LITERS} L
                                  headspace below Safe Fill Capacity.
                                </p>
                              </div>
                            )}

                            {evaluation.overfillStatus === 'overfill_risk' && (
                              <div
                                role="alert"
                                data-testid="overfill-guardrail-banner"
                                data-overfill-status="overfill_risk"
                                className="rounded-xl border-2 border-[#991B1B] bg-[#DC2626] p-4 text-white space-y-1 shadow-md"
                              >
                                <div className="flex items-start gap-2.5 text-sm sm:text-base font-black">
                                  <AlertOctagon className="h-6 w-6 shrink-0 mt-0.5" />
                                  <span>
                                    STOP: OVERFILL RISK — Exceeds safe capacity by{' '}
                                    {formatLiters(evaluation.overfillExcessLiters)} Liters
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-[#FEE2E2]">
                                  Submission locked. Reduce planned drop to{' '}
                                  {formatLiters(evaluation.maxSafeDropLiters)} L or less, or split
                                  offload to another tank.
                                </p>
                              </div>
                            )}

                            {evaluation.overfillStatus === 'idle' && (
                              <div
                                data-testid="overfill-guardrail-banner"
                                data-overfill-status="idle"
                                className="rounded-xl border-2 border-dashed border-[#9CA3AF] bg-[#F9FAFB] p-3.5 text-xs font-semibold text-[#4B5563]"
                              >
                                Enter both Fuel Dip Height (cm) and Planned Drop Volume (L) to run
                                the 500 L overfill safety check.
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Primary Full-Width CTA */}
                      <div className="pt-2 space-y-2">
                        {evaluation.blockingReason &&
                          evaluation.overfillStatus !== 'overfill_risk' &&
                          !evaluation.crossDropMismatch &&
                          !evaluation.exceedsMaxHeight && (
                            <div
                              data-testid="dipstick-blocking-reason"
                              className="flex items-start gap-2 rounded-lg border border-[#D1D5DB] bg-[#F3F4F6] px-3 py-2 text-xs font-bold text-[#374151]"
                            >
                              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-[#B45309]" />
                              <span>{evaluation.blockingReason}</span>
                            </div>
                          )}

                        <button
                          type="submit"
                          data-testid="dipstick-submit-btn"
                          disabled={!evaluation.canSubmit || submitting}
                          className={`min-h-[56px] w-full rounded-xl px-5 py-4 text-base font-black uppercase tracking-wide transition-colors flex items-center justify-center gap-2.5 ${
                            evaluation.canSubmit && !submitting
                              ? 'bg-[#111827] text-white hover:bg-[#1F2937] shadow-md'
                              : 'bg-[#D1D5DB] text-[#6B7280] cursor-not-allowed'
                          }`}
                        >
                          <Lock className="h-5 w-5 shrink-0" />
                          <span>{submitting ? 'LOCKING READING...' : 'SUBMIT & LOCK READING'}</span>
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </>
            );
          })()}
        </form>
      )}

      {/* =================================================================== */}
      {/* VIEW 3: POST-SUBMISSION CONFIRMATION / CLEARANCE PASS               */}
      {/* =================================================================== */}
      {activeView === 'confirmation' && lastSubmission && (
        <div data-testid="dipstick-view-confirmation" className="space-y-4">
          {(() => {
            const gradeStyle = UST_FUEL_GRADE_STYLES[lastSubmission.fuelGrade];
            const isPreDelivery = lastSubmission.payload.logType === 'pre_delivery_check';

            const displayPayload = canViewRunningBalances
              ? lastSubmission.payload
              : {
                  ...lastSubmission.payload,
                  varianceLiters: null,
                };

            return isPreDelivery ? (
              <section
                data-testid="clearance-offload-pass"
                className="overflow-hidden rounded-2xl border-4 border-[#059669] bg-white shadow-lg"
              >
                <div className="bg-[#059669] px-5 py-5 text-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-10 w-10 shrink-0" />
                      <div>
                        <div className="text-xs font-extrabold uppercase tracking-widest text-[#D1FAE5]">
                          Pre-Delivery Ullage Verified
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-black tracking-tight">
                          CLEARED FOR OFFLOAD
                        </h3>
                      </div>
                    </div>
                    <span className="rounded-lg bg-white/15 px-3 py-1.5 font-mono text-sm font-black">
                      SHOW TO TANKER DRIVER
                    </span>
                  </div>
                </div>

                <div className="h-3 w-full" style={{ backgroundColor: gradeStyle.hex }} />

                <div className="p-5 sm:p-6 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border-2 border-[#D1D5DB] bg-[#F9FAFB] p-4">
                      <div className="text-xs font-bold uppercase text-[#4B5563]">Tank #</div>
                      <div className="mt-1 text-2xl font-black text-[#111827]">
                        {lastSubmission.tankNumber}
                      </div>
                      <div className="font-mono text-xs font-bold text-[#4B5563]">
                        {lastSubmission.payload.tankId}
                      </div>
                    </div>

                    <div className="rounded-xl border-2 border-[#D1D5DB] bg-[#F9FAFB] p-4">
                      <div className="text-xs font-bold uppercase text-[#4B5563]">Fuel Grade</div>
                      <div className="mt-1.5">
                        <span
                          className={`inline-flex items-center gap-2 rounded-md border-2 px-3 py-1 text-sm font-black uppercase ${gradeStyle.badgeBgClass} ${gradeStyle.badgeTextClass}`}
                        >
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: gradeStyle.hex }}
                          />
                          <span>{gradeStyle.label}</span>
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border-2 border-[#059669] bg-[#ECFDF5] p-4">
                      <div className="text-xs font-bold uppercase text-[#065F46]">
                        Max Safe Drop Volume
                      </div>
                      <div
                        data-testid="pass-max-safe-drop"
                        className="mt-1 font-mono text-2xl font-black tabular-nums text-[#065F46]"
                      >
                        {formatLiters(lastSubmission.maxSafeDropLiters)} L
                      </div>
                      <div className="font-mono text-xs font-bold text-[#047857]">
                        Planned: {formatLiters(lastSubmission.payload.plannedDropLiters ?? 0)} L
                      </div>
                    </div>

                    <div className="rounded-xl border-2 border-[#111827] bg-[#F9FAFB] p-4">
                      <div className="text-xs font-bold uppercase text-[#4B5563]">BOL #</div>
                      <div
                        data-testid="pass-bol-number"
                        className="mt-1 font-mono text-xl sm:text-2xl font-black text-[#111827] break-all"
                      >
                        {lastSubmission.payload.bolNumber || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-xs sm:text-sm">
                    <div>
                      <div className="font-bold text-[#4B5563]">Dip Height</div>
                      <div className="font-mono font-extrabold text-[#111827]">
                        {lastSubmission.payload.dipHeightCm} cm
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-[#4B5563]">Calculated Vol</div>
                      <div className="font-mono font-extrabold text-[#111827]">
                        {formatLiters(lastSubmission.payload.calculatedVolumeLiters)} L
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-[#4B5563]">Available Ullage</div>
                      <div className="font-mono font-extrabold text-[#065F46]">
                        {formatLiters(lastSubmission.payload.ullageLiters)} L
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-[#4B5563]">Locked Timestamp</div>
                      <div className="font-mono font-bold text-[#111827]">
                        {formatReadableTimestamp(lastSubmission.payload.timestamp)}
                      </div>
                    </div>
                  </div>

                  {lastSubmission.notes && (
                    <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] px-4 py-3 text-sm">
                      <strong className="text-[#111827]">Notes:</strong>{' '}
                      <span className="text-[#374151]">{lastSubmission.notes}</span>
                    </div>
                  )}

                  {lastSubmission.postedDipAdjustment && (
                    <section
                      data-testid="posted-dip-adjustment-summary"
                      className="rounded-xl border-2 border-[#D97706] bg-[#FFFBEB] p-4 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#FDE68A] pb-2">
                        <div className="flex items-center gap-2 text-sm font-black text-[#92400E]">
                          <ShieldCheck className="h-5 w-5 shrink-0 text-[#D97706]" />
                          <span>
                            Pre-Delivery Dipstick Variance Adjustment Posted Separately
                            {lastSubmission.postedDipAdjustment.gsoTransactionCode
                              ? ` (${lastSubmission.postedDipAdjustment.gsoTransactionCode})`
                              : ''}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#B45309]">
                          Pending Independent GSO Head Verification
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#78350F]">
                        <div>
                          Ref:{' '}
                          <strong className="font-mono text-[#111827]">
                            {lastSubmission.postedDipAdjustment.referenceNumber}
                          </strong>
                        </div>
                        {canViewRunningBalances ? (
                          <div className="font-mono font-black text-[#111827]">
                            {lastSubmission.postedDipAdjustment.transactionType === 'overage_adjustment'
                              ? 'Overage'
                              : 'Shrinkage'}
                            :{' '}
                            {lastSubmission.postedDipAdjustment.signedVarianceLiters > 0 ? '+' : ''}
                            {formatLiters(lastSubmission.postedDipAdjustment.signedVarianceLiters)} L
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 font-semibold text-[#78350F]">
                            <Lock className="h-3.5 w-3.5 shrink-0" />
                            <span>Variance volume restricted to GSO Head / Admin</span>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {lastSubmission.postedDelivery && (
                    <section
                      data-testid="posted-delivery-summary"
                      className={`rounded-xl border-2 p-4 space-y-3 ${
                        lastSubmission.postedDelivery.verifiedNow
                          ? 'border-[#059669] bg-[#ECFDF5]'
                          : 'border-[#1B3B6F] bg-[#EEF2F8]'
                      }`}
                    >
                      <div
                        className={`flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${
                          lastSubmission.postedDelivery.verifiedNow
                            ? 'border-[#A7F3D0]'
                            : 'border-[#CBD5E1]'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-black text-[#0B192C]">
                          <CheckCircle2
                            className={`h-5 w-5 shrink-0 ${
                              lastSubmission.postedDelivery.verifiedNow
                                ? 'text-[#059669]'
                                : 'text-[#1B3B6F]'
                            }`}
                          />
                          <span>
                            Fuel Delivery Posted Separately to Depot Ledger
                            {lastSubmission.postedDelivery.gsoTransactionCode
                              ? ` (${lastSubmission.postedDelivery.gsoTransactionCode})`
                              : ''}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-xs font-bold ${
                            lastSubmission.postedDelivery.verifiedNow
                              ? 'text-[#047857]'
                              : 'text-[#B45309]'
                          }`}
                        >
                          {lastSubmission.postedDelivery.verifiedNow
                            ? 'Posted & Verified · Stock & Per-Tank WAC Updated'
                            : 'Pending Separate GSO Head Verification'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="font-bold text-[#334E73]">DR Reference #</div>
                          <div className="font-mono text-sm font-black text-[#111827]">
                            {lastSubmission.postedDelivery.deliveryReceiptRef}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-[#334E73]">PO Reference #</div>
                          <div className="font-mono text-sm font-black text-[#111827]">
                            {lastSubmission.postedDelivery.purchaseOrderRef}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-[#334E73]">Supplier / Hauler</div>
                          <div className="font-bold text-[#111827]">
                            {lastSubmission.postedDelivery.supplierName}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-[#334E73]">Posted Volume</div>
                          <div className="font-mono text-sm font-black tabular-nums text-[#111827]">
                            {formatLiters(lastSubmission.postedDelivery.deliveredVolumeLiters)} L
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-[#334E73]">Total Amount</div>
                          <div className="font-mono text-sm font-black tabular-nums text-[#111827]">
                            ₱
                            {lastSubmission.postedDelivery.totalAmountPhp.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="font-bold text-[#334E73]">Derived Unit Cost</div>
                          <div className="font-mono text-sm font-black tabular-nums text-[#111827]">
                            ₱{lastSubmission.postedDelivery.unitCostPhp.toFixed(4)}/L
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {onOpenDepotLedger && (
                      <button
                        type="button"
                        data-testid="view-depot-ledger-btn"
                        onClick={onOpenDepotLedger}
                        className="min-h-[56px] w-full rounded-xl bg-[#059669] px-5 py-4 text-base font-black text-white hover:bg-[#047857]"
                      >
                        View in Depot Ledger Register →
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="back-to-tanks-btn"
                      onClick={handleBackToTanks}
                      className={`min-h-[56px] w-full rounded-xl bg-[#111827] px-5 py-4 text-base font-black text-white hover:bg-[#1F2937] ${
                        onOpenDepotLedger ? '' : 'sm:col-span-2'
                      }`}
                    >
                      Back to Tanks
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section
                data-testid="routine-receipt-card"
                className="overflow-hidden rounded-2xl border-2 border-[#111827] bg-white shadow-md"
              >
                <div className="h-3 w-full" style={{ backgroundColor: gradeStyle.hex }} />
                <div className="p-5 sm:p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] pb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#ECFDF5] border-2 border-[#059669] text-[#059669]">
                        <CheckCircle2 className="h-7 w-7" />
                      </div>
                      <div>
                        <div className="text-xs font-extrabold uppercase tracking-wider text-[#065F46]">
                          Routine Inventory Reading Locked
                        </div>
                        <h3 className="text-xl font-black text-[#111827]">
                          {lastSubmission.tankNumber} ({lastSubmission.payload.tankId}) —{' '}
                          {gradeStyle.label}
                        </h3>
                      </div>
                    </div>
                    <span className="font-mono text-xs sm:text-sm font-bold text-[#374151]">
                      {formatReadableTimestamp(lastSubmission.payload.timestamp)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl border-2 border-[#D1D5DB] bg-[#F9FAFB] p-4">
                      <div className="text-xs font-bold uppercase text-[#4B5563]">
                        Calculated Volume
                      </div>
                      <div className="mt-1 font-mono text-2xl font-black tabular-nums text-[#111827]">
                        {formatLiters(lastSubmission.payload.calculatedVolumeLiters)} L
                      </div>
                      <div className="font-mono text-xs text-[#4B5563]">
                        Dip: {lastSubmission.payload.dipHeightCm} cm · Water:{' '}
                        {lastSubmission.payload.waterHeightCm} cm
                      </div>
                    </div>

                    <div className="rounded-xl border-2 border-[#D1D5DB] bg-[#F9FAFB] p-4">
                      <div className="text-xs font-bold uppercase text-[#4B5563]">
                        Available Ullage
                      </div>
                      <div className="mt-1 font-mono text-2xl font-black tabular-nums text-[#065F46]">
                        {formatLiters(lastSubmission.payload.ullageLiters)} L
                      </div>
                      <div className="text-xs text-[#4B5563]">
                        Operator: {lastSubmission.operatorName}
                      </div>
                    </div>

                    <div className="rounded-xl border-2 border-[#D1D5DB] bg-[#F9FAFB] p-4">
                      <div className="text-xs font-bold uppercase text-[#4B5563]">
                        Variance Status
                      </div>
                      {canViewRunningBalances ? (
                        <>
                          <div
                            className={`mt-1 font-mono text-xl font-black tabular-nums ${
                              lastSubmission.reDipRecommended ? 'text-[#B45309]' : 'text-[#065F46]'
                            }`}
                          >
                            {lastSubmission.payload.varianceLiters > 0 ? '+' : ''}
                            {formatLiters(lastSubmission.payload.varianceLiters)} L (
                            {lastSubmission.variancePct > 0 ? '+' : ''}
                            {lastSubmission.variancePct.toFixed(2)}%)
                          </div>
                          <div className="text-xs font-bold text-[#4B5563]">
                            {lastSubmission.reDipRecommended
                              ? 'Exceeds ±0.5% — Re-dip Flagged'
                              : 'Within ±0.5% Tolerance'}
                          </div>
                        </>
                      ) : (
                        <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-[#374151]">
                          <Lock className="h-4 w-4 shrink-0" />
                          <span>Logged for GSO Head / Admin Audit</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {lastSubmission.notes && (
                    <div className="rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] px-4 py-3 text-sm">
                      <strong className="text-[#111827]">Notes:</strong>{' '}
                      <span className="text-[#374151]">{lastSubmission.notes}</span>
                    </div>
                  )}

                  {lastSubmission.photoDataUrl && (
                    <div className="flex items-center gap-3 rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] p-3">
                      <img
                        src={lastSubmission.photoDataUrl}
                        alt="Attached dipstick verification"
                        className="h-16 w-16 rounded-md object-cover border border-[#9CA3AF]"
                      />
                      <div className="text-xs font-bold text-[#374151]">
                        Attached Dipstick Photo: {lastSubmission.photoName}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowJsonPayload((prev) => !prev)}
                      className="text-xs font-extrabold uppercase tracking-wider text-[#374151] underline"
                    >
                      {showJsonPayload ? 'Hide Structured JSON Payload' : 'Show Structured JSON Payload'}
                    </button>
                    {showJsonPayload && (
                      <pre
                        data-testid="dipstick-json-payload"
                        className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[#D1D5DB] bg-[#111827] p-3.5 font-mono text-xs text-[#F9FAFB]"
                      >
                        {JSON.stringify(displayPayload, null, 2)}
                      </pre>
                    )}
                  </div>

                  <button
                    type="button"
                    data-testid="back-to-tanks-btn"
                    onClick={handleBackToTanks}
                    className="min-h-[56px] w-full rounded-xl bg-[#111827] px-5 py-4 text-base font-black text-white hover:bg-[#1F2937]"
                  >
                    Back to Tanks
                  </button>
                </div>
              </section>
            );
          })()}
        </div>
      )}

      {/* Non-Dismissible Floating Delivery Details Window (Pre-Delivery Check Flow) */}
      {pendingDeliveryModal && (
        <PreDeliveryRecordModal
          context={pendingDeliveryModal.context}
          operatorName={currentUser.displayName}
          canViewRunningBalances={canViewRunningBalances}
          onPostDelivery={handlePostDelivery}
        />
      )}
    </div>
  );
}
