import { useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, Lock, ShieldCheck, Truck } from 'lucide-react';
import {
  evaluatePreDeliveryPostingForm,
  PreDeliveryPostingSanitized,
  UST_FUEL_GRADE_STYLES,
  UstFuelGrade,
} from '../utils/dipstickEngine';
import { getLocalIsoDate } from '../utils/fuelEngine';

export interface PostedDipAdjustmentSummary {
  inventoryLogId?: string;
  gsoTransactionCode?: string;
  transactionType: 'shrinkage_adjustment' | 'overage_adjustment';
  signedVarianceLiters: number;
  referenceNumber: string;
}

export interface PreDeliveryModalContext {
  depotId?: string;
  depotName: string;
  tankId: string;
  storageTankId?: string;
  tankNumber: string;
  fuelGrade: UstFuelGrade;
  bolNumber: string | null;
  plannedDropLiters: number | null;
  calculatedDipVolumeLiters: number;
  maxSafeDropLiters: number;
  dipHeightCm: number;
  waterHeightCm: number;
  preDeliveryNotes: string;
  timestamp: string;
  postedDipAdjustment?: PostedDipAdjustmentSummary | null;
}

interface PreDeliveryRecordModalProps {
  context: PreDeliveryModalContext;
  operatorName: string;
  canViewRunningBalances?: boolean;
  onPostDelivery: (sanitized: PreDeliveryPostingSanitized) => Promise<void>;
}

function formatLiters(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatPhp(val: number, decimals = 2): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function PreDeliveryRecordModal({
  context,
  operatorName,
  canViewRunningBalances = false,
  onPostDelivery,
}: PreDeliveryRecordModalProps) {
  const gradeStyle = UST_FUEL_GRADE_STYLES[context.fuelGrade];

  const [volumeInput, setVolumeInput] = useState<string>(() =>
    context.plannedDropLiters && context.plannedDropLiters > 0
      ? String(context.plannedDropLiters)
      : ''
  );
  const [amountInput, setAmountInput] = useState<string>('');
  const [deliveryReceiptRef, setDeliveryReceiptRef] = useState<string>('');
  const [purchaseOrderRef, setPurchaseOrderRef] = useState<string>('');
  const [supplierName, setSupplierName] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>(() => getLocalIsoDate());
  const [remarks, setRemarks] = useState<string>(() => context.preDeliveryNotes || '');
  const [posting, setPosting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState<boolean>(false);

  const evaluation = useMemo(
    () =>
      evaluatePreDeliveryPostingForm({
        volumeLitersInput: volumeInput,
        totalAmountPhpInput: amountInput,
        deliveryReceiptRef,
        purchaseOrderRef,
        supplierName,
        deliveryDate,
        remarks,
        maxSafeDropLiters: context.maxSafeDropLiters,
      }),
    [
      volumeInput,
      amountInput,
      deliveryReceiptRef,
      purchaseOrderRef,
      supplierName,
      deliveryDate,
      remarks,
      context.maxSafeDropLiters,
    ]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttemptedSubmit(true);
    setSubmitError(null);
    if (!evaluation.valid || !evaluation.sanitized) return;

    setPosting(true);
    try {
      await onPostDelivery(evaluation.sanitized);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Unable to post fuel delivery. Please check the entries and try again.'
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      data-testid="pre-delivery-record-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-delivery-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0B192C]/75 backdrop-blur-[2px] p-0 sm:p-4"
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex max-h-[92dvh] w-full sm:max-w-xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[#CBD5E1] bg-white text-[#111827] shadow-2xl"
      >
        {/* API Fuel Grade Color Top Strip */}
        <div className="h-2 w-full shrink-0" style={{ backgroundColor: gradeStyle.hex }} />

        {/* Sticky Modal Header — No Close/Cancel Trigger */}
        <div className="shrink-0 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-[#065F46]">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Pre-Delivery Dip Locked · Cleared for Offload</span>
              </div>
              <h2
                id="pre-delivery-modal-title"
                className="text-base sm:text-lg font-extrabold tracking-tight text-[#111827] leading-snug"
              >
                Record Fuel Delivery Details
              </h2>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#4B5563]">
                <span className="font-semibold text-[#111827]">{context.depotName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-bold text-[#111827]">{context.tankId}</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold" style={{ color: gradeStyle.hex === '#F59E0B' ? '#92400E' : '#111827' }}>
                  {gradeStyle.label}
                </span>
                {context.bolNumber && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-[#111827]">
                      BOL {context.bolNumber}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-[#374151] pt-0.5">
              <Lock className="h-3.5 w-3.5 text-[#111827] shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">Post Required</span>
            </div>
          </div>

          {/* Compact Read-Only Physical Pre-Delivery Strip */}
          <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-[#E5E7EB] pt-2.5 text-xs">
            <div>
              <div className="text-[11px] font-medium text-[#4B5563]">Pre-Delivery Dip</div>
              <div className="font-mono font-extrabold tabular-nums text-[#111827]">
                {formatLiters(context.calculatedDipVolumeLiters)} L{' '}
                <span className="font-normal text-[#4B5563]">({context.dipHeightCm} cm)</span>
              </div>
            </div>
            <div className="text-right sm:text-left">
              <div className="text-[11px] font-medium text-[#4B5563]">Max Safe Drop</div>
              <div className="font-mono font-extrabold tabular-nums text-[#065F46]">
                {formatLiters(context.maxSafeDropLiters)} L
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Streamlined Form Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-4 space-y-3.5">
          {/* Separate GSO Head Verification & Dipstick Variance Notice */}
          <div
            data-testid="delivery-modal-separate-approval-notice"
            className="rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-950 space-y-1"
          >
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <ShieldCheck className="h-4 w-4 shrink-0 text-amber-800" />
              <span>Separate GSO Head Verification Required</span>
            </div>
            <p className="text-[11px] leading-snug text-amber-900">
              This delivery posts to the Pending Verifications queue and updates{' '}
              <strong className="font-mono">{context.tankId}</strong> stock &amp; per-tank WAC only
              after GSO Head approves it with their distinct verification code.
            </p>
            {context.postedDipAdjustment && (
              <div
                data-testid="delivery-modal-dip-adj-queued"
                className="border-t border-amber-200 pt-1.5 text-[11px] font-semibold text-amber-950"
              >
                Pre-delivery dipstick variance adjustment{' '}
                <span className="font-mono font-bold">
                  ({context.postedDipAdjustment.gsoTransactionCode || context.postedDipAdjustment.referenceNumber})
                </span>{' '}
                has been posted separately for independent GSO Head verification
                {canViewRunningBalances
                  ? ` (${context.postedDipAdjustment.signedVarianceLiters > 0 ? '+' : ''}${formatLiters(context.postedDipAdjustment.signedVarianceLiters)} L).`
                  : ' (variance volume restricted to GSO Head / Admin).'}
              </div>
            )}
          </div>

          {/* Primary Quantitative Pair: Volume & Total Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="delivery-modal-volume"
                className="block text-xs font-bold text-[#111827]"
              >
                Delivered Volume (Liters) <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="delivery-modal-volume"
                data-testid="delivery-modal-volume"
                type="text"
                inputMode="decimal"
                required
                placeholder="e.g. 2500"
                value={volumeInput}
                onChange={(e) => setVolumeInput(e.target.value)}
                className={`min-h-[48px] w-full rounded-lg border px-3.5 font-mono text-base font-extrabold tabular-nums text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 ${
                  evaluation.overfillExceeded
                    ? 'border-[#DC2626] bg-[#FEF2F2] focus:ring-[#DC2626]/30'
                    : 'border-[#9CA3AF] bg-white focus:border-[#111827] focus:ring-[#111827]/15'
                }`}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="delivery-modal-amount"
                className="block text-xs font-bold text-[#111827]"
              >
                Total Delivery Amount (₱) <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="delivery-modal-amount"
                data-testid="delivery-modal-amount"
                type="text"
                inputMode="decimal"
                required
                placeholder="e.g. 156250.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-[#9CA3AF] bg-white px-3.5 font-mono text-base font-extrabold tabular-nums text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/15"
              />
            </div>
          </div>

          {/* Live Unit Cost Readout Strip (Unboxed Clean Typography) */}
          <div
            data-testid="delivery-modal-unit-cost-strip"
            className="flex flex-wrap items-center justify-between gap-2 border-y border-[#E5E7EB] py-2 text-xs text-[#374151]"
          >
            <span>
              Derived Unit Cost (for {context.tankId} WAC):{' '}
              <strong
                data-testid="delivery-modal-unit-cost"
                className="font-mono text-sm font-black tabular-nums text-[#111827]"
              >
                {evaluation.unitCostPhp !== null
                  ? `₱${formatPhp(evaluation.unitCostPhp, 4)}/L`
                  : '—'}
              </strong>
            </span>
            <span className="text-[11px] text-[#4B5563]">
              Logged by <strong className="text-[#111827]">{operatorName}</strong>
            </span>
          </div>

          {/* Mandatory Procurement & Receiving References */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="delivery-modal-dr"
                className="block text-xs font-bold text-[#111827]"
              >
                Delivery Receipt (DR) Ref # <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="delivery-modal-dr"
                data-testid="delivery-modal-dr"
                type="text"
                required
                autoComplete="off"
                placeholder="e.g. DR-2026-0905"
                value={deliveryReceiptRef}
                onChange={(e) => setDeliveryReceiptRef(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-[#9CA3AF] bg-white px-3.5 font-mono text-sm font-bold uppercase text-[#111827] placeholder:font-normal placeholder:normal-case placeholder:text-[#9CA3AF] focus:border-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/15"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="delivery-modal-po"
                className="block text-xs font-bold text-[#111827]"
              >
                Purchase Order (PO) Ref # <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="delivery-modal-po"
                data-testid="delivery-modal-po"
                type="text"
                required
                autoComplete="off"
                placeholder="e.g. PO-2026-0412"
                value={purchaseOrderRef}
                onChange={(e) => setPurchaseOrderRef(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-[#9CA3AF] bg-white px-3.5 font-mono text-sm font-bold uppercase text-[#111827] placeholder:font-normal placeholder:normal-case placeholder:text-[#9CA3AF] focus:border-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/15"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="delivery-modal-supplier"
                className="block text-xs font-bold text-[#111827]"
              >
                Supplier / Hauler <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="delivery-modal-supplier"
                data-testid="delivery-modal-supplier"
                type="text"
                required
                placeholder="e.g. Petron Bulk Depot"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-[#9CA3AF] bg-white px-3.5 text-sm font-semibold text-[#111827] placeholder:font-normal placeholder:text-[#9CA3AF] focus:border-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/15"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="delivery-modal-date"
                className="block text-xs font-bold text-[#111827]"
              >
                Delivery Date <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="delivery-modal-date"
                data-testid="delivery-modal-date"
                type="date"
                required
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-[#9CA3AF] bg-white px-3.5 font-mono text-sm font-bold text-[#111827] focus:border-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/15"
              />
            </div>
          </div>

          {/* Optional Remarks / Seal No. */}
          <div className="space-y-1 pt-0.5">
            <label
              htmlFor="delivery-modal-remarks"
              className="block text-xs font-semibold text-[#374151]"
            >
              Remarks / Compartment Seal No. (Optional)
            </label>
            <input
              id="delivery-modal-remarks"
              data-testid="delivery-modal-remarks"
              type="text"
              placeholder="Tanker plate number or compartment seal reference"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] px-3.5 text-sm text-[#111827] placeholder:text-[#6B7280] focus:border-[#111827] focus:bg-white focus:outline-none"
            />
          </div>

          {/* Inline Overfill / Validation / Submission Error */}
          {(evaluation.overfillExceeded || submitError || (attemptedSubmit && evaluation.blockingReason)) && (
            <div
              role="alert"
              data-testid="delivery-modal-error"
              className="flex items-start gap-2 rounded-lg border border-[#DC2626] bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-semibold text-[#991B1B]"
            >
              <AlertOctagon className="h-4 w-4 shrink-0 mt-0.5 text-[#DC2626]" />
              <span>{submitError || evaluation.blockingReason}</span>
            </div>
          )}
        </div>

        {/* Sticky Bottom CTA — Only Action to Dismiss After Successful Post */}
        <div className="shrink-0 border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3.5 sm:px-5 space-y-2">
          {!evaluation.valid && !attemptedSubmit && evaluation.blockingReason && (
            <p className="text-[11px] font-medium text-[#4B5563]">
              {evaluation.blockingReason}
            </p>
          )}
          <button
            type="submit"
            data-testid="post-delivery-submit-btn"
            disabled={!evaluation.valid || posting}
            className={`min-h-[52px] w-full rounded-xl px-5 py-3 text-sm sm:text-base font-extrabold tracking-wide transition-colors flex items-center justify-center gap-2 ${
              evaluation.valid && !posting
                ? 'bg-[#0B192C] text-white hover:bg-[#1B3B6F] shadow-sm'
                : 'bg-[#D1D5DB] text-[#6B7280] cursor-not-allowed'
            }`}
          >
            <Truck className="h-5 w-5 shrink-0" />
            <span>
              {posting ? 'Posting for GSO Approval...' : 'Post Delivery (Pending GSO Approval)'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

