import { useMemo, useState } from 'react';
import { Eye, Lock, X } from 'lucide-react';
import {
  FuelClassLedgerMovement,
  FuelClassLedgerRow,
  FuelDepot,
  FuelType,
  InventoryLog,
  StorageTank,
} from '../types/fuel';
import { buildFuelClassLedger, formatAuditTimestamp } from '../utils/fuelEngine';
import { useEscapeClose } from '../hooks/useEscapeClose';

interface FuelClassLedgerTabProps {
  fuelType: FuelType;
  depots: FuelDepot[];
  storageTanks: StorageTank[];
  inventoryLogs: InventoryLog[];
  yearOptions: string[];
  monthOptions: Array<{ value: string; label: string }>;
}

const MOVEMENT_OPTIONS: Array<{ value: FuelClassLedgerMovement | 'all'; label: string }> = [
  { value: 'all', label: 'All Movements' },
  { value: 'in', label: 'In (Deliveries)' },
  { value: 'out', label: 'Out (Dispensed)' },
  { value: 'adjustment', label: 'Adjustments (Shrinkage / Overage)' },
];

function formatPhp(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-₱${formatted}` : `₱${formatted}`;
}

export function FuelClassLedgerTab({
  fuelType,
  depots,
  storageTanks,
  inventoryLogs,
  yearOptions,
  monthOptions,
}: FuelClassLedgerTabProps) {
  const [depotFilter, setDepotFilter] = useState('all');
  const [tankFilter, setTankFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [movementFilter, setMovementFilter] = useState<FuelClassLedgerMovement | 'all'>('all');
  const [selectedRow, setSelectedRow] = useState<FuelClassLedgerRow | null>(null);

  useEscapeClose(Boolean(selectedRow), () => setSelectedRow(null), 2);

  const isDiesel = fuelType === 'diesel';
  const fuelTitle = isDiesel ? 'Diesel Fuel Ledger' : 'Gasoline Fuel Ledger';
  const accentBorder = isDiesel ? 'border-t-[#F59E0B]' : 'border-t-[#EF4444]';
  const accentDot = isDiesel ? 'bg-[#F59E0B]' : 'bg-[#EF4444]';

  const availableTanks = useMemo(
    () =>
      storageTanks.filter(
        (t) =>
          t.mappedFuelType === fuelType &&
          (depotFilter === 'all' || t.depotId === depotFilter)
      ),
    [storageTanks, fuelType, depotFilter]
  );

  const effectiveTankFilter =
    tankFilter !== 'all' && availableTanks.some((t) => t.id === tankFilter)
      ? tankFilter
      : 'all';

  const { rows, summary } = useMemo(
    () =>
      buildFuelClassLedger({
        fuelType,
        inventoryLogs,
        depots,
        storageTanks,
        depotId: depotFilter,
        tankId: effectiveTankFilter,
        month: monthFilter,
        year: yearFilter,
        movementType: movementFilter,
      }),
    [
      fuelType,
      inventoryLogs,
      depots,
      storageTanks,
      depotFilter,
      effectiveTankFilter,
      monthFilter,
      yearFilter,
      movementFilter,
    ]
  );

  const hasFilters = Boolean(
    depotFilter !== 'all' ||
      effectiveTankFilter !== 'all' ||
      monthFilter !== 'all' ||
      yearFilter !== 'all' ||
      movementFilter !== 'all'
  );

  const resetFilters = () => {
    setDepotFilter('all');
    setTankFilter('all');
    setMonthFilter('all');
    setYearFilter('all');
    setMovementFilter('all');
  };

  return (
    <div data-testid={`fuel-class-ledger-${fuelType}`} className="space-y-4">
      {/* Header & KPI Strip */}
      <div className={`rounded-lg border border-[#D5DCE6] border-t-4 ${accentBorder} bg-white p-4 space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${accentDot}`} aria-hidden="true" />
              <h2 className="font-display text-base font-bold text-[#0B192C]">{fuelTitle}</h2>
            </div>
            <p className="text-xs text-[#5A6F8C]">
              Immutable record of In (deliveries), Out (dispensing), and Adjustments with running volume balance and inventory cost valued at effected {isDiesel ? 'Diesel' : 'Gasoline'} WAC.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-semibold text-[#334E73]">
            <Lock className="h-3.5 w-3.5 text-[#1B3B6F]" />
            <span>Immutable Ledger · Read-Only</span>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
              Total In (Verified)
            </div>
            <div
              data-testid={`ledger-${fuelType}-total-in`}
              className="mt-0.5 font-mono text-sm font-bold tabular-nums text-blue-700"
            >
              +{summary.totalInLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[#5A6F8C]">
              {formatPhp(summary.totalInCostPhp)}
            </div>
          </div>

          <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
              Total Out (Dispensed)
            </div>
            <div
              data-testid={`ledger-${fuelType}-total-out`}
              className="mt-0.5 font-mono text-sm font-bold tabular-nums text-red-700"
            >
              {summary.totalOutLiters > 0 ? '-' : ''}
              {summary.totalOutLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[#5A6F8C]">
              {formatPhp(summary.totalOutCostPhp)}
            </div>
          </div>

          <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
              Net Adjustment
            </div>
            <div
              data-testid={`ledger-${fuelType}-net-adj`}
              className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                summary.netAdjustmentLiters > 0
                  ? 'text-emerald-700'
                  : summary.netAdjustmentLiters < 0
                    ? 'text-red-700'
                    : 'text-[#334E73]'
              }`}
            >
              {summary.netAdjustmentLiters > 0 ? '+' : ''}
              {summary.netAdjustmentLiters.toLocaleString('en-US', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{' '}
              L
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[#5A6F8C]">
              {formatPhp(summary.netAdjustmentCostPhp)}
            </div>
          </div>

          <div className="rounded-md border border-[#CBD5E1] bg-[#EEF2F8] p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F]">
              Running Volume Bal
            </div>
            <div
              data-testid={`ledger-${fuelType}-closing-vol`}
              className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#0B192C]"
            >
              {summary.closingVolumeLiters.toLocaleString('en-US', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{' '}
              L
            </div>
            <div className="font-mono text-[10px] tabular-nums text-[#5A6F8C]">
              Opening: {summary.openingVolumeLiters.toLocaleString()} L
            </div>
          </div>

          <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
              Effected WAC
            </div>
            <div
              data-testid={`ledger-${fuelType}-effected-wac`}
              className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#1B3B6F]"
            >
              ₱{summary.currentEffectedWacPhp.toFixed(4)}/L
            </div>
            <div className="text-[10px] text-[#5A6F8C]">
              Prevailing {isDiesel ? 'Diesel' : 'Gasoline'} rate
            </div>
          </div>

          <div className="rounded-md border border-[#CBD5E1] bg-[#0B192C] p-2.5 text-white">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/75">
              Running Cost (WAC)
            </div>
            <div
              data-testid={`ledger-${fuelType}-closing-cost`}
              className="mt-0.5 font-mono text-sm font-bold tabular-nums text-white"
            >
              {formatPhp(summary.closingInventoryCostPhp)}
            </div>
            <div className="text-[10px] text-white/70">
              {summary.verifiedCount} verified{summary.pendingCount > 0 ? ` · ${summary.pendingCount} pending` : ''}
            </div>
          </div>
        </div>
        {/* Per-Tank Independent WAC Breakdown */}
        {summary.tankBreakdown && summary.tankBreakdown.length > 0 && (
          <div
            data-testid={`ledger-${fuelType}-tank-wac-strip`}
            className="border-t border-[#E6EBF2] pt-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#5A6F8C]">
                Per-Tank Running Volume &amp; Independent WAC (Click tank to filter)
              </span>
              {effectiveTankFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setTankFilter('all')}
                  className="text-[11px] font-semibold text-[#1B3B6F] underline"
                >
                  Show All {isDiesel ? 'Diesel' : 'Gasoline'} Tanks
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {summary.tankBreakdown.map((tk) => {
                const isSelected = effectiveTankFilter === tk.tankId;
                return (
                  <button
                    key={tk.tankId}
                    type="button"
                    data-testid={`ledger-tank-card-${tk.tankCode}`}
                    onClick={() =>
                      setTankFilter((prev) => (prev === tk.tankId ? 'all' : tk.tankId))
                    }
                    className={`rounded-md border p-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-[#0B192C] bg-[#EEF2F8] ring-1 ring-[#0B192C]'
                        : 'border-[#E6EBF2] bg-[#F9FAFC] hover:border-[#94A3B8]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[#0B192C]">
                        {tk.tankCode}
                      </span>
                      <span
                        data-testid={`ledger-tank-wac-${tk.tankCode}`}
                        className="font-mono text-xs font-bold tabular-nums text-[#1B3B6F]"
                      >
                        ₱{tk.currentWacPhp.toFixed(4)}/L
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[#5A6F8C]">
                      {tk.depotName}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-[#334E73]">
                      <span>
                        {tk.runningVolumeLiters.toLocaleString('en-US', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}{' '}
                        L
                      </span>
                      <span className="font-semibold text-[#0B192C]">
                        {formatPhp(tk.runningCostPhp)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#D5DCE6] bg-white p-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label={`Filter ${fuelType} ledger by Depot`}
            data-testid={`ledger-${fuelType}-filter-depot`}
            value={depotFilter}
            onChange={(e) => {
              setDepotFilter(e.target.value);
              setTankFilter('all');
            }}
            className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 text-[11px] text-[#0B192C]"
          >
            <option value="all">All Depots</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {availableTanks.length > 0 && (
            <select
              aria-label={`Filter ${fuelType} ledger by Storage Tank`}
              data-testid={`ledger-${fuelType}-filter-tank`}
              value={effectiveTankFilter}
              onChange={(e) => setTankFilter(e.target.value)}
              className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 font-mono text-[11px] text-[#0B192C]"
            >
              <option value="all">All {isDiesel ? 'Diesel' : 'Gasoline'} Tanks</option>
              {availableTanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tankCode} — {t.name}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label={`Filter ${fuelType} ledger by Movement Type`}
            data-testid={`ledger-${fuelType}-filter-movement`}
            value={movementFilter}
            onChange={(e) => setMovementFilter(e.target.value as FuelClassLedgerMovement | 'all')}
            className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 text-[11px] text-[#0B192C]"
          >
            {MOVEMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            aria-label={`Filter ${fuelType} ledger by Month`}
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2 py-1 text-[11px] text-[#0B192C]"
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            aria-label={`Filter ${fuelType} ledger by Year`}
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
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[#5A6F8C]">
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'} (latest first)
          </span>
          {hasFilters && (
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

      {/* Immutable Ledger Table */}
      <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#5A6F8C]">
            No immutable {isDiesel ? 'Diesel' : 'Gasoline'} ledger movements match your current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table data-testid={`fuel-ledger-table-${fuelType}`} className="w-full text-left text-[11px]">
              <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                <tr>
                  <th className="pl-2.5 pr-1.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Timestamp
                  </th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Tx Code / Ref #
                  </th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Depot / Tank
                  </th>
                  <th className="px-1.5 py-2 text-left text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Movement
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    In (L)
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Out (L)
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Adj (L)
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Running Vol (L)
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Effected WAC
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Tx Cost (₱)
                  </th>
                  <th className="px-1.5 py-2 text-right text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Running Cost (₱)
                  </th>
                  <th className="pl-1.5 pr-2.5 py-2 text-center text-[10px] font-bold tracking-wide whitespace-nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {rows.map((row) => (
                  <tr
                    key={row.log.id}
                    data-testid={`fuel-ledger-row-${row.log.id}`}
                    onClick={() => setSelectedRow(row)}
                    className={`cursor-pointer transition-colors hover:bg-[#F8FAFC] ${
                      !row.isVerified ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <td className="pl-2.5 pr-1.5 py-2 font-mono text-[10px] font-semibold tabular-nums text-[#0B192C] whitespace-nowrap">
                      {formatAuditTimestamp(row.timestamp)}
                    </td>
                    <td className="px-1.5 py-2 font-mono whitespace-nowrap">
                      <div className="font-bold text-[#1B3B6F]">{row.txCode}</div>
                      <div className="text-[10px] text-[#5A6F8C]">
                        {row.referenceText}
                        {row.log.purchaseOrderRef ? ` · PO: ${row.log.purchaseOrderRef}` : ''}
                      </div>
                    </td>
                    <td className="px-1.5 py-2">
                      <div className="font-medium text-[#0B192C] leading-tight whitespace-nowrap">
                        {row.log.depotName}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-[#5A6F8C]">
                        {row.tankCode && <span>{row.tankCode}</span>}
                        {row.pumpId && <span>· {row.pumpId}</span>}
                      </div>
                    </td>
                    <td className="px-1.5 py-2 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          row.movementKind === 'in'
                            ? 'text-blue-700'
                            : row.movementKind === 'out'
                              ? 'text-red-700'
                              : row.log.litersDelta >= 0
                                ? 'text-emerald-700'
                                : 'text-red-700'
                        }`}
                      >
                        {row.movementLabel}
                      </span>
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono font-bold tabular-nums text-blue-700 whitespace-nowrap">
                      {row.inLiters !== null ? `+${row.inLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '—'}
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono font-bold tabular-nums text-red-700 whitespace-nowrap">
                      {row.outLiters !== null ? `-${row.outLiters.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '—'}
                    </td>
                    <td
                      className={`px-1.5 py-2 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                        row.adjustmentLiters === null
                          ? 'text-[#5A6F8C]'
                          : row.adjustmentLiters >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                      }`}
                    >
                      {row.adjustmentLiters !== null
                        ? `${row.adjustmentLiters >= 0 ? '+' : ''}${row.adjustmentLiters.toLocaleString('en-US', {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}`
                        : '—'}
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono font-bold tabular-nums text-[#0B192C] whitespace-nowrap">
                      {row.runningVolumeLiters.toLocaleString('en-US', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      L
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono tabular-nums text-[#1B3B6F] whitespace-nowrap">
                      ₱{row.effectedWacPhp.toFixed(4)}
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                      {formatPhp(row.transactionCostPhp)}
                    </td>
                    <td className="px-1.5 py-2 text-right font-mono font-bold tabular-nums text-[#0B192C] whitespace-nowrap">
                      {formatPhp(row.runningCostPhp)}
                    </td>
                    <td className="pl-1.5 pr-2.5 py-2 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {row.isVerified ? (
                          <span className="font-semibold text-emerald-800">Verified</span>
                        ) : (
                          <span className="font-semibold text-amber-800">Pending</span>
                        )}
                        <Eye className="h-3 w-3 text-[#5A6F8C]" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Read-Only Ledger Entry Detail Modal */}
      {selectedRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fuel Ledger Entry Details"
          data-testid="fuel-ledger-detail-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedRow(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-3 sm:p-5"
        >
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-[#CBD5E1] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#D5DCE6] bg-[#0B192C] px-4 py-3 text-white">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-white/75">
                  {isDiesel ? 'Diesel' : 'Gasoline'} Immutable Ledger · {selectedRow.txCode}
                </div>
                <h3 className="font-display text-sm font-bold text-white">
                  {selectedRow.movementLabel} — {selectedRow.log.depotName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                aria-label="Close ledger entry details"
                className="inline-flex items-center gap-1 rounded-md border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/20"
              >
                <X className="h-3.5 w-3.5" />
                <span>Close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-2.5">
                  <div className="text-[10px] font-bold uppercase text-[#5A6F8C]">Timestamp</div>
                  <div className="mt-0.5 font-mono font-bold text-[#0B192C]">
                    {formatAuditTimestamp(selectedRow.timestamp)}
                  </div>
                </div>
                <div className="rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-2.5">
                  <div className="text-[10px] font-bold uppercase text-[#5A6F8C]">Reference / Ticket</div>
                  <div className="mt-0.5 font-mono font-bold text-[#1B3B6F]">
                    {selectedRow.referenceText}
                    {selectedRow.log.purchaseOrderRef ? ` · PO ${selectedRow.log.purchaseOrderRef}` : ''}
                  </div>
                </div>
                <div className="rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-2.5">
                  <div className="text-[10px] font-bold uppercase text-[#5A6F8C]">Running Volume Balance</div>
                  <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#0B192C]">
                    {selectedRow.runningVolumeLiters.toLocaleString('en-US', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{' '}
                    L
                  </div>
                </div>
                <div className="rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-2.5">
                  <div className="text-[10px] font-bold uppercase text-[#5A6F8C]">Running Cost @ Effected WAC</div>
                  <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#0B192C]">
                    {formatPhp(selectedRow.runningCostPhp)}
                  </div>
                  <div className="font-mono text-[10px] text-[#1B3B6F]">
                    WAC: ₱{selectedRow.effectedWacPhp.toFixed(4)}/L
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-[#D5DCE6] p-3">
                <div>
                  <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Movement Quantity</dt>
                  <dd className="font-mono font-bold text-[#0B192C]">
                    {selectedRow.log.litersDelta >= 0 ? '+' : ''}
                    {selectedRow.log.litersDelta.toFixed(1)} L
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Transaction Cost</dt>
                  <dd className="font-mono font-bold text-[#0B192C]">
                    {formatPhp(selectedRow.transactionCostPhp)}
                  </dd>
                </div>
                {selectedRow.tankCode && (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Storage Tank</dt>
                    <dd className="font-mono font-semibold text-[#0B192C]">{selectedRow.tankCode}</dd>
                  </div>
                )}
                {selectedRow.pumpId && (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Dispenser Pump</dt>
                    <dd className="font-mono font-semibold text-[#0B192C]">{selectedRow.pumpId}</dd>
                  </div>
                )}
                {selectedRow.log.supplierName && (
                  <div className="col-span-2">
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Supplier</dt>
                    <dd className="font-medium text-[#0B192C]">{selectedRow.log.supplierName}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Verification Status</dt>
                  <dd className="font-semibold text-[#0B192C]">
                    {selectedRow.isVerified ? 'Verified' : 'Pending GSO Verification'}
                  </dd>
                </div>
                {selectedRow.log.gsoApproverName && (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Verified By</dt>
                    <dd className="font-medium text-[#0B192C]">
                      {selectedRow.log.gsoApproverName}
                      {selectedRow.log.digitalVerificationCode ? ' · GSO Code Verified' : ''}
                    </dd>
                  </div>
                )}
              </dl>

              {selectedRow.log.notes && (
                <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-3">
                  <div className="text-[10px] font-bold uppercase text-[#5A6F8C]">Remarks / Audit Notes</div>
                  <p className="mt-1 text-xs text-[#0B192C] leading-relaxed">{selectedRow.log.notes}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[#D5DCE6] bg-[#F8FAFC] px-4 py-2 text-[11px] text-[#5A6F8C]">
              <span className="inline-flex items-center gap-1 font-medium">
                <Lock className="h-3 w-3 text-[#1B3B6F]" />
                Immutable Ledger Entry
              </span>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="rounded-md bg-[#0B192C] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
