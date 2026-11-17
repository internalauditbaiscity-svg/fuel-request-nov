import { ChangeEvent, useMemo, useState } from 'react';
import {
  Ban,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  FileImage,
  Fuel,
  Lock,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { FuelDepot, FuelType, TripTicket, UserAccount, WorkPlan } from '../types/fuel';
import {
  buildDispensingCsvContent,
  canDispenseAtGso,
  canExportDispensingRecords,
  canPreviewDispensingFullRecord,
  categorizeAndFilterDispensingTickets,
  DispensingTicketViewItem,
  getDynamicProgressiveYearOptions,
  hasValidPumpReadingProof,
} from '../utils/fuelEngine';
import { generateDispensingLedgerPdf } from '../utils/pdfGenerator';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface PumpPhotoDraft {
  dataUrl: string;
  fileName: string;
}

interface DispensingViewProps {
  tickets: TripTicket[];
  workPlans: WorkPlan[];
  depots: FuelDepot[];
  currentUser: UserAccount;
  onDispenseTicket: (
    ticket: TripTicket,
    actualDispensedLiters: number,
    pumpProof?: PumpPhotoDraft
  ) => Promise<{ ok: boolean; error?: string }>;
}

type DispensingCategoryTab = 'all' | 'approved' | 'dispensed';

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

function formatDispensedTimestamp(iso?: string): string {
  if (!iso) return 'Pending';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function readAndCompressPumpImage(file: File): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read picture file.'));
    reader.readAsDataURL(file);
  });

  if (!rawDataUrl.startsWith('data:image/')) {
    throw new Error('Selected file must be a valid image file (PNG, JPG, WebP).');
  }

  if (rawDataUrl.length <= 180_000) {
    return rawDataUrl;
  }

  return await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 900;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 800) * scale));
        const height = Math.max(1, Math.round((img.height || 600) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.72);
        resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export function DispensingView({
  tickets,
  workPlans,
  depots,
  currentUser,
  onDispenseTicket,
}: DispensingViewProps) {
  const canDispense = canDispenseAtGso(currentUser.role);
  const canPreviewFull = canPreviewDispensingFullRecord(currentUser.role);
  const canExport = canExportDispensingRecords(currentUser.role);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [categoryTab, setCategoryTab] = useState<DispensingCategoryTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [fuelTypeFilter, setFuelTypeFilter] = useState<FuelType | 'all'>('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [dispenseInputs, setDispenseInputs] = useState<Record<string, number>>({});
  const [pumpPhotos, setPumpPhotos] = useState<Record<string, PumpPhotoDraft>>({});
  const [missingPhotoIds, setMissingPhotoIds] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<{
    ticketNumber: string;
    workPlanNumber: string;
    fileName: string;
    dataUrl: string;
  } | null>(null);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      if (t.servedOnce || ((t.status === 'approved' || t.status === 'reduced') && t.approvedLiters > 0)) {
        set.add(t.department);
      }
    });
    return Array.from(set).sort();
  }, [tickets]);

  const yearOptions = useMemo(() => {
    return getDynamicProgressiveYearOptions({
      workPlans,
      tickets,
      order: 'asc',
    });
  }, [workPlans, tickets]);

  const { approved, dispensed, totalApprovedCount, totalDispensedCount } = useMemo(
    () =>
      categorizeAndFilterDispensingTickets(tickets, workPlans, {
        searchQuery,
        fuelType: fuelTypeFilter,
        department: departmentFilter,
        month: monthFilter,
        year: yearFilter,
      }),
    [tickets, workPlans, searchQuery, fuelTypeFilter, departmentFilter, monthFilter, yearFilter]
  );

  const selectedApprovedItem = useMemo(
    () =>
      canPreviewFull
        ? approved.find((item) => item.ticket.id === selectedTicketId) ?? null
        : null,
    [approved, selectedTicketId, canPreviewFull]
  );

  const selectedDispensedItem = useMemo(
    () =>
      canPreviewFull
        ? dispensed.find((item) => item.ticket.id === selectedTicketId) ?? null
        : null,
    [dispensed, selectedTicketId, canPreviewFull]
  );

  const filteredExportItems = useMemo(() => {
    if (categoryTab === 'approved') return approved;
    if (categoryTab === 'dispensed') return dispensed;
    return [...approved, ...dispensed];
  }, [categoryTab, approved, dispensed]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [
      categoryTab === 'all'
        ? 'All Categories'
        : categoryTab === 'approved'
          ? 'Approved Category'
          : 'Dispensed Category',
    ];
    if (fuelTypeFilter !== 'all') parts.push(`Fuel: ${fuelTypeFilter.toUpperCase()}`);
    if (departmentFilter !== 'all') parts.push(`Dept: ${departmentFilter}`);
    if (monthFilter !== 'all') {
      const mLabel = MONTH_OPTIONS.find((m) => m.value === monthFilter)?.label ?? monthFilter;
      parts.push(`Month: ${mLabel}`);
    }
    if (yearFilter !== 'all') parts.push(`Year: ${yearFilter}`);
    if (searchQuery.trim()) parts.push(`Search: "${searchQuery.trim()}"`);
    return parts.join(' | ');
  }, [categoryTab, fuelTypeFilter, departmentFilter, monthFilter, yearFilter, searchQuery]);

  const getDepotName = (depotId: string) =>
    depots.find((d) => d.id === depotId)?.name ?? depotId;

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      fuelTypeFilter !== 'all' ||
      departmentFilter !== 'all' ||
      monthFilter !== 'all' ||
      yearFilter !== 'all'
  );

  const resetAllFilters = () => {
    setSearchQuery('');
    setFuelTypeFilter('all');
    setDepartmentFilter('all');
    setMonthFilter('all');
    setYearFilter('all');
  };

  const handleToggleSelect = (ticketId: string) => {
    if (!canPreviewFull) return;
    setSelectedTicketId((prev) => (prev === ticketId ? null : ticketId));
  };

  const handleDownloadPdf = (itemsToExport: DispensingTicketViewItem[], scopeLabel?: string) => {
    if (!canExport || itemsToExport.length === 0) return;
    const res = generateDispensingLedgerPdf(itemsToExport, depots, scopeLabel || filterSummary);
    res.doc.save(res.filename);
    URL.revokeObjectURL(res.blobUrl);
  };

  const handleDownloadCsv = (itemsToExport: DispensingTicketViewItem[], filenamePrefix?: string) => {
    if (!canExport || itemsToExport.length === 0) return;
    const csv = buildDispensingCsvContent(itemsToExport, depots);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filenamePrefix || 'BaisCity_GSO_Dispensing'}_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePumpFileChange = async (
    ticketId: string,
    ticketNumber: string,
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFeedback({
        type: 'err',
        msg: `Invalid file for Ticket ${ticketNumber}: please upload an image picture file of the pump reading.`,
      });
      e.target.value = '';
      return;
    }

    try {
      const dataUrl = await readAndCompressPumpImage(file);
      if (!hasValidPumpReadingProof(dataUrl)) {
        setFeedback({
          type: 'err',
          msg: `Uploaded file for Ticket ${ticketNumber} could not be verified as an image.`,
        });
        return;
      }

      setPumpPhotos((prev) => ({
        ...prev,
        [ticketId]: {
          dataUrl,
          fileName: file.name || `pump-reading-${ticketNumber}.jpg`,
        },
      }));
      setMissingPhotoIds((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
      setFeedback(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Unable to process pump reading picture.',
      });
    }
  };

  const clearPumpPhoto = (ticketId: string) => {
    setPumpPhotos((prev) => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
  };

  const handleDispense = async (ticket: TripTicket) => {
    setFeedback(null);
    const proof = pumpPhotos[ticket.id];

    if (!proof || !hasValidPumpReadingProof(proof.dataUrl)) {
      setMissingPhotoIds((prev) => ({ ...prev, [ticket.id]: true }));
      setFeedback({
        type: 'err',
        msg: `Cannot record dispense for Ticket ${ticket.ticketNumber}: mandatory upload of pump reading picture file is required as proof of actual dispensing.`,
      });
      return;
    }

    const amount =
      dispenseInputs[ticket.id] !== undefined
        ? dispenseInputs[ticket.id]
        : ticket.approvedLiters;

    setBusyId(ticket.id);
    try {
      const res = await onDispenseTicket(ticket, amount, proof);
      if (!res.ok) {
        setFeedback({ type: 'err', msg: res.error || 'Dispensing rejected.' });
      } else {
        clearPumpPhoto(ticket.id);
        const forfeited = Math.max(0, ticket.approvedLiters - amount);
        setFeedback({
          type: 'ok',
          msg: `Dispensed ${amount.toFixed(1)} L for Ticket ${ticket.ticketNumber} with pump reading proof (${proof.fileName}). ${
            forfeited > 0
              ? `Unserved balance of ${forfeited.toFixed(1)} L has been forfeited and invalidated.`
              : 'Ticket marked served once.'
          }`,
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  const showApproved = categoryTab === 'all' || categoryTab === 'approved';
  const showDispensed = categoryTab === 'all' || categoryTab === 'dispensed';

  const renderApprovedReviewPanel = ({ ticket: t, workPlanNumber }: DispensingTicketViewItem) => {
    const currentInput =
      dispenseInputs[t.id] !== undefined ? dispenseInputs[t.id] : t.approvedLiters;
    const projectedForfeit = Math.max(0, t.approvedLiters - currentInput);
    const attachedProof = pumpPhotos[t.id];
    const hasProof = Boolean(attachedProof && hasValidPumpReadingProof(attachedProof.dataUrl));
    const showMissingProof = Boolean(missingPhotoIds[t.id] && !hasProof);

    return (
      <section
        aria-label={`Full Review for Ticket ${t.ticketNumber}`}
        data-testid={`selected-approved-review-${t.ticketNumber}`}
        className="rounded-lg border border-[#1B3B6F] bg-white overflow-hidden"
      >
        {/* Top Header: Ticket No. & Work Plan No. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE6] bg-[#EEF2F8] px-5 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-mono font-bold text-[#0B192C]">
              Ticket No: {t.ticketNumber}
            </span>
            <span aria-hidden="true" className="text-[#8FA0B8]">
              |
            </span>
            <span className="font-mono font-bold text-[#1B3B6F]">
              Work Plan No: {workPlanNumber}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className="rounded border border-[#C5D1E3] bg-white px-2 py-0.5 font-mono uppercase text-[#0B192C]">
              {t.fuelType}
            </span>
            <span
              className={`rounded px-2 py-0.5 ${
                t.status === 'reduced'
                  ? 'border border-amber-300 bg-amber-50 text-amber-900'
                  : 'border border-emerald-300 bg-emerald-50 text-emerald-900'
              }`}
            >
              {t.status === 'reduced' ? 'Approved (Reduced)' : 'Approved'}
            </span>
            <button
              type="button"
              onClick={() => setSelectedTicketId(null)}
              aria-label="Close ticket review"
              className="rounded border border-[#D5DCE6] bg-white p-1 text-[#334E73] hover:bg-[#F3F5F8]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2 text-xs flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-[#0B192C]">{t.plateNumber}</span>
              {t.vehicleLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#334E73]">{t.vehicleLabel}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-[#1B3B6F]">{t.department}</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-3">
              <div>
                <span className="text-[11px] font-semibold text-[#5A6F8C] block">
                  Assigned Driver
                </span>
                <span className="font-semibold text-[#0B192C]">{t.driverName}</span>
                {t.driverLicense && (
                  <span className="ml-1.5 font-mono text-[11px] text-[#5A6F8C]">
                    ({t.driverLicense})
                  </span>
                )}
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#5A6F8C] block">
                  Depot & Date Needed
                </span>
                <span className="text-[#0B192C]">
                  {getDepotName(t.depotId)} ·{' '}
                  <strong className="font-mono">{t.scheduledDate}</strong>
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-[11px] font-semibold text-[#5A6F8C] block">
                  Purpose / Project & Destination
                </span>
                <span className="text-[#0B192C]">
                  {t.purposeOrProject || t.projectTitle} — {t.destination}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#5A6F8C] block">
                  Requested Liters
                </span>
                <span className="font-mono font-semibold text-[#334E73]">
                  {t.requestedLiters.toFixed(1)} L
                </span>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#5A6F8C] block">
                  Approved Fuel Limit
                </span>
                <span className="font-mono font-bold text-[#0B192C]">
                  {t.approvedLiters.toFixed(1)} L
                </span>
                {projectedForfeit > 0 && (
                  <span className="ml-2 font-mono text-red-700">
                    (Forfeiting {projectedForfeit.toFixed(1)} L unserved balance)
                  </span>
                )}
              </div>
            </div>

            {t.reductionReason && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <strong>Tabletop Reduction Note:</strong> {t.reductionReason}
              </div>
            )}
          </div>

          {/* Dispense Action & Mandatory Pump Reading Upload */}
          <div className="flex w-full flex-col gap-3 lg:w-[430px] shrink-0">
            <div
              className={`rounded-md border p-3 ${
                showMissingProof
                  ? 'border-red-600 bg-red-50'
                  : hasProof
                    ? 'border-emerald-300 bg-emerald-50/50'
                    : 'border-[#D5DCE6] bg-[#F8FAFC]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <label
                  htmlFor={`pump-photo-${t.id}`}
                  className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                    showMissingProof ? 'text-red-800' : 'text-[#0B192C]'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5 shrink-0" />
                  <span>Pump Reading Picture File (Mandatory) *</span>
                </label>
                {hasProof ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Proof Attached
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-red-700">Required</span>
                )}
              </div>

              <input
                id={`pump-photo-${t.id}`}
                data-testid={`pump-photo-input-${t.ticketNumber}`}
                type="file"
                accept="image/*"
                disabled={!canDispense}
                onChange={(e) => handlePumpFileChange(t.id, t.ticketNumber, e)}
                className="block w-full text-xs text-[#334E73] file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[#0B192C] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#1B3B6F] disabled:opacity-50"
              />

              {hasProof && attachedProof && (
                <div className="mt-2.5 flex items-center justify-between gap-2 rounded border border-emerald-200 bg-white p-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={attachedProof.dataUrl}
                      alt={`Pump reading proof for ${t.ticketNumber}`}
                      className="h-10 w-10 rounded border border-[#D5DCE6] object-cover shrink-0"
                    />
                    <span className="truncate font-mono text-[11px] text-[#0B192C]">
                      {attachedProof.fileName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearPumpPhoto(t.id)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                </div>
              )}

              {showMissingProof && (
                <p className="mt-2 text-[11px] font-semibold text-red-800">
                  Upload a picture file of the fuel pump reading as proof of actual dispensing before recording.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor={`disp-${t.id}`} className="text-xs font-semibold text-[#334E73]">
                  Actual Dispensed (L):
                </label>
                <input
                  id={`disp-${t.id}`}
                  type="number"
                  min={0}
                  max={t.approvedLiters}
                  step={0.5}
                  disabled={!canDispense}
                  value={currentInput}
                  onChange={(e) =>
                    setDispenseInputs((prev) => ({
                      ...prev,
                      [t.id]: Math.max(
                        0,
                        Math.min(t.approvedLiters, Number(e.target.value) || 0)
                      ),
                    }))
                  }
                  className="w-24 rounded-md border border-[#D5DCE6] px-2.5 py-1.5 text-right font-mono text-xs font-bold text-[#0B192C]"
                />
              </div>

              <button
                type="button"
                data-testid={`dispense-btn-${t.ticketNumber}`}
                data-proof-ready={hasProof ? 'true' : 'false'}
                disabled={!canDispense || busyId === t.id}
                onClick={() => handleDispense(t)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  hasProof
                    ? 'bg-[#0B192C] text-white hover:bg-[#1B3B6F]'
                    : 'border border-red-300 bg-[#F3F5F8] text-[#5A6F8C] hover:border-red-500 hover:text-red-800'
                } disabled:opacity-50`}
              >
                <Fuel className="h-3.5 w-3.5" />
                <span>{busyId === t.id ? 'Dispensing...' : 'Dispense Once'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderDispensedReviewPanel = ({ ticket: t, workPlanNumber }: DispensingTicketViewItem) => (
    <section
      aria-label={`Full Review for Dispensed Ticket ${t.ticketNumber}`}
      data-testid={`selected-dispensed-review-${t.ticketNumber}`}
      className="rounded-lg border border-[#1B3B6F] bg-white overflow-hidden"
    >
      {/* Top Header: Ticket No. & Work Plan No. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#0B192C]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
            <span>Ticket No: {t.ticketNumber}</span>
          </span>
          <span aria-hidden="true" className="text-[#8FA0B8]">
            |
          </span>
          <span className="font-mono font-bold text-[#1B3B6F]">
            Work Plan No: {workPlanNumber}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className="rounded border border-[#C5D1E3] bg-white px-2 py-0.5 font-mono uppercase text-[#0B192C]">
            {t.fuelType}
          </span>
          <span className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-900">
            {t.status === 'forfeited' ? 'Forfeited' : 'Dispensed'}
          </span>
          {canExport && (
            <>
              <button
                type="button"
                data-testid="gso-download-ticket-pdf"
                onClick={() =>
                  handleDownloadPdf(
                    [{ ticket: t, workPlanNumber }],
                    `Ticket ${t.ticketNumber} (${workPlanNumber})`
                  )
                }
                className="inline-flex items-center gap-1 rounded border border-[#1B3B6F] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1B3B6F] hover:bg-[#EEF2F8]"
              >
                <Download className="h-3 w-3" />
                <span>Ticket PDF</span>
              </button>
              <button
                type="button"
                data-testid="gso-download-ticket-csv"
                onClick={() =>
                  handleDownloadCsv(
                    [{ ticket: t, workPlanNumber }],
                    `BaisCity_GSO_Ticket_${t.ticketNumber}`
                  )
                }
                className="inline-flex items-center gap-1 rounded border border-[#D5DCE6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B192C] hover:bg-[#F3F5F8]"
              >
                <Download className="h-3 w-3" />
                <span>Ticket CSV</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSelectedTicketId(null)}
            aria-label="Close dispensed ticket review"
            className="rounded border border-[#D5DCE6] bg-white p-1 text-[#334E73] hover:bg-[#E6EBF2]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-12 lg:items-center text-xs">
        <div className="lg:col-span-5 space-y-1.5">
          <div className="font-semibold text-[#0B192C]">
            <span className="font-mono">{t.plateNumber}</span>
            {t.vehicleLabel ? ` · ${t.vehicleLabel}` : ''} · {t.driverName}
          </div>
          <div className="text-[#334E73]">{t.department}</div>
          <div className="text-[#5A6F8C]">
            Purpose: {t.purposeOrProject || t.projectTitle} — {t.destination}
          </div>
          <div className="text-[#5A6F8C]">
            Custodian: <strong className="text-[#0B192C]">{t.dispensedBy || 'GSO Depot'}</strong> ·
            Depot: {getDepotName(t.depotId)} · Date Needed:{' '}
            <span className="font-mono">{t.scheduledDate}</span>
          </div>
          <div className="text-[#5A6F8C]">
            Dispensed At:{' '}
            <span className="font-mono text-[#0B192C]">
              {formatDispensedTimestamp(t.dispensedAt)}
            </span>
          </div>
        </div>

        <div className="lg:col-span-4 grid grid-cols-3 gap-2 rounded-md border border-[#E6EBF2] bg-[#F8FAFC] p-3 text-center">
          <div>
            <div className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Approved</div>
            <div className="font-mono font-bold text-[#0B192C] tabular-nums">
              {t.approvedLiters.toFixed(1)} L
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Dispensed</div>
            <div className="font-mono font-bold text-emerald-800 tabular-nums">
              {t.dispensedLiters.toFixed(1)} L
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-[#5A6F8C]">Void Balance</div>
            <div className="font-mono font-bold text-red-700 tabular-nums">
              {t.forfeitedLiters > 0 ? (
                <span className="inline-flex items-center gap-0.5">
                  <Ban className="h-3 w-3" />
                  {t.forfeitedLiters.toFixed(1)} L
                </span>
              ) : (
                '0.0 L'
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 flex items-center justify-start lg:justify-end">
          {t.pumpReadingPhotoDataUrl ? (
            <div className="flex items-center gap-2.5 rounded-md border border-[#D5DCE6] bg-[#F8FAFC] px-3 py-2">
              <img
                src={t.pumpReadingPhotoDataUrl}
                alt={`Pump reading proof for ${t.ticketNumber}`}
                className="h-10 w-10 rounded border border-[#D5DCE6] object-cover shrink-0"
              />
              <div className="min-w-0">
                <div className="max-w-[120px] truncate font-mono text-[11px] font-semibold text-[#0B192C]">
                  {t.pumpReadingPhotoName || 'Pump Proof'}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setProofPreview({
                      ticketNumber: t.ticketNumber,
                      workPlanNumber,
                      fileName: t.pumpReadingPhotoName || 'pump-reading.jpg',
                      dataUrl: t.pumpReadingPhotoDataUrl || '',
                    })
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B3B6F] hover:underline"
                >
                  <Eye className="h-3 w-3" />
                  View Proof
                </button>
              </div>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-[11px] text-[#5A6F8C]">
              <FileImage className="h-3.5 w-3.5" />
              Baseline Record
            </span>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      {!canDispense && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            GSO fuel dispensing is restricted to <strong>GSO Depot Dispenser</strong> or{' '}
            <strong>System Administrator</strong> roles.
          </span>
        </div>
      )}

      {feedback && (
        <div
          role="alert"
          className={`rounded-lg border px-4 py-3 text-xs font-medium ${
            feedback.type === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <RecordsPreviewGate
        title="GSO Fuel Dispensing Ledger"
        description={
          canPreviewFull
            ? 'Preview loads a tabular summary (sorted with the latest created record topmost). Filter by fuel type, department, month, year, or ticket search, and select any row for full review, PDF/CSV export, and dispensing.'
            : 'Preview loads a read-only tabular summary (sorted with the latest created record topmost). Full record inspection and PDF/CSV export require authorized GSO/oversight roles.'
        }
        recordCount={totalApprovedCount + totalDispensedCount}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Dispensing Records"
      >
        <div className="space-y-6">
          {!canPreviewFull && (
            <div
              data-testid="gso-role-restriction-banner"
              className="flex items-center gap-2.5 rounded-lg border border-[#D5DCE6] bg-[#F8FAFC] px-4 py-3 text-xs text-[#334E73]"
            >
              <Lock className="h-4 w-4 shrink-0 text-[#1B3B6F]" />
              <span>
                <strong>Tabular Preview Only:</strong> GSO Full Record View and PDF/CSV download of filtered records are restricted to{' '}
                <strong>System Administrator</strong>, <strong>GSO Depot Dispenser</strong>,{' '}
                <strong>Tabletop Approver</strong>, and <strong>Internal Auditor</strong> roles.
              </span>
            </div>
          )}
          {/* Search, Category Tabs & Fuel Type / Department / Month / Year Filters */}
          <div className="space-y-3 rounded-lg border border-[#D5DCE6] bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div
                className="flex flex-wrap items-center gap-2"
                role="tablist"
                aria-label="Dispensing categories"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={categoryTab === 'all'}
                  onClick={() => setCategoryTab('all')}
                  className={`rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                    categoryTab === 'all'
                      ? 'bg-[#0B192C] text-white'
                      : 'border border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                  }`}
                >
                  All Tickets ({approved.length + dispensed.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={categoryTab === 'approved'}
                  onClick={() => setCategoryTab('approved')}
                  className={`rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                    categoryTab === 'approved'
                      ? 'bg-[#0B192C] text-white'
                      : 'border border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                  }`}
                >
                  Approved ({approved.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={categoryTab === 'dispensed'}
                  onClick={() => setCategoryTab('dispensed')}
                  className={`rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
                    categoryTab === 'dispensed'
                      ? 'bg-[#0B192C] text-white'
                      : 'border border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                  }`}
                >
                  Dispensed ({dispensed.length})
                </button>
              </div>

              <div className="relative w-full lg:max-w-md">
                <label htmlFor="gso-ticket-search" className="sr-only">
                  Search Trip Ticket or Work Plan Number
                </label>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
                <input
                  id="gso-ticket-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Ticket No., Work Plan No., plate, driver, or dept..."
                  className="w-full rounded-md border border-[#D5DCE6] bg-[#F8FAFC] py-2 pl-9 pr-16 text-xs text-[#0B192C] placeholder:text-[#5A6F8C] focus:border-[#1B3B6F] focus:bg-white focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-[11px] font-semibold text-[#1B3B6F] hover:bg-[#E6EBF2]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6EBF2] pt-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="gso-filter-fuel-type"
                  aria-label="Filter by Fuel Type"
                  value={fuelTypeFilter}
                  onChange={(e) => setFuelTypeFilter(e.target.value as FuelType | 'all')}
                  className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
                >
                  <option value="all">All Fuel Types</option>
                  <option value="diesel">Diesel</option>
                  <option value="gasoline">Gasoline</option>
                </select>

                <select
                  id="gso-filter-department"
                  aria-label="Filter by Department"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
                >
                  <option value="all">All Departments</option>
                  {departmentOptions.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>

                <select
                  id="gso-filter-month"
                  aria-label="Filter by Month"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 text-xs text-[#0B192C]"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <select
                  id="gso-filter-year"
                  aria-label="Filter by Year"
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  className="rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-2.5 py-1.5 font-mono text-xs text-[#0B192C]"
                >
                  <option value="all">All Years</option>
                  {yearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-[11px] font-semibold text-[#1B3B6F] hover:bg-[#E6EBF2]"
                  >
                    Reset Filters
                  </button>
                )}

                {canExport ? (
                  <>
                    <button
                      type="button"
                      data-testid="gso-download-filtered-pdf"
                      disabled={filteredExportItems.length === 0}
                      onClick={() => handleDownloadPdf(filteredExportItems)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download PDF ({filteredExportItems.length})</span>
                    </button>
                    <button
                      type="button"
                      data-testid="gso-download-filtered-csv"
                      disabled={filteredExportItems.length === 0}
                      onClick={() => handleDownloadCsv(filteredExportItems)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#1B3B6F] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B3B6F] hover:bg-[#EEF2F8] disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download CSV ({filteredExportItems.length})</span>
                    </button>
                  </>
                ) : (
                  <span
                    data-testid="gso-export-restricted-badge"
                    className="inline-flex items-center gap-1.5 rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-[11px] font-semibold text-[#5A6F8C]"
                  >
                    <Lock className="h-3 w-3" />
                    <span>Export Restricted by Role</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Category 1: Approved Trip Tickets — Tabular Preview */}
          {showApproved && (
            <div className="space-y-4">
              <section
                aria-label="Approved Trip Tickets"
                className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
              >
                <div className="border-b border-[#D5DCE6] bg-[#F8FAFC] px-5 py-3.5">
                  <h2 className="font-display text-sm font-bold text-[#0B192C]">
                    Approved Category — Ready for GSO Dispensing ({approved.length})
                  </h2>
                  <p className="text-xs text-[#5A6F8C]">
                    {canPreviewFull
                      ? 'Latest created records appear topmost. Select any row to inspect full details, upload pump reading proof, and record dispensing.'
                      : 'Latest created records appear topmost. Full record inspection is disabled for your current role.'}
                  </p>
                </div>

                {approved.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#5A6F8C]">
                    {hasActiveFilters
                      ? 'No approved trip tickets match your active filters.'
                      : 'No approved trip tickets awaiting fuel dispensing.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table
                      data-testid="approved-tickets-table"
                      className="w-full text-left text-xs"
                    >
                      <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Ticket Number</th>
                          <th className="px-4 py-3 font-semibold">Department</th>
                          <th className="px-4 py-3 font-semibold">Fuel Type</th>
                          <th className="px-4 py-3 font-semibold text-right">Fuel Approved</th>
                          <th className="px-4 py-3 font-semibold text-right">
                            Actual Liters Dispensed
                          </th>
                          <th className="px-4 py-3 font-semibold text-right">Date Needed</th>
                          <th className="px-4 py-3 font-semibold">Dispensed Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EBF2]">
                        {approved.map(({ ticket: t }) => {
                          const isSelected = canPreviewFull && selectedTicketId === t.id;
                          return (
                            <tr
                              key={t.id}
                              data-testid={`approved-row-${t.ticketNumber}`}
                              onClick={canPreviewFull ? () => handleToggleSelect(t.id) : undefined}
                              className={`transition-colors ${
                                canPreviewFull ? 'cursor-pointer' : 'cursor-default'
                              } ${
                                isSelected
                                  ? 'bg-[#EEF2F8]'
                                  : canPreviewFull
                                    ? 'hover:bg-[#F9FAFC]'
                                    : ''
                              }`}
                            >
                              <td className="px-4 py-3 font-mono font-bold text-[#1B3B6F] whitespace-nowrap">
                                {canPreviewFull ? (
                                  <button
                                    type="button"
                                    aria-expanded={isSelected}
                                    aria-label={`Select approved ticket ${t.ticketNumber}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleSelect(t.id);
                                    }}
                                    className="hover:underline focus:outline-none"
                                  >
                                    {t.ticketNumber}
                                  </button>
                                ) : (
                                  <span>{t.ticketNumber}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-medium text-[#0B192C]">
                                {t.department}
                              </td>
                              <td className="px-4 py-3 font-mono uppercase text-[#334E73] whitespace-nowrap">
                                {t.fuelType}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-[#0B192C] whitespace-nowrap">
                                {t.approvedLiters.toFixed(1)} L
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#5A6F8C] whitespace-nowrap">
                                {t.dispensedLiters > 0
                                  ? `${t.dispensedLiters.toFixed(1)} L`
                                  : 'Pending'}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                                {t.scheduledDate}
                              </td>
                              <td className="px-4 py-3 font-mono text-[#5A6F8C] whitespace-nowrap">
                                {formatDispensedTimestamp(t.dispensedAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {selectedApprovedItem && renderApprovedReviewPanel(selectedApprovedItem)}
            </div>
          )}

          {/* Category 2: Dispensed Trip Tickets — Tabular Preview */}
          {showDispensed && (
            <div className="space-y-4">
              <section
                aria-label="Dispensed Trip Tickets"
                className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
              >
                <div className="border-b border-[#D5DCE6] bg-[#F8FAFC] px-5 py-3.5">
                  <h2 className="font-display text-sm font-bold text-[#0B192C]">
                    Dispensed Category — Completed Single-Serve Tickets ({dispensed.length})
                  </h2>
                  <p className="text-xs text-[#5A6F8C]">
                    {canPreviewFull
                      ? 'Latest created records appear topmost. Select a dispensed ticket row to review Work Plan reference, forfeited balance, and pump reading proof.'
                      : 'Latest created records appear topmost. Full record inspection is disabled for your current role.'}
                  </p>
                </div>

                {dispensed.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#5A6F8C]">
                    {hasActiveFilters
                      ? 'No dispensed trip tickets match your active filters.'
                      : 'No dispensed trip tickets logged yet.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table
                      data-testid="dispensed-tickets-table"
                      className="w-full text-left text-xs"
                    >
                      <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Ticket Number</th>
                          <th className="px-4 py-3 font-semibold">Department</th>
                          <th className="px-4 py-3 font-semibold">Fuel Type</th>
                          <th className="px-4 py-3 font-semibold text-right">Fuel Approved</th>
                          <th className="px-4 py-3 font-semibold text-right">
                            Actual Liters Dispensed
                          </th>
                          <th className="px-4 py-3 font-semibold text-right">Date Needed</th>
                          <th className="px-4 py-3 font-semibold">Dispensed Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EBF2]">
                        {dispensed.map(({ ticket: t }) => {
                          const isSelected = canPreviewFull && selectedTicketId === t.id;
                          return (
                            <tr
                              key={t.id}
                              data-testid={`dispensed-row-${t.ticketNumber}`}
                              onClick={canPreviewFull ? () => handleToggleSelect(t.id) : undefined}
                              className={`transition-colors ${
                                canPreviewFull ? 'cursor-pointer' : 'cursor-default'
                              } ${
                                isSelected
                                  ? 'bg-[#EEF2F8]'
                                  : canPreviewFull
                                    ? 'hover:bg-[#F9FAFC]'
                                    : ''
                              }`}
                            >
                              <td className="px-4 py-3 font-mono font-bold text-[#0B192C] whitespace-nowrap">
                                {canPreviewFull ? (
                                  <button
                                    type="button"
                                    aria-expanded={isSelected}
                                    aria-label={`Select dispensed ticket ${t.ticketNumber}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleSelect(t.id);
                                    }}
                                    className="inline-flex items-center gap-1.5 hover:underline focus:outline-none"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                                    <span>{t.ticketNumber}</span>
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                                    <span>{t.ticketNumber}</span>
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-medium text-[#0B192C]">
                                {t.department}
                              </td>
                              <td className="px-4 py-3 font-mono uppercase text-[#334E73] whitespace-nowrap">
                                {t.fuelType}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-[#0B192C] whitespace-nowrap">
                                {t.approvedLiters.toFixed(1)} L
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-emerald-800 whitespace-nowrap">
                                {t.dispensedLiters.toFixed(1)} L
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#334E73] whitespace-nowrap">
                                {t.scheduledDate}
                              </td>
                              <td className="px-4 py-3 font-mono text-[#334E73] whitespace-nowrap">
                                {formatDispensedTimestamp(t.dispensedAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {selectedDispensedItem && renderDispensedReviewPanel(selectedDispensedItem)}
            </div>
          )}
        </div>
      </RecordsPreviewGate>

      {/* Pump Reading Photo Proof Modal */}
      {proofPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pump Reading Photo Proof"
        >
          <div className="w-full max-w-lg rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3">
              <div>
                <h3 className="font-display text-sm font-bold text-[#0B192C]">
                  Pump Reading Proof — Ticket {proofPreview.ticketNumber}
                </h3>
                <p className="font-mono text-[11px] text-[#5A6F8C]">
                  Work Plan No: {proofPreview.workPlanNumber} · File: {proofPreview.fileName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProofPreview(null)}
                aria-label="Close proof preview"
                className="rounded p-1 text-[#5A6F8C] hover:bg-[#E6EBF2] hover:text-[#0B192C]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center justify-center bg-[#F8FAFC] p-4">
              <img
                src={proofPreview.dataUrl}
                alt={`Pump reading proof for ${proofPreview.ticketNumber}`}
                className="max-h-[70vh] w-auto rounded border border-[#D5DCE6] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
