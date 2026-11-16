import { useState } from 'react';
import { AlertTriangle, Download, Eye, ShieldAlert } from 'lucide-react';
import {
  DailyReconciliationSummary,
  FuelDepot,
  UserAccount,
} from '../types/fuel';
import {
  canPreviewAndDownloadPdf,
  canViewDailyReconciliation,
} from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface ReportsViewProps {
  reportDate: string;
  onChangeReportDate: (date: string) => void;
  report: DailyReconciliationSummary;
  depots: FuelDepot[];
  currentUser: UserAccount;
  onPreviewDailyPdf: () => void;
  onDownloadDailyPdf: () => void;
}

export function ReportsView({
  reportDate,
  onChangeReportDate,
  report,
  depots,
  currentUser,
  onPreviewDailyPdf,
  onDownloadDailyPdf,
}: ReportsViewProps) {
  const isAdmin = canViewDailyReconciliation(currentUser.role);
  const canPdf = canPreviewAndDownloadPdf(currentUser.role);
  const [previewOpen, setPreviewOpen] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Header Control Strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#D5DCE6] bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="recon-date" className="block text-[11px] font-semibold text-[#5A6F8C]">
              Reconciliation Period Date
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
            className="mt-4 rounded border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-1.5 text-xs font-semibold text-[#334E73] hover:bg-[#E6EBF2]"
          >
            All Active Records
          </button>
        </div>

        {canPdf ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onPreviewDailyPdf}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#D5DCE6] bg-white px-3.5 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#F3F5F8] whitespace-nowrap"
            >
              <Eye className="h-4 w-4" />
              <span>Preview PDF</span>
            </button>
            <button
              type="button"
              onClick={onDownloadDailyPdf}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              <span>Download PDF</span>
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs text-[#5A6F8C]">
            <ShieldAlert className="h-4 w-4" />
            <span>PDF export restricted to authorized administrative roles</span>
          </div>
        )}
      </div>

      {/* Reconciliation Records Gate */}
      <RecordsPreviewGate
        title="Daily Reconciliation & Discrepancy Records"
        description="Automated departmental fuel reconciliation, cost analysis, and discrepancy alerts remain hidden until Preview is pressed."
        recordCount={report.departmentBreakdown.length + report.alerts.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Reconciliation"
      >
        <div className="space-y-6">
          {/* Automated Daily Summary Metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-[11px] text-[#5A6F8C]">Requested</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#0B192C]">
            {report.totalRequestedLiters.toFixed(1)} L
          </div>
        </div>
        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-[11px] text-[#5A6F8C]">Approved</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#1B3B6F]">
            {report.totalApprovedLiters.toFixed(1)} L
          </div>
        </div>
        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-[11px] text-[#5A6F8C]">Dispensed</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-800">
            {report.totalDispensedLiters.toFixed(1)} L
          </div>
        </div>
        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-[11px] text-[#5A6F8C]">Forfeited (Void)</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-red-700">
            {report.totalForfeitedLiters.toFixed(1)} L
          </div>
        </div>
        <div className="col-span-2 lg:col-span-1 rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-[11px] text-[#5A6F8C]">Total Cost (PHP)</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#0B192C]">
            ₱{report.totalDispensedCostPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Departmental Cost Analysis & Reconciliation Table */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
        <div className="border-b border-[#D5DCE6] px-5 py-3.5">
          <h2 className="font-display text-sm font-bold text-[#0B192C]">
            Departmental Reconciliation & Cost Analysis
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Department / Office</th>
                <th className="px-4 py-2.5 font-semibold text-right">Requested (L)</th>
                <th className="px-4 py-2.5 font-semibold text-right">Approved (L)</th>
                <th className="px-4 py-2.5 font-semibold text-right">Dispensed (L)</th>
                <th className="px-4 py-2.5 font-semibold text-right">Forfeited (L)</th>
                <th className="px-4 py-2.5 font-semibold text-right">Cost Analysis (PHP)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6EBF2]">
              {report.departmentBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#5A6F8C]">
                    No transactions recorded for the selected date.
                  </td>
                </tr>
              ) : (
                report.departmentBreakdown.map((row) => (
                  <tr key={row.department} className="hover:bg-[#F9FAFC]">
                    <td className="px-4 py-2.5 font-semibold text-[#0B192C]">{row.department}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {row.requestedLiters.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#1B3B6F]">
                      {row.approvedLiters.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-emerald-800">
                      {row.dispensedLiters.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-red-700">
                      {row.forfeitedLiters.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-[#0B192C]">
                      ₱{row.costPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Automated Discrepancy Alerts */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
        <div className="border-b border-[#D5DCE6] px-5 py-3.5 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <h2 className="font-display text-sm font-bold text-[#0B192C]">
            Automated Reconciliation Discrepancy Alerts ({report.alerts.length})
          </h2>
        </div>
        <div className="divide-y divide-[#E6EBF2]">
          {report.alerts.length === 0 ? (
            <div className="p-6 text-xs text-emerald-800">
              No reconciliation variances or depot threshold alerts detected.
            </div>
          ) : (
            report.alerts.map((a) => (
              <div key={a.id} className="px-5 py-3 text-xs space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-bold uppercase text-[11px] ${
                      a.severity === 'high' ? 'text-red-700' : 'text-amber-800'
                    }`}
                  >
                    {a.severity}
                  </span>
                  <span className="font-semibold text-[#0B192C]">{a.title}</span>
                </div>
                <p className="text-[#5A6F8C]">{a.detail}</p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Depot Valuation Snapshot */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white p-5">
        <h3 className="font-display text-sm font-bold text-[#0B192C] mb-3">
          Depot Remaining Stock Valuation
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {depots.map((d) => {
            const gasVal = d.gasolineCurrentLiters * d.gasolinePricePerLiter;
            const dslVal = d.dieselCurrentLiters * d.dieselPricePerLiter;
            return (
              <div key={d.id} className="rounded border border-[#E6EBF2] bg-[#F9FAFC] p-3 text-xs space-y-1">
                <div className="font-bold text-[#0B192C]">{d.name}</div>
                <div className="flex justify-between font-mono text-[#334E73]">
                  <span>Gasoline ({d.gasolineCurrentLiters.toLocaleString()} L)</span>
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
      </div>
    </RecordsPreviewGate>
  </div>
  );
}
