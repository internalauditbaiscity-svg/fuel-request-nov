import { useState } from 'react';
import { CheckCircle2, Database, PlusCircle, ShieldCheck } from 'lucide-react';
import { FuelDepot, FuelType, InventoryLog, UserAccount } from '../types/fuel';
import { canDispenseAtGso } from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface DepotInventoryViewProps {
  depots: FuelDepot[];
  inventoryLogs: InventoryLog[];
  currentUser: UserAccount;
  onRecordTransaction: (params: {
    depot: FuelDepot;
    fuelType: FuelType;
    transactionType: 'delivery' | 'shrinkage_adjustment' | 'overage_adjustment';
    litersAmount: number;
    physicalDipLiters?: number;
    referenceNumber: string;
    notes: string;
    gsoApproverName?: string;
    digitalVerificationCode?: string;
  }) => Promise<void>;
  onVerifyPending: (
    log: InventoryLog,
    gsoApproverName: string,
    digitalVerificationCode: string
  ) => Promise<void>;
}

export function DepotInventoryView({
  depots,
  inventoryLogs,
  currentUser,
  onRecordTransaction,
  onVerifyPending,
}: DepotInventoryViewProps) {
  const isGsoOrAdmin = canDispenseAtGso(currentUser.role);

  const [selectedDepotId, setSelectedDepotId] = useState(depots[0]?.id ?? '');
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [txType, setTxType] = useState<'delivery' | 'shrinkage_adjustment' | 'overage_adjustment'>(
    'delivery'
  );
  const [litersAmount, setLitersAmount] = useState<number>(1000);
  const [physicalDip, setPhysicalDip] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [digitalCode, setDigitalCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [verifyCodes, setVerifyCodes] = useState<Record<string, string>>({});

  const selectedDepot = depots.find((d) => d.id === selectedDepotId) ?? depots[0];
  const pendingAdjustments = inventoryLogs.filter(
    (l) => l.approvalStatus === 'pending_gso_approval'
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDepot || litersAmount <= 0 || !referenceNumber.trim()) return;
    setSubmitting(true);
    try {
      await onRecordTransaction({
        depot: selectedDepot,
        fuelType,
        transactionType: txType,
        litersAmount,
        physicalDipLiters: physicalDip ? Number(physicalDip) : undefined,
        referenceNumber: referenceNumber.trim(),
        notes: notes.trim(),
        gsoApproverName: digitalCode.trim() ? currentUser.displayName : undefined,
        digitalVerificationCode: digitalCode.trim() || undefined,
      });
      setReferenceNumber('');
      setNotes('');
      setDigitalCode('');
      setPhysicalDip('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
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
                  <div className="font-mono text-lg font-bold tabular-nums text-[#0B192C]">
                    {depot.gasolineCurrentLiters.toLocaleString()} L
                  </div>
                  <div className="font-mono text-[11px] text-[#334E73]">
                    Cap: {depot.gasolineCapacityLiters.toLocaleString()} L ({gasPct}%)
                  </div>
                </div>
                <div className="rounded-md border border-[#E6EBF2] bg-[#F9FAFC] p-3 space-y-1">
                  <div className="text-[11px] font-semibold text-[#5A6F8C]">DIESEL TANK</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-[#0B192C]">
                    {depot.dieselCurrentLiters.toLocaleString()} L
                  </div>
                  <div className="font-mono text-[11px] text-[#334E73]">
                    Cap: {depot.dieselCapacityLiters.toLocaleString()} L ({dslPct}%)
                  </div>
                </div>
              </div>

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

      {/* Delivery & Pre-Fill Dipping Adjustment Form */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#E6EBF2] pb-3">
          <PlusCircle className="h-4 w-4 text-[#1B3B6F]" />
          <h3 className="font-display text-sm font-bold text-[#0B192C]">
            Record Fuel Delivery or Pre-Fill Shrinkage / Overage Adjustment
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label htmlFor="inv-depot" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              City Fuel Depot
            </label>
            <select
              id="inv-depot"
              value={selectedDepot?.id ?? ''}
              onChange={(e) => setSelectedDepotId(e.target.value)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
            >
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="inv-fuel" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              Fuel Grade
            </label>
            <select
              id="inv-fuel"
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value as FuelType)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
            >
              <option value="diesel">Diesel</option>
              <option value="gasoline">Gasoline</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-type" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              Transaction Type
            </label>
            <select
              id="inv-type"
              value={txType}
              onChange={(e) =>
                setTxType(
                  e.target.value as 'delivery' | 'shrinkage_adjustment' | 'overage_adjustment'
                )
              }
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
            >
              <option value="delivery">Supplier Delivery (+)</option>
              <option value="shrinkage_adjustment">Pre-Fill Dip Shrinkage (-)</option>
              <option value="overage_adjustment">Pre-Fill Dip Overage (+)</option>
            </select>
          </div>

          <div>
            <label htmlFor="inv-liters" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              Volume (Liters)
            </label>
            <input
              id="inv-liters"
              type="number"
              min={1}
              step="0.5"
              required
              value={litersAmount}
              onChange={(e) => setLitersAmount(Number(e.target.value) || 0)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
            />
          </div>

          <div>
            <label htmlFor="inv-ref" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              DR / Dip Reference #
            </label>
            <input
              id="inv-ref"
              type="text"
              required
              placeholder="e.g. DR-2026-991"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
            />
          </div>

          <div>
            <label htmlFor="inv-dip" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              Physical Dip Reading (L)
            </label>
            <input
              id="inv-dip"
              type="number"
              min={0}
              step="0.5"
              placeholder="Optional"
              value={physicalDip}
              onChange={(e) => setPhysicalDip(e.target.value)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="inv-notes" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              Inspection / Tank Dipping Remarks
            </label>
            <input
              id="inv-notes"
              type="text"
              placeholder="Pre-fill tank gauge check before offloading..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
            />
          </div>

          <div>
            <label htmlFor="inv-code" className="block text-[11px] font-semibold text-[#334E73] mb-1">
              GSO Digital Verification Code
            </label>
            <input
              id="inv-code"
              type="text"
              placeholder="Leave blank if pending GSO"
              value={digitalCode}
              onChange={(e) => setDigitalCode(e.target.value)}
              className="w-full rounded-md border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting || !selectedDepot}
              className="w-full rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50"
            >
              {submitting ? 'Logging...' : 'Record Transaction'}
            </button>
          </div>
        </form>
      </section>

      {/* Automated Inventory Transaction Ledger & Pending GSO Verifications */}
      <RecordsPreviewGate
        title="Depot Inventory Transaction Logs & Pending Verifications"
        description="Recorded fuel deliveries, pre-fill dipping shrinkage/overage adjustments, and GSO verification logs remain hidden until Preview is pressed."
        recordCount={inventoryLogs.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Inventory Logs"
      >
        <div className="space-y-6">
          {pendingAdjustments.length > 0 && (
            <section className="rounded-lg border border-amber-300 bg-white overflow-hidden">
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-800" />
                <h3 className="font-display text-sm font-bold text-amber-900">
                  Pending Pre-Fill Dipping Adjustments Requiring GSO Digital Verification ({pendingAdjustments.length})
                </h3>
              </div>
              <div className="divide-y divide-[#E6EBF2]">
                {pendingAdjustments.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="space-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-[#0B192C]">{log.referenceNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-[#1B3B6F]">{log.depotName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="uppercase font-mono">{log.fuelType}</span>
                      </div>
                      <div className="text-[#334E73]">
                        Variance:{' '}
                        <span className="font-mono font-bold text-red-700">
                          {log.litersDelta > 0 ? '+' : ''}
                          {log.litersDelta.toFixed(1)} L
                        </span>{' '}
                        ({log.transactionType.replace(/_/g, ' ')}) · Notes: {log.notes}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        disabled={!isGsoOrAdmin}
                        placeholder="GSO Digital Verification PIN/Code"
                        value={verifyCodes[log.id] ?? ''}
                        onChange={(e) =>
                          setVerifyCodes((prev) => ({ ...prev, [log.id]: e.target.value }))
                        }
                        className="w-52 rounded-md border border-[#D5DCE6] px-3 py-1.5 font-mono text-xs text-[#0B192C]"
                      />
                      <button
                        type="button"
                        disabled={!isGsoOrAdmin || (verifyCodes[log.id] ?? '').trim().length < 4}
                        onClick={() =>
                          onVerifyPending(log, currentUser.displayName, verifyCodes[log.id].trim())
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50 whitespace-nowrap"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve & Verify</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
            <div className="border-b border-[#D5DCE6] px-5 py-3.5">
              <h3 className="font-display text-sm font-bold text-[#0B192C]">
                Automated Depot Inventory Transaction Logs ({inventoryLogs.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                    <th className="px-4 py-2.5 font-semibold">Reference</th>
                    <th className="px-4 py-2.5 font-semibold">Depot & Grade</th>
                    <th className="px-4 py-2.5 font-semibold">Type</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Delta (L)</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Before → After</th>
                    <th className="px-4 py-2.5 font-semibold">GSO Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EBF2]">
                  {inventoryLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F9FAFC]">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#5A6F8C] whitespace-nowrap">
                        {log.createdAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#0B192C]">
                        {log.referenceNumber}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[#0B192C]">{log.depotName}</div>
                        <div className="font-mono text-[11px] uppercase text-[#5A6F8C]">
                          {log.fuelType}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 capitalize text-[#334E73]">
                        {log.transactionType.replace(/_/g, ' ')}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono font-bold tabular-nums ${
                          log.litersDelta >= 0 ? 'text-emerald-800' : 'text-red-700'
                        }`}
                      >
                        {log.litersDelta >= 0 ? '+' : ''}
                        {log.litersDelta.toFixed(1)} L
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#334E73]">
                        {log.balanceBefore.toLocaleString()} → {log.balanceAfter.toLocaleString()} L
                      </td>
                      <td className="px-4 py-2.5">
                        {log.approvalStatus === 'verified' ? (
                          <div className="text-emerald-800">
                            <div className="font-semibold">{log.gsoApproverName}</div>
                            <div className="font-mono text-[10px]">
                              Code: {log.digitalVerificationCode}
                            </div>
                          </div>
                        ) : (
                          <span className="font-semibold text-amber-800">Pending GSO Approval</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </RecordsPreviewGate>
    </div>
  );
}
