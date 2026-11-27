import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Gauge,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  FuelDepot,
  FuelType,
  InventoryLog,
  StorageTank,
  TripTicket,
  UserAccount,
  WorkPlan,
} from '../types/fuel';
import {
  buildWeightedAverageCostLedger,
  canAccessDepotLedgerRegister,
  canViewDepotTankRunningBalances,
  evaluateInventoryLogDipstick,
  filterDepotInventoryLogs,
  getDynamicProgressiveYearOptions,
  getInventoryDeltaColorClass,
  getInventoryDeltaTone,
  resolveInventoryLogDisplayRefs,
  resolvePrevailingWeightedAverageCost,
} from '../utils/fuelEngine';
import { DipstickLoggingModule } from './DipstickLoggingModule';
import { FuelClassLedgerTab } from './FuelClassLedgerTab';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface DepotInventoryViewProps {
  depots: FuelDepot[];
  storageTanks?: StorageTank[];
  inventoryLogs: InventoryLog[];
  tickets?: TripTicket[];
  workPlans?: WorkPlan[];
  currentUser: UserAccount;
  isOnline?: boolean;
  syncQueueCount?: number;
  onRecordTransaction: (params: {
    depot: FuelDepot;
    fuelType: FuelType;
    transactionType: 'delivery' | 'shrinkage_adjustment' | 'overage_adjustment';
    litersAmount: number;
    deliveryUnitCostPhp?: number;
    deliveryTotalAmountPhp?: number;
    physicalDipLiters?: number;
    tankId?: string;
    referenceNumber: string;
    purchaseOrderRef?: string;
    supplierName?: string;
    deliveryDate?: string;
    notes: string;
    gsoApproverName?: string;
    digitalVerificationCode?: string;
    postImmediately?: boolean;
    requireSeparateGsoApproval?: boolean;
  }) => Promise<InventoryLog | void>;
  onVerifyPending: (
    log: InventoryLog,
    gsoApproverName: string,
    digitalVerificationCode: string
  ) => Promise<void>;
  onRecordTankDip?: (params: {
    tankId: string;
    calculatedVolumeLiters: number;
    timestampIso: string;
  }) => Promise<void> | void;
}

const MONTH_OPTIONS = [
  { value: 'all', label: 'All Months' },
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function DepotInventoryView({
  depots,
  storageTanks = [],
  inventoryLogs,
  tickets = [],
  workPlans = [],
  currentUser,
  isOnline = true,
  syncQueueCount = 0,
  onRecordTransaction,
  onVerifyPending,
  onRecordTankDip,
}: DepotInventoryViewProps) {
  const canAccessLedger = canAccessDepotLedgerRegister(currentUser.role);
  const canViewTankBalances = canViewDepotTankRunningBalances(currentUser.role);
  const [activeSubView, setActiveSubView] = useState<
    'ledger' | 'diesel_ledger' | 'gasoline_ledger' | 'dipstick'
  >(() => (canAccessLedger ? 'ledger' : 'dipstick'));
  const effectiveSubView: 'ledger' | 'diesel_ledger' | 'gasoline_ledger' | 'dipstick' =
    canAccessLedger ? activeSubView : 'dipstick';

  const [previewOpen, setPreviewOpen] = useState(false);
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [fuelTypeFilter, setFuelTypeFilter] = useState<FuelType | 'all'>('all');
  const [depotAreaFilter, setDepotAreaFilter] = useState('all');
  const [verifyCodes, setVerifyCodes] = useState<Record<string, string>>({});
  const [verifyErrors, setVerifyErrors] = useState<Record<string, string>>({});
  const [verifyingLogId, setVerifyingLogId] = useState<string | null>(null);

  const prevailingDieselWac = useMemo(
    () =>
      resolvePrevailingWeightedAverageCost({
        fuelType: 'diesel',
        inventoryLogs,
        depots,
      }),
    [inventoryLogs, depots]
  );

  const prevailingGasolineWac = useMemo(
    () =>
      resolvePrevailingWeightedAverageCost({
        fuelType: 'gasoline',
        inventoryLogs,
        depots,
      }),
    [inventoryLogs, depots]
  );

  const yearOptions = useMemo(
    () =>
      getDynamicProgressiveYearOptions({
        workPlans,
        tickets,
        inventoryLogs,
        order: 'asc',
      }),
    [workPlans, tickets, inventoryLogs]
  );

  const filteredLogs = useMemo(
    () =>
      filterDepotInventoryLogs(inventoryLogs, {
        month: monthFilter,
        year: yearFilter,
        fuelType: fuelTypeFilter,
        depotId: depotAreaFilter,
      }),
    [inventoryLogs, monthFilter, yearFilter, fuelTypeFilter, depotAreaFilter]
  );

  const allPendingVerifications = useMemo(
    () =>
      inventoryLogs
        .filter((l) => l.approvalStatus === 'pending_gso_approval')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inventoryLogs]
  );

  const wacLedgerRows = useMemo(
    () =>
      buildWeightedAverageCostLedger(
        inventoryLogs,
        depots,
        {
          month: monthFilter,
          year: yearFilter,
          fuelType: fuelTypeFilter,
          depotId: depotAreaFilter,
        },
        storageTanks
      ),
    [inventoryLogs, depots, storageTanks, monthFilter, yearFilter, fuelTypeFilter, depotAreaFilter]
  );

  const hasActiveFilters = Boolean(
    monthFilter !== 'all' ||
      yearFilter !== 'all' ||
      fuelTypeFilter !== 'all' ||
      depotAreaFilter !== 'all'
  );

  const resetFilters = () => {
    setMonthFilter('all');
    setYearFilter('all');
    setFuelTypeFilter('all');
    setDepotAreaFilter('all');
  };

  const handleVerifyPendingLog = async (log: InventoryLog) => {
    const code = (verifyCodes[log.id] ?? '').trim().toUpperCase();
    if (!canAccessLedger || code.length < 4) return;
    setVerifyingLogId(log.id);
    setVerifyErrors((prev) => {
      if (!prev[log.id]) return prev;
      const next = { ...prev };
      delete next[log.id];
      return next;
    });
    try {
      await onVerifyPending(log, currentUser.displayName, code);
      setVerifyCodes((prev) => ({ ...prev, [log.id]: '' }));
    } catch (err) {
      setVerifyErrors((prev) => ({
        ...prev,
        [log.id]:
          err instanceof Error
            ? err.message
            : 'Invalid GSO Head verification code. Verification blocked.',
      }));
    } finally {
      setVerifyingLogId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Depot Inventory Sub-Module Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#D5DCE6] bg-white p-2">
        <div role="tablist" aria-label="Depot Inventory Modules" className="flex flex-wrap items-center gap-2">
          {canAccessLedger && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveSubView === 'ledger'}
                data-testid="depot-tab-ledger"
                onClick={() => setActiveSubView('ledger')}
                className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors ${
                  effectiveSubView === 'ledger'
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                }`}
              >
                <Database className="h-4 w-4" />
                <span>Depot Stock &amp; Verifications</span>
                {allPendingVerifications.length > 0 && (
                  <span
                    data-testid="depot-pending-count-badge"
                    className="ml-0.5 rounded bg-amber-500 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#0B192C]"
                  >
                    {allPendingVerifications.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={effectiveSubView === 'diesel_ledger'}
                data-testid="depot-tab-diesel-ledger"
                onClick={() => setActiveSubView('diesel_ledger')}
                className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors ${
                  effectiveSubView === 'diesel_ledger'
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-[#F59E0B]" aria-hidden="true" />
                <span>Diesel Ledger</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={effectiveSubView === 'gasoline_ledger'}
                data-testid="depot-tab-gasoline-ledger"
                onClick={() => setActiveSubView('gasoline_ledger')}
                className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors ${
                  effectiveSubView === 'gasoline_ledger'
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-[#EF4444]" aria-hidden="true" />
                <span>Gasoline Ledger</span>
              </button>
            </>
          )}

          <button
            type="button"
            role="tab"
            aria-selected={effectiveSubView === 'dipstick'}
            data-testid="depot-tab-dipstick"
            onClick={() => setActiveSubView('dipstick')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors ${
              effectiveSubView === 'dipstick'
                ? 'bg-[#0B192C] text-white'
                : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
            }`}
          >
            <Gauge className="h-4 w-4" />
            <span>UST Dipstick & Pre-Delivery Check</span>
          </button>
        </div>

        {!canViewTankBalances && (
          <div
            data-testid="depot-balance-rbac-banner"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1.5 text-[11px] font-semibold text-[#334E73]"
          >
            <Lock className="h-3.5 w-3.5 text-[#1B3B6F] shrink-0" />
            <span>Tank Balances &amp; Ledger Register: Admin &amp; GSO Head Only</span>
          </div>
        )}
      </div>

      {effectiveSubView === 'dipstick' || !canAccessLedger ? (
        <DipstickLoggingModule
          depots={depots}
          storageTanks={storageTanks}
          inventoryLogs={inventoryLogs}
          currentUser={currentUser}
          canViewRunningBalances={canViewTankBalances}
          isOnline={isOnline}
          syncQueueCount={syncQueueCount}
          onRecordTankDip={onRecordTankDip}
          onPostPreDeliveryAdjustment={async (adjParams) => {
            const postedAdj = await onRecordTransaction({
              ...adjParams,
              postImmediately: false,
              requireSeparateGsoApproval: true,
            });
            return postedAdj;
          }}
          onPostPreDelivery={async (deliveryParams) => {
            const postedLog = await onRecordTransaction({
              ...deliveryParams,
              transactionType: 'delivery',
              postImmediately: false,
              requireSeparateGsoApproval: true,
            });
            if (canAccessLedger) {
              resetFilters();
              setPreviewOpen(false);
            }
            return postedLog;
          }}
          onOpenDepotLedger={
            canAccessLedger
              ? () => {
                  resetFilters();
                  setPreviewOpen(false);
                  setActiveSubView('ledger');
                }
              : undefined
          }
        />
      ) : effectiveSubView === 'diesel_ledger' ? (
        <FuelClassLedgerTab
          fuelType="diesel"
          depots={depots}
          storageTanks={storageTanks}
          inventoryLogs={inventoryLogs}
          yearOptions={yearOptions}
          monthOptions={MONTH_OPTIONS}
        />
      ) : effectiveSubView === 'gasoline_ledger' ? (
        <FuelClassLedgerTab
          fuelType="gasoline"
          depots={depots}
          storageTanks={storageTanks}
          inventoryLogs={inventoryLogs}
          yearOptions={yearOptions}
          monthOptions={MONTH_OPTIONS}
        />
      ) : (
        <div className="space-y-6">
          {/* Depot Tank Summary Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {depots.map((depot) => {
              const gasPct = Math.round(
                (depot.gasolineCurrentLiters / depot.gasolineCapacityLiters) * 100
              );
              const dslPct = Math.round(
                (depot.dieselCurrentLiters / depot.dieselCapacityLiters) * 100
              );
              return (
                <div key={depot.id} className="rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-display text-base font-bold text-[#0B192C]">{depot.name}</h2>
                      <p className="text-xs text-[#5A6F8C]">{depot.location}</p>
                    </div>
                    <Database className="h-5 w-5 text-[#1B3B6F] shrink-0" />
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-3 space-y-1">
                      <div className="text-[11px] font-semibold text-[#5A6F8C]">GASOLINE TANK</div>
                      {canViewTankBalances ? (
                        <>
                          <div
                            data-testid={`depot-gas-balance-${depot.id}`}
                            className="font-mono text-lg font-bold tabular-nums text-[#0B192C]"
                          >
                            {depot.gasolineCurrentLiters.toLocaleString()} L
                          </div>
                          <div className="font-mono text-[11px] text-[#334E73]">
                            Cap: {depot.gasolineCapacityLiters.toLocaleString()} L ({gasPct}%)
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            data-testid={`depot-gas-balance-restricted-${depot.id}`}
                            className="inline-flex items-center gap-1.5 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#334E73]"
                          >
                            <Lock className="h-3 w-3 shrink-0 text-[#5A6F8C]" />
                            <span>Balance Restricted</span>
                          </div>
                          <div className="font-mono text-[11px] text-[#334E73]">
                            Cap: {depot.gasolineCapacityLiters.toLocaleString()} L
                          </div>
                        </>
                      )}
                      <div className="font-mono text-[11px] font-semibold text-[#1B3B6F]">
                        WAC: ₱{depot.gasolinePricePerLiter.toFixed(2)}/L
                      </div>
                    </div>
                    <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-3 space-y-1">
                      <div className="text-[11px] font-semibold text-[#5A6F8C]">DIESEL TANK</div>
                      {canViewTankBalances ? (
                        <>
                          <div
                            data-testid={`depot-diesel-balance-${depot.id}`}
                            className="font-mono text-lg font-bold tabular-nums text-[#0B192C]"
                          >
                            {depot.dieselCurrentLiters.toLocaleString()} L
                          </div>
                          <div className="font-mono text-[11px] text-[#334E73]">
                            Cap: {depot.dieselCapacityLiters.toLocaleString()} L ({dslPct}%)
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            data-testid={`depot-diesel-balance-restricted-${depot.id}`}
                            className="inline-flex items-center gap-1.5 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#334E73]"
                          >
                            <Lock className="h-3 w-3 shrink-0 text-[#5A6F8C]" />
                            <span>Balance Restricted</span>
                          </div>
                          <div className="font-mono text-[11px] text-[#334E73]">
                            Cap: {depot.dieselCapacityLiters.toLocaleString()} L
                          </div>
                        </>
                      )}
                      <div className="font-mono text-[11px] font-semibold text-[#1B3B6F]">
                        WAC: ₱{depot.dieselPricePerLiter.toFixed(2)}/L
                      </div>
                    </div>
                  </div>

                  {/* Per-Tank Independent WAC & Book Balance Breakdown */}
                  {(() => {
                    const depotTanks = storageTanks.filter((t) => t.depotId === depot.id);
                    if (depotTanks.length === 0) return null;
                    return (
                      <div
                        data-testid={`depot-per-tank-wac-list-${depot.id}`}
                        className="border-t border-[#E6EBF2] pt-3 space-y-1.5"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
                          Registered Storage Tanks · Per-Tank WAC
                        </div>
                        <div className="divide-y divide-[#E6EBF2] rounded-md border border-[#E6EBF2] bg-[#F9FAFC]">
                          {depotTanks.map((tank) => {
                            const tankWac = resolvePrevailingWeightedAverageCost({
                              fuelType: tank.mappedFuelType,
                              inventoryLogs,
                              depots,
                              storageTanks,
                              depotId: depot.id,
                              tankId: tank.id,
                            });
                            return (
                              <div
                                key={tank.id}
                                data-testid={`tank-wac-row-${tank.tankCode}`}
                                className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className={`h-2 w-2 rounded-full shrink-0 ${
                                      tank.mappedFuelType === 'diesel'
                                        ? 'bg-[#F59E0B]'
                                        : 'bg-[#EF4444]'
                                    }`}
                                  />
                                  <span className="font-mono font-bold text-[#0B192C]">
                                    {tank.tankCode}
                                  </span>
                                  <span className="text-[11px] text-[#5A6F8C] truncate">
                                    ({tank.mappedFuelType.toUpperCase()})
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
                                  {canViewTankBalances && (
                                    <span className="text-[#334E73]">
                                      {tank.currentBookVolumeLiters.toLocaleString('en-US', {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })}{' '}
                                      L
                                    </span>
                                  )}
                                  <span
                                    data-testid={`tank-wac-value-${tank.tankCode}`}
                                    className="font-bold text-[#1B3B6F]"
                                  >
                                    ₱{tankWac.toFixed(4)}/L
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="text-xs text-[#5A6F8C] border-t border-[#E6EBF2] pt-2.5">
                    Last Dip Verification:{' '}
                    <span className="font-medium text-[#0B192C]">
                      {depot.lastDipVerifiedBy || 'Not yet recorded'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pending GSO Head Verifications Queue (Separate Approval for Dipstick Variance Adjustments & Deliveries) */}
          {allPendingVerifications.length > 0 && (
            <section
              data-testid="pending-gso-verifications-panel"
              className="rounded-lg border border-amber-300 bg-white overflow-hidden shadow-sm"
            >
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-800 shrink-0" />
                  <div>
                    <h3 className="font-display text-xs font-bold text-amber-950">
                      Pending GSO Head Verifications ({allPendingVerifications.length})
                    </h3>
                    <p className="text-[11px] text-amber-900">
                      Pre-delivery dipstick variance adjustments and fuel deliveries post separately and each requires its own GSO Head verification approval.
                    </p>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-[#E6EBF2]">
                {allPendingVerifications.map((log) => {
                  const isDelivery = log.transactionType === 'delivery';
                  const pendingDipEval = evaluateInventoryLogDipstick(log);
                  const linkedTank = log.tankId
                    ? storageTanks.find((t) => t.id === log.tankId)
                    : undefined;
                  return (
                    <div
                      key={log.id}
                      data-testid={`pending-verification-row-${log.id}`}
                      data-tx-type={log.transactionType}
                      className="flex flex-col gap-2.5 p-3 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="space-y-1 text-xs min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                              isDelivery
                                ? 'border-blue-300 bg-blue-50 text-blue-900'
                                : 'border-amber-300 bg-amber-50 text-amber-900'
                            }`}
                          >
                            {isDelivery
                              ? 'Fuel Delivery'
                              : log.transactionType === 'overage_adjustment'
                                ? 'Dipstick Variance · Overage'
                                : 'Dipstick Variance · Shrinkage'}
                          </span>
                          {log.gsoTransactionCode && (
                            <span className="font-mono font-bold text-[#1B3B6F]">
                              {log.gsoTransactionCode}
                            </span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-bold text-[#0B192C]">
                            {log.referenceNumber}
                          </span>
                          {log.purchaseOrderRef && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] text-[#334E73]">
                                PO: {log.purchaseOrderRef}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#1B3B6F]">{log.depotName}</span>
                          {linkedTank && (
                            <span className="rounded bg-[#EEF2F8] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#0B192C]">
                              {linkedTank.tankCode}
                            </span>
                          )}
                          <span className="uppercase font-mono text-[11px] text-[#5A6F8C]">
                            {log.fuelType}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#334E73]">
                          <span>
                            {isDelivery ? 'Delivery Qty:' : 'Adjustment:'}{' '}
                            <span className={`font-mono font-bold ${getInventoryDeltaColorClass(log)}`}>
                              {log.litersDelta > 0 ? '+' : ''}
                              {log.litersDelta.toFixed(1)} L
                            </span>
                          </span>
                          {isDelivery && log.deliveryUnitCostPhp !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-semibold text-[#0B192C]">
                                Unit: ₱{log.deliveryUnitCostPhp.toFixed(4)}/L
                              </span>
                            </>
                          )}
                          {isDelivery && log.deliveryTotalAmountPhp !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-semibold text-[#1B3B6F]">
                                Total: ₱
                                {log.deliveryTotalAmountPhp.toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </>
                          )}
                          {!isDelivery && pendingDipEval && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                Physical Dip:{' '}
                                <strong className="font-mono text-[#0B192C]">
                                  {pendingDipEval.dipstickLiters.toLocaleString()} L
                                </strong>
                              </span>
                            </>
                          )}
                          {log.notes && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#5A6F8C]">{log.notes}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            disabled={!canAccessLedger || verifyingLogId === log.id}
                            data-testid={`verify-code-input-${log.id}`}
                            placeholder="GSO Head Code"
                            value={verifyCodes[log.id] ?? ''}
                            onChange={(e) => {
                              const nextVal = e.target.value.toUpperCase();
                              setVerifyCodes((prev) => ({ ...prev, [log.id]: nextVal }));
                              setVerifyErrors((prev) => {
                                if (!prev[log.id]) return prev;
                                const next = { ...prev };
                                delete next[log.id];
                                return next;
                              });
                            }}
                            className="w-36 sm:w-44 rounded-md border border-[#D5DCE6] px-2.5 py-1.5 font-mono text-xs uppercase text-[#0B192C]"
                          />
                          <button
                            type="button"
                            data-testid={`verify-submit-btn-${log.id}`}
                            disabled={
                              !canAccessLedger ||
                              verifyingLogId === log.id ||
                              (verifyCodes[log.id] ?? '').trim().length < 4
                            }
                            onClick={() => handleVerifyPendingLog(log)}
                            className="inline-flex items-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50 whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>
                              {verifyingLogId === log.id
                                ? 'Verifying...'
                                : isDelivery
                                  ? 'Approve Delivery'
                                  : 'Approve Adjustment'}
                            </span>
                          </button>
                        </div>
                        {verifyErrors[log.id] && (
                          <div
                            role="alert"
                            data-testid={`verify-error-${log.id}`}
                            className="max-w-xs text-right text-[11px] font-semibold text-[#B91C1C]"
                          >
                            {verifyErrors[log.id]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Automated Depot Ledger Register & WAC Monitoring */}
      <RecordsPreviewGate
        title="Depot Ledger Register & Per-Tank WAC History"
        description="Fuel deliveries, dispensing deductions, Per-Tank Weighted Average Cost (WAC) monitoring, and pre-delivery dipstick variance adjustments."
        recordCount={inventoryLogs.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Ledger"
        maxWidthClass="max-w-[96vw] sm:max-w-4xl lg:max-w-6xl"
      >
        <div className="space-y-2.5">
          {/* Month, Year, Fuel Type & Depot Area Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#D5DCE6] bg-white p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                id="inv-filter-month"
                aria-label="Filter by Month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 text-[11px] text-[#0B192C]"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                id="inv-filter-year"
                aria-label="Filter by Year"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 font-mono text-[11px] text-[#0B192C]"
              >
                <option value="all">All Years</option>
                {yearOptions.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>

              <select
                id="inv-filter-fuel"
                aria-label="Filter by Fuel Type"
                value={fuelTypeFilter}
                onChange={(e) => setFuelTypeFilter(e.target.value as FuelType | 'all')}
                className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 text-[11px] text-[#0B192C]"
              >
                <option value="all">All Fuel</option>
                <option value="diesel">Diesel</option>
                <option value="gasoline">Gasoline</option>
              </select>

              <select
                id="inv-filter-depot"
                aria-label="Filter by Depot Area"
                value={depotAreaFilter}
                onChange={(e) => setDepotAreaFilter(e.target.value)}
                className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 text-[11px] text-[#0B192C]"
              >
                <option value="all">All Depots</option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-[#5A6F8C]">
                {filteredLogs.length}/{inventoryLogs.length} logs
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2 py-1 text-[11px] font-semibold text-[#1B3B6F] hover:bg-[#E6EBF2]"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Weighted Average Cost (WAC) Tabular Monitoring per Storage Tank */}
          <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE6] bg-[#F8FAFC] px-3 py-2">
              <div>
                <h3 className="font-display text-xs font-bold text-[#0B192C]">
                  Per-Tank Weighted Average Cost (WAC) Monitoring ({wacLedgerRows.length})
                </h3>
                <p className="text-[10px] text-[#5A6F8C]">
                  Each storage tank maintains its own WAC computed upon verified delivery to that tank; referenced vis-à-vis timestamp of fuel dispensing.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span
                  data-testid="wac-current-diesel"
                  className="rounded border border-[#C5D1E3] bg-[#EEF2F8] px-2 py-0.5 font-bold text-[#0B192C]"
                >
                  Diesel WAC: ₱{prevailingDieselWac.toFixed(2)}/L
                </span>
                <span
                  data-testid="wac-current-gasoline"
                  className="rounded border border-[#C5D1E3] bg-[#EEF2F8] px-2 py-0.5 font-bold text-[#1B3B6F]"
                >
                  Gasoline WAC: ₱{prevailingGasolineWac.toFixed(2)}/L
                </span>
              </div>
            </div>

            {wacLedgerRows.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#5A6F8C]">
                No fuel delivery records match the current filter to compute WAC history.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table data-testid="wac-monitoring-table" className="w-full text-left text-[11px]">
                  <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                    <tr>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold whitespace-nowrap">Timestamp</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold whitespace-nowrap">Tx / Ref #</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-bold whitespace-nowrap">Depot / Tank</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold whitespace-nowrap">Fuel Class</th>
                      {canViewTankBalances && (
                        <th className="px-2 py-1.5 text-right text-[10px] font-bold whitespace-nowrap">Tank Bal Before</th>
                      )}
                      <th className="px-2 py-1.5 text-right text-[10px] font-bold whitespace-nowrap">Prev Tank WAC</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-bold whitespace-nowrap">Delivery (L)</th>
                      <th className="px-2 py-1.5 text-right text-[10px] font-bold whitespace-nowrap">Unit Cost</th>
                      {canViewTankBalances && (
                        <th className="px-2 py-1.5 text-right text-[10px] font-bold whitespace-nowrap">Tank Bal After</th>
                      )}
                      <th className="px-2 py-1.5 text-right text-[10px] font-bold whitespace-nowrap">New Tank WAC</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-bold whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF2]">
                    {wacLedgerRows.map((row) => (
                      <tr key={row.logId} className="hover:bg-[#F9FAFC]">
                        <td className="px-2 py-1.5 font-mono text-[10px] text-[#5A6F8C] whitespace-nowrap">
                          {row.timestamp.slice(0, 10)} {row.timestamp.slice(11, 16)}
                        </td>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                          <span className="font-bold text-[#1B3B6F]">{row.gsoTransactionCode}</span>
                          <span className="ml-1 text-[10px] text-[#5A6F8C]">({row.referenceNumber})</span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <div className="font-medium text-[#0B192C]">{row.depotName}</div>
                          {row.tankCode && (
                            <div className="font-mono text-[10px] font-bold text-[#1B3B6F]">
                              {row.tankCode}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono text-[10px] font-bold uppercase text-[#1B3B6F]">
                          {row.fuelType}
                        </td>
                        {canViewTankBalances && (
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                            {row.stockBeforeLiters.toLocaleString()} L
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[#5A6F8C] whitespace-nowrap">
                          ₱{row.previousWacPhp.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-blue-700 whitespace-nowrap">
                          +{row.deliveredLiters.toLocaleString()} L
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[#0B192C] whitespace-nowrap">
                          ₱{row.deliveryUnitCostPhp.toFixed(2)}
                        </td>
                        {canViewTankBalances && (
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                            {row.stockAfterLiters.toLocaleString()} L
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums text-[#0B192C] whitespace-nowrap">
                          ₱{row.newPrevailingWacPhp.toFixed(4)}/L
                        </td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                          {row.approvalStatus === 'verified' ? (
                            <span className="font-semibold text-emerald-800">Verified</span>
                          ) : (
                            <span className="font-semibold text-amber-800">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE6] px-3 py-2">
              <h3 className="font-display text-xs font-bold text-[#0B192C]">
                Transaction Logs ({filteredLogs.length})
              </h3>
              <div className="hidden sm:flex flex-wrap items-center gap-2 text-[10px] font-semibold">
                <span className="text-blue-700">Blue: Delivery</span>
                <span aria-hidden="true" className="text-[#C5D1E3]">|</span>
                <span className="text-emerald-700">Green: Overage</span>
                <span aria-hidden="true" className="text-[#C5D1E3]">|</span>
                <span className="text-red-700">Red: Deduction/Shortage</span>
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#5A6F8C]">
                {hasActiveFilters
                  ? 'No depot inventory logs match your active filters.'
                  : 'No depot inventory logs recorded yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table data-testid="inventory-logs-table" className="w-full text-left text-[11px]">
                  <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                    <tr>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Time
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Tx Code
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Ticket #
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Ref #
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Depot / Fuel
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Type
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Delta (L)
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        WAC / Cost
                      </th>
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Dip (L)
                      </th>
                      {canViewTankBalances && (
                        <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                          Bal (L)
                        </th>
                      )}
                      <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] font-bold tracking-wide leading-tight whitespace-nowrap">
                        Verified
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF2]">
                    {filteredLogs.map((log) => {
                      const refs = resolveInventoryLogDisplayRefs(log);
                      const deltaTone = getInventoryDeltaTone(log);
                      const deltaClass = getInventoryDeltaColorClass(log);
                      const rowDipEval = evaluateInventoryLogDipstick(log);
                      const wacDisplay =
                        log.transactionType === 'delivery'
                          ? log.weightedAverageCostAfter ?? log.prevailingWeightedAverageCostPhp
                          : log.prevailingWeightedAverageCostPhp ??
                            resolvePrevailingWeightedAverageCost({
                              fuelType: log.fuelType,
                              timestampIso: log.verifiedAt || log.createdAt,
                              inventoryLogs,
                              depots,
                              storageTanks,
                              depotId: log.depotId,
                              tankId: log.tankId,
                            });
                      return (
                        <tr key={log.id} className="hover:bg-[#F9FAFC]">
                          <td className="px-1.5 py-1.5 sm:px-2 font-mono text-[10px] text-[#5A6F8C] whitespace-nowrap">
                            <div>{log.createdAt.slice(0, 10)}</div>
                            <div>{log.createdAt.slice(11, 16)}</div>
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2 font-mono font-bold text-[#1B3B6F] whitespace-nowrap">
                            {log.gsoTransactionCode || '—'}
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2 font-mono font-semibold text-[#0B192C] whitespace-nowrap">
                            {refs.tripTicketNumber}
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2 font-mono font-semibold text-[#0B192C]">
                            <div>{refs.referenceText}</div>
                            {log.purchaseOrderRef && (
                              <div className="text-[10px] font-medium text-[#334E73]">
                                PO: {log.purchaseOrderRef}
                              </div>
                            )}
                            {log.supplierName && (
                              <div className="font-sans text-[10px] font-normal text-[#5A6F8C] truncate max-w-[160px]">
                                {log.supplierName}
                              </div>
                            )}
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2">
                            <div className="font-medium text-[#0B192C] leading-snug">{log.depotName}</div>
                            <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-[#5A6F8C]">
                              <span className="uppercase font-bold text-[#1B3B6F]">{log.fuelType}</span>
                              {(() => {
                                const linkedTank = log.tankId
                                  ? storageTanks.find((t) => t.id === log.tankId)
                                  : undefined;
                                return (
                                  <>
                                    {linkedTank && (
                                      <span className="rounded bg-[#EEF2F8] px-1 text-[#0B192C] font-semibold">
                                        {linkedTank.tankCode}
                                      </span>
                                    )}
                                    {log.pumpId && (
                                      <span className="rounded bg-[#F3F4F6] border border-[#D1D5DB] px-1 text-[#111827] font-semibold">
                                        {log.pumpId}
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2 capitalize text-[#334E73]">
                            {log.transactionType.replace(/_/g, ' ')}
                          </td>
                          <td
                            data-delta-tone={deltaTone}
                            className={`px-1.5 py-1.5 sm:px-2 text-right font-mono font-bold tabular-nums whitespace-nowrap ${deltaClass}`}
                          >
                            {log.litersDelta >= 0 ? '+' : ''}
                            {log.litersDelta.toFixed(1)} L
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2 text-right font-mono tabular-nums whitespace-nowrap">
                            {wacDisplay !== undefined ? (
                              <div>
                                <div className="font-bold text-[#0B192C]">
                                  ₱{wacDisplay.toFixed(2)}/L
                                </div>
                                {log.transactionType === 'delivery' &&
                                  log.deliveryUnitCostPhp !== undefined && (
                                    <div className="text-[10px] text-[#5A6F8C]">
                                      Unit: ₱{log.deliveryUnitCostPhp.toFixed(2)}
                                    </div>
                                  )}
                                {log.transactionType === 'delivery' &&
                                  log.deliveryTotalAmountPhp !== undefined && (
                                    <div className="text-[10px] font-semibold text-[#1B3B6F]">
                                      Amt: ₱
                                      {log.deliveryTotalAmountPhp.toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </div>
                                  )}
                              </div>
                            ) : (
                              <span className="text-[#5A6F8C]">—</span>
                            )}
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2">
                            {rowDipEval ? (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="font-mono font-semibold text-[#0B192C] tabular-nums whitespace-nowrap">
                                  {rowDipEval.dipstickLiters.toLocaleString()} L
                                </span>
                                {canViewTankBalances && (
                                  <span
                                    data-dipstick-status={rowDipEval.status}
                                    className={`rounded border px-1 py-0.5 font-mono text-[10px] font-bold whitespace-nowrap ${rowDipEval.badgeClass}`}
                                  >
                                    {rowDipEval.status === 'overage'
                                      ? `+${rowDipEval.varianceLiters.toFixed(1)} L`
                                      : rowDipEval.status === 'shortage'
                                        ? `${rowDipEval.varianceLiters.toFixed(1)} L`
                                        : '0.0 L'}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="font-mono text-[#5A6F8C]">—</span>
                            )}
                          </td>
                          {canViewTankBalances && (
                            <td className="px-1.5 py-1.5 sm:px-2 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                              {log.balanceBefore.toLocaleString()} → {log.balanceAfter.toLocaleString()} L
                            </td>
                          )}
                          <td className="px-1.5 py-1.5 sm:px-2">
                            {log.approvalStatus === 'verified' ? (
                              <div className="text-emerald-800">
                                <div className="font-semibold leading-snug">{log.gsoApproverName}</div>
                                <div className="font-mono text-[10px]">
                                  {log.digitalVerificationCode}
                                </div>
                              </div>
                            ) : (
                              <span className="font-semibold text-amber-800">Pending</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </RecordsPreviewGate>
        </div>
      )}
    </div>
  );
}
