import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Fuel, TrendingDown } from 'lucide-react';
import {
  DailyReconciliationSummary,
  FleetVehicle,
  FuelDepot,
  TripTicket,
  UserAccount,
  WorkPlan,
} from '../types/fuel';
import { canViewDailyReconciliation, getDepartmentMnemonic } from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';
import { NavSection } from './SidebarNav';

interface DashboardViewProps {
  workPlans: WorkPlan[];
  tickets: TripTicket[];
  vehicles?: FleetVehicle[];
  depots: FuelDepot[];
  reconciliation: DailyReconciliationSummary;
  currentUser: UserAccount;
  onNavigate: (section: NavSection) => void;
}

export function DashboardView({
  workPlans,
  tickets,
  vehicles = [],
  depots,
  reconciliation,
  currentUser,
  onNavigate,
}: DashboardViewProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const canOpenDailyReport = canViewDailyReconciliation(currentUser.role);
  const totalGasStock = depots.reduce((s, d) => s + d.gasolineCurrentLiters, 0);
  const totalGasCap = depots.reduce((s, d) => s + d.gasolineCapacityLiters, 0);
  const totalDieselStock = depots.reduce((s, d) => s + d.dieselCurrentLiters, 0);
  const totalDieselCap = depots.reduce((s, d) => s + d.dieselCapacityLiters, 0);

  return (
    <div className="space-y-6">
      {/* 4-Metric Executive KPI Strip */}
      <section aria-label="Key fuel metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-xs font-medium text-[#5A6F8C]">Requested vs Approved</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-[#0B192C]">
              {reconciliation.totalApprovedLiters.toFixed(1)} L
            </span>
            <span className="font-mono text-xs tabular-nums text-[#5A6F8C]">
              / {reconciliation.totalRequestedLiters.toFixed(1)} L req
            </span>
          </div>
          <div className="mt-2 text-xs text-[#334E73]">
            {workPlans.length} active weekly work plan(s)
          </div>
        </div>

        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-xs font-medium text-[#5A6F8C]">Dispensed & Forfeited</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-[#1B3B6F]">
              {reconciliation.totalDispensedLiters.toFixed(1)} L
            </span>
            <span className="font-mono text-xs tabular-nums text-red-700">
              {reconciliation.totalForfeitedLiters.toFixed(1)} L void
            </span>
          </div>
          <div className="mt-2 text-xs text-[#334E73]">
            {reconciliation.dispensedTicketsCount} of {tickets.length} trip tickets served once
          </div>
        </div>

        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-xs font-medium text-[#5A6F8C]">Real-Time Fuel Spend</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-[#0B192C]">
              ₱{reconciliation.totalDispensedCostPhp.toLocaleString('en-PH', {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-emerald-800">
            <TrendingDown className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono tabular-nums">
              ₱{reconciliation.estimatedSavingsFromReductionsPhp.toLocaleString('en-PH', {
                minimumFractionDigits: 2,
              })}{' '}
              saved via tabletop reduction
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-[#D5DCE6] bg-white p-4">
          <div className="text-xs font-medium text-[#5A6F8C]">City Depot Stock Reserve</div>
          <div className="mt-1.5 space-y-1 font-mono text-xs tabular-nums">
            <div className="flex justify-between">
              <span className="text-[#334E73]">Diesel</span>
              <span className="font-bold text-[#0B192C]">
                {totalDieselStock.toLocaleString()} / {totalDieselCap.toLocaleString()} L
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#334E73]">Gasoline</span>
              <span className="font-bold text-[#0B192C]">
                {totalGasStock.toLocaleString()} / {totalGasCap.toLocaleString()} L
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Detailed Project Records, Depot Gauges & Alerts Gate */}
      <RecordsPreviewGate
        title="Projects, Tanks & Alerts"
        description="Work plan utilization, depot tank gauges, and discrepancy alerts."
        recordCount={workPlans.length + reconciliation.alerts.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Details"
      >
        <div className="space-y-2.5">
          {/* Main 2-Column Monitoring Grid: Infrastructure Projects + Depot Levels */}
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        {/* Infrastructure Projects Fuel Monitoring */}
        <section className="lg:col-span-2 rounded-lg border border-[#D5DCE6] bg-white">
          <div className="flex items-center justify-between border-b border-[#D5DCE6] px-3 py-2">
            <h2 className="font-display text-xs font-bold text-[#0B192C]">
              Projects Fuel Monitoring
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('work_plans')}
              className="text-[11px] font-semibold text-[#1B3B6F] hover:underline whitespace-nowrap"
            >
              Work Plans
            </button>
          </div>

          <div className="divide-y divide-[#E6EBF2]">
            {workPlans.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#5A6F8C]">
                No infrastructure work plans logged.
              </div>
            ) : (
              workPlans.map((wp) => {
                const utilization =
                  wp.totalApprovedLiters > 0
                    ? Math.min(100, Math.round((wp.totalDispensedLiters / wp.totalApprovedLiters) * 100))
                    : 0;
                return (
                  <div key={wp.id} className="p-2.5 sm:p-3 space-y-1.5">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#5A6F8C]">
                          <span className="font-mono font-semibold text-[#1B3B6F]">
                            {wp.projectCode || wp.controlNumber}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-bold text-[#0B192C]" title={wp.department}>
                            {getDepartmentMnemonic(wp.department, vehicles)}
                          </span>
                        </div>
                        <div className="font-display text-xs sm:text-sm font-semibold text-[#0B192C] truncate">
                          {wp.projectTitle}
                        </div>
                      </div>
                      <div className="font-mono text-[11px] tabular-nums text-[#0B192C] shrink-0">
                        {wp.totalDispensedLiters.toFixed(1)} / {wp.totalApprovedLiters.toFixed(1)} L
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded bg-[#E6EBF2] overflow-hidden">
                      <div
                        className="h-full bg-[#1B3B6F] transition-all"
                        style={{ width: `${utilization}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Real-Time Fuel Depot Tank Levels */}
        <section className="rounded-lg border border-[#D5DCE6] bg-white">
          <div className="flex items-center justify-between border-b border-[#D5DCE6] px-3 py-2">
            <h2 className="font-display text-xs font-bold text-[#0B192C]">
              Depot Tanks
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-[11px] font-semibold text-[#1B3B6F] hover:underline whitespace-nowrap"
            >
              Manage
            </button>
          </div>
          <div className="divide-y divide-[#E6EBF2]">
            {depots.map((depot) => {
              const gasPct = Math.round(
                (depot.gasolineCurrentLiters / depot.gasolineCapacityLiters) * 100
              );
              const dslPct = Math.round(
                (depot.dieselCurrentLiters / depot.dieselCapacityLiters) * 100
              );
              const threshold = depot.reorderThresholdPct ?? 25;

              return (
                <div key={depot.id} className="p-2.5 sm:p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-display text-xs font-bold text-[#0B192C]">
                      <Fuel className="h-3.5 w-3.5 text-[#1B3B6F] shrink-0" />
                      <span>{depot.name}</span>
                    </div>
                    <span className="text-[10px] text-[#5A6F8C] truncate">{depot.location}</span>
                  </div>

                  {/* Gasoline Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-medium text-[#334E73]">
                        Gas (₱{depot.gasolinePricePerLiter.toFixed(2)}/L)
                      </span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          gasPct <= threshold ? 'text-red-700' : 'text-[#0B192C]'
                        }`}
                      >
                        {depot.gasolineCurrentLiters.toLocaleString()} L ({gasPct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-[#E6EBF2] overflow-hidden">
                      <div
                        className={`h-full ${
                          gasPct <= threshold ? 'bg-red-700' : 'bg-[#334E73]'
                        }`}
                        style={{ width: `${Math.min(100, gasPct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Diesel Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-medium text-[#334E73]">
                        Dsl (₱{depot.dieselPricePerLiter.toFixed(2)}/L)
                      </span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          dslPct <= threshold ? 'text-red-700' : 'text-[#0B192C]'
                        }`}
                      >
                        {depot.dieselCurrentLiters.toLocaleString()} L ({dslPct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-[#E6EBF2] overflow-hidden">
                      <div
                        className={`h-full ${
                          dslPct <= threshold ? 'bg-red-700' : 'bg-[#0B192C]'
                        }`}
                        style={{ width: `${Math.min(100, dslPct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Automated Reconciliation Discrepancy Alerts */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white">
        <div className="flex items-center justify-between border-b border-[#D5DCE6] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
            <h2 className="font-display text-xs font-bold text-[#0B192C]">
              Discrepancy Alerts ({reconciliation.alerts.length})
            </h2>
          </div>
          {canOpenDailyReport && (
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-[11px] font-semibold text-[#1B3B6F] hover:underline whitespace-nowrap"
            >
              Daily Report
            </button>
          )}
        </div>

        {reconciliation.alerts.length === 0 ? (
          <div className="flex items-center gap-2 p-3 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>All tanks and dispensing records reconciled with zero discrepancies.</span>
          </div>
        ) : (
          <div className="divide-y divide-[#E6EBF2]">
            {reconciliation.alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        alert.severity === 'high' ? 'text-red-700' : 'text-amber-800'
                      }`}
                    >
                      {alert.severity}
                    </span>
                    <span className="text-xs font-semibold text-[#0B192C]">{alert.title}</span>
                  </div>
                  <p className="text-[11px] text-[#5A6F8C]">{alert.detail}</p>
                </div>
                {alert.department && (
                  <span
                    className="font-mono text-[11px] font-bold text-[#1B3B6F] shrink-0"
                    title={alert.department}
                  >
                    {getDepartmentMnemonic(alert.department, vehicles)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
          </section>
        </div>
      </RecordsPreviewGate>
    </div>
  );
}
