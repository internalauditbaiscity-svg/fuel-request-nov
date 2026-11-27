import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import {
  DailyReconciliationSummary,
  FleetVehicle,
  FuelDepot,
  ReportUtilitiesConfig,
  UserAccount,
} from '../types/fuel';
import {
  canManageReportUtilities,
  canPreviewAndDownloadPdf,
  canViewDailyReconciliation,
  getActiveReportUtilityKeys,
  getCompactMobileReportSections,
  getDepartmentMnemonic,
  resolveReportPreviewMode,
} from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface ReportsViewProps {
  reportDate: string;
  onChangeReportDate: (date: string) => void;
  report: DailyReconciliationSummary;
  depots: FuelDepot[];
  vehicles?: FleetVehicle[];
  currentUser: UserAccount;
  reportUtilities?: ReportUtilitiesConfig;
  onOpenReportUtilities?: () => void;
  onPreviewDailyPdf: () => void;
  onDownloadDailyPdf: () => void;
}

const DEPT_COLUMN_LABELS: Record<string, string> = {
  department: 'Dept',
  requestedLiters: 'Req (L)',
  approvedLiters: 'Appr (L)',
  dispensedLiters: 'Disp (L)',
  forfeitedLiters: 'Void (L)',
  costPhp: 'Cost (₱)',
};

export function ReportsView({
  reportDate,
  onChangeReportDate,
  report,
  depots,
  vehicles = [],
  currentUser,
  reportUtilities,
  onOpenReportUtilities,
  onPreviewDailyPdf,
  onDownloadDailyPdf,
}: ReportsViewProps) {
  const isAdmin = canViewDailyReconciliation(currentUser.role);
  const canManageUtilities = canManageReportUtilities(currentUser.role);
  const canPdf = canPreviewAndDownloadPdf(currentUser.role);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fullReportOpen, setFullReportOpen] = useState(false);

  useEscapeClose(fullReportOpen, () => setFullReportOpen(false), 3);

  const activeSections = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'reports_full_preview'),
    [reportUtilities]
  );

  const compactSections = useMemo(
    () => getCompactMobileReportSections(activeSections),
    [activeSections]
  );

  const activeDeptColumns = useMemo(
    () => getActiveReportUtilityKeys(reportUtilities, 'reports_dept_table'),
    [reportUtilities]
  );

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-[#D5DCE6] bg-white p-8 text-center space-y-2">
        <ShieldAlert className="mx-auto h-8 w-8 text-[#1B3B6F]" />
        <h2 className="font-display text-base font-bold text-[#0B192C]">
          Administrator Access Required
        </h2>
        <p className="text-xs text-[#5A6F8C]">
          Only the System Administrator is permitted to access Daily Reconciliation and cost analysis reports.
        </p>
      </div>
    );
  }

  const renderSection = (sectionKey: string) => {
    switch (sectionKey) {
      case 'summaryMetrics':
        return (
          <div
            data-testid="reports-section-summaryMetrics"
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
          >
            <div className="rounded-lg border border-[#D5DCE6] bg-white p-3">
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Req (L)</div>
              <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-[#0B192C]">
                {report.totalRequestedLiters.toFixed(1)} L
              </div>
            </div>
            <div className="rounded-lg border border-[#D5DCE6] bg-white p-3">
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Appr (L)</div>
              <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-[#1B3B6F]">
                {report.totalApprovedLiters.toFixed(1)} L
              </div>
            </div>
            <div className="rounded-lg border border-[#D5DCE6] bg-white p-3">
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Disp (L)</div>
              <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-emerald-800">
                {report.totalDispensedLiters.toFixed(1)} L
              </div>
            </div>
            <div className="rounded-lg border border-[#D5DCE6] bg-white p-3">
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Void (L)</div>
              <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-red-700">
                {report.totalForfeitedLiters.toFixed(1)} L
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-lg border border-[#D5DCE6] bg-white p-3">
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Cost (₱)</div>
              <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-[#0B192C]">
                ₱{report.totalDispensedCostPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        );

      case 'departmentBreakdown':
        return (
          <section
            data-testid="reports-section-departmentBreakdown"
            className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
          >
            <div className="border-b border-[#D5DCE6] px-3.5 py-2.5 sm:px-4">
              <h2 className="font-display text-xs sm:text-sm font-bold text-[#0B192C]">
                Dept Recon &amp; Cost
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table data-testid="reports-dept-table" className="w-full text-left text-[11px] sm:text-xs">
                <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                  <tr>
                    {activeDeptColumns.map((colKey) => (
                      <th
                        key={colKey}
                        data-col-key={colKey}
                        className="px-2 py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap"
                      >
                        {DEPT_COLUMN_LABELS[colKey] ?? colKey}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EBF2]">
                  {report.departmentBreakdown.length === 0 ? (
                    <tr>
                      <td
                        colSpan={Math.max(1, activeDeptColumns.length)}
                        className="px-3 py-6 text-center text-[#5A6F8C]"
                      >
                        No transactions recorded for the selected date.
                      </td>
                    </tr>
                  ) : (
                    report.departmentBreakdown.map((row) => {
                      const deptCode = getDepartmentMnemonic(row.department, vehicles);
                      return (
                        <tr key={row.department} className="hover:bg-[#F9FAFC]">
                          {activeDeptColumns.map((colKey) => {
                            switch (colKey) {
                              case 'department':
                                return (
                                  <td
                                    key={colKey}
                                    title={row.department}
                                    className="px-2 py-2 sm:px-3 font-mono font-bold text-[#0B192C] whitespace-nowrap"
                                  >
                                    {deptCode}
                                  </td>
                                );
                              case 'requestedLiters':
                                return (
                                  <td key={colKey} className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                    {row.requestedLiters.toFixed(1)}
                                  </td>
                                );
                              case 'approvedLiters':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums text-[#1B3B6F] whitespace-nowrap"
                                  >
                                    {row.approvedLiters.toFixed(1)}
                                  </td>
                                );
                              case 'dispensedLiters':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums font-bold text-emerald-800 whitespace-nowrap"
                                  >
                                    {row.dispensedLiters.toFixed(1)}
                                  </td>
                                );
                              case 'forfeitedLiters':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums text-red-700 whitespace-nowrap"
                                  >
                                    {row.forfeitedLiters.toFixed(1)}
                                  </td>
                                );
                              case 'costPhp':
                                return (
                                  <td
                                    key={colKey}
                                    className="px-2 py-2 sm:px-3 text-right font-mono tabular-nums font-bold text-[#0B192C] whitespace-nowrap"
                                  >
                                    ₱{row.costPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                  </td>
                                );
                              default:
                                return null;
                            }
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );

      case 'discrepancyAlerts':
        return (
          <section
            data-testid="reports-section-discrepancyAlerts"
            className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
          >
            <div className="border-b border-[#D5DCE6] px-3.5 py-2.5 sm:px-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
              <h2 className="font-display text-xs sm:text-sm font-bold text-[#0B192C]">
                Discrepancy Alerts ({report.alerts.length})
              </h2>
            </div>
            <div className="divide-y divide-[#E6EBF2]">
              {report.alerts.length === 0 ? (
                <div className="p-4 text-xs text-emerald-800">
                  No reconciliation variances or depot threshold alerts detected.
                </div>
              ) : (
                report.alerts.map((a) => (
                  <div key={a.id} className="px-3.5 py-2.5 text-xs space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-bold uppercase text-[10px] ${
                          a.severity === 'high' ? 'text-red-700' : 'text-amber-800'
                        }`}
                      >
                        {a.severity}
                      </span>
                      <span className="font-semibold text-[#0B192C]">{a.title}</span>
                    </div>
                    <p className="text-[11px] text-[#5A6F8C]">{a.detail}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        );

      case 'depotValuation':
        return (
          <section
            data-testid="reports-section-depotValuation"
            className="rounded-lg border border-[#D5DCE6] bg-white p-3.5 sm:p-4"
          >
            <h3 className="font-display text-xs sm:text-sm font-bold text-[#0B192C] mb-2.5">
              Depot Stock Valuation
            </h3>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {depots.map((d) => {
                const gasVal = d.gasolineCurrentLiters * d.gasolinePricePerLiter;
                const dslVal = d.dieselCurrentLiters * d.dieselPricePerLiter;
                return (
                  <div key={d.id} className="rounded border border-[#E6EBF2] bg-[#F9FAFC] p-2.5 text-[11px] sm:text-xs space-y-1">
                    <div className="font-bold text-[#0B192C]">{d.name}</div>
                    <div className="flex justify-between font-mono text-[#334E73]">
                      <span>Gas ({d.gasolineCurrentLiters.toLocaleString()} L)</span>
                      <span>₱{gasVal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between font-mono text-[#334E73]">
                      <span>Diesel ({d.dieselCurrentLiters.toLocaleString()} L)</span>
                      <span>₱{dslVal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact Header Control Strip */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#D5DCE6] bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="recon-date" className="block text-[11px] font-semibold text-[#5A6F8C]">
              Period Date
            </label>
            <input
              id="recon-date"
              type="date"
              value={reportDate}
              onChange={(e) => onChangeReportDate(e.target.value)}
              className="mt-0.5 rounded border border-[#D5DCE6] px-2.5 py-1.5 font-mono text-xs text-[#0B192C]"
            />
          </div>
          <button
            type="button"
            onClick={() => onChangeReportDate('')}
            className="rounded border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-1.5 text-xs font-semibold text-[#334E73] hover:bg-[#E6EBF2]"
          >
            All Active
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManageUtilities && onOpenReportUtilities && (
            <button
              type="button"
              data-testid="reports-open-utilities-btn"
              onClick={onOpenReportUtilities}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1B3B6F] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B3B6F] hover:bg-[#EEF2F8] whitespace-nowrap"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Report Utilities</span>
            </button>
          )}

          {canPdf ? (
            <button
              type="button"
              data-testid="reports-download-optin-btn"
              onClick={() => setFullReportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download Report</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-xs text-[#5A6F8C]">
              <ShieldAlert className="h-4 w-4" />
              <span>PDF export restricted</span>
            </div>
          )}
        </div>
      </div>

      {/* Mobile-Optimized Compact Reconciliation Display Preview */}
      <RecordsPreviewGate
        title="Daily Reconciliation Preview"
        description="Mobile-compact departmental reconciliation summary. Select Download Report for the full multi-section report preview."
        recordCount={report.departmentBreakdown.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Reconciliation"
        maxWidthClass="max-w-[96vw] sm:max-w-lg md:max-w-xl"
        headerActions={
          canPdf ? (
            <button
              type="button"
              data-testid="reports-preview-download-btn"
              onClick={() => setFullReportOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-[#1B3B6F] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#1B3B6F] hover:bg-[#EEF2F8] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>
          ) : undefined
        }
      >
        <div
          className="space-y-2.5"
          data-testid="reports-mobile-compact-preview"
          data-preview-mode={resolveReportPreviewMode(false)}
        >
          {/* Compact Inline Totals Strip (replaces tall multi-card KPI grid on mobile) */}
          <div className="grid grid-cols-4 gap-1 rounded-md border border-[#D5DCE6] bg-white px-2 py-1.5 text-center">
            <div>
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Req</div>
              <div className="font-mono text-[11px] font-bold tabular-nums text-[#0B192C]">
                {report.totalRequestedLiters.toFixed(0)} L
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Appr</div>
              <div className="font-mono text-[11px] font-bold tabular-nums text-[#1B3B6F]">
                {report.totalApprovedLiters.toFixed(0)} L
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Disp</div>
              <div className="font-mono text-[11px] font-bold tabular-nums text-emerald-800">
                {report.totalDispensedLiters.toFixed(0)} L
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-[#5A6F8C]">Cost</div>
              <div className="font-mono text-[11px] font-bold tabular-nums text-[#0B192C] truncate">
                ₱{Math.round(report.totalDispensedCostPhp).toLocaleString('en-PH')}
              </div>
            </div>
          </div>

          {compactSections.map((sectionKey) => (
            <Fragment key={sectionKey}>{renderSection(sectionKey)}</Fragment>
          ))}
        </div>
      </RecordsPreviewGate>

      {/* Full Preview Report View — Presented ONLY once Download Report is opted */}
      {fullReportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Full Reconciliation Report Preview"
          data-testid="reports-full-download-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFullReportOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-[96vw] sm:max-w-3xl lg:max-w-4xl flex-col rounded-lg border border-[#1B3B6F] bg-[#F8FAFC] shadow-2xl overflow-hidden">
            <div className="space-y-2 border-b border-[#D5DCE6] bg-white px-3.5 py-2.5 sm:px-4 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-sm font-bold text-[#0B192C] leading-snug">
                    Full Report — Daily Reconciliation
                  </h2>
                  <p className="font-mono text-[10px] sm:text-[11px] text-[#5A6F8C]">
                    {reportDate ? `Period: ${reportDate}` : 'All Active Records'} · {activeSections.length} sections
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFullReportOpen(false)}
                  aria-label="Close full report preview"
                  data-testid="reports-full-download-close-btn"
                  className="inline-flex items-center justify-center rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
                >
                  Close
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="reports-confirm-download-pdf"
                  onClick={onDownloadDailyPdf}
                  className="inline-flex items-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  onClick={onPreviewDailyPdf}
                  className="inline-flex items-center gap-1 rounded-md border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#E6EBF2] whitespace-nowrap"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>PDF Preview</span>
                </button>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
              data-testid="reports-full-preview-sections"
              data-preview-mode={resolveReportPreviewMode(true)}
            >
              {activeSections.map((sectionKey) => (
                <Fragment key={sectionKey}>{renderSection(sectionKey)}</Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
