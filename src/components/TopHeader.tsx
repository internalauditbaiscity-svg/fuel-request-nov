import {
  Cloud,
  CloudOff,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import { EnvironmentMode } from '../types/fuel';
import { NavSection } from './SidebarNav';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  fleet: 'Fleet Registry',
  work_plans: 'Department Request',
  approvals: 'Request Approval',
  dispensing: 'GSO Fuel Dispensing',
  inventory: 'Depot Inventory & Logs',
  users: 'User Creation & RBAC',
  reports: 'Daily Reconciliation',
  audit: 'Audit Logs',
};

interface TopHeaderProps {
  activeSection: NavSection;
  envMode: EnvironmentMode;
  onChangeEnvMode: (mode: EnvironmentMode) => void;
  isOnline: boolean;
  simulatedOffline: boolean;
  onToggleSimulatedOffline: () => void;
  syncQueueCount: number;
  onFlushSyncQueue: () => void;
  isActualAdmin: boolean;
  firebaseUser: FirebaseUser | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenMobileNav: () => void;
  onOpenNewWorkPlan: () => void;
  onRequestPurgeSandbox: () => void;
}

export function TopHeader({
  activeSection,
  envMode,
  onChangeEnvMode,
  isOnline,
  simulatedOffline,
  onToggleSimulatedOffline,
  syncQueueCount,
  onFlushSyncQueue,
  isActualAdmin,
  onSignOut,
  onOpenMobileNav,
  onOpenNewWorkPlan,
  onRequestPurgeSandbox,
}: TopHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#D5DCE6] bg-white px-3 py-2.5 sm:px-4 lg:px-6">
      <div className="flex items-center justify-between gap-3">
        {/* Zone 1: Menu button (mobile) + Single-line Section Title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileNav}
            aria-label="Open navigation menu"
            className="lg:hidden rounded-md border border-[#D5DCE6] p-2 text-[#0B192C] hover:bg-[#F3F5F8] min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="font-display text-sm sm:text-base lg:text-lg font-bold text-[#0B192C] truncate">
            {SECTION_TITLES[activeSection]}
          </h1>
        </div>

        {/* Zone 2 & 3: Single-row Operational Controls + Primary CTA */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Live / Sandbox Segmented Switch */}
          <div
            role="group"
            aria-label="Database environment"
            className="flex items-center rounded-md border border-[#D5DCE6] bg-[#F3F5F8] p-0.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => onChangeEnvMode('sandbox')}
              className={`px-2 sm:px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                envMode === 'sandbox'
                  ? 'bg-[#0B192C] text-white'
                  : 'text-[#334E73] hover:text-[#0B192C]'
              }`}
            >
              Sandbox
            </button>
            <button
              type="button"
              onClick={() => onChangeEnvMode('live')}
              className={`px-2 sm:px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                envMode === 'live'
                  ? 'bg-[#1B3B6F] text-white'
                  : 'text-[#334E73] hover:text-[#0B192C]'
              }`}
            >
              Live
            </button>
          </div>

          {/* Sandbox Purge Button (Admin Desktop/Tablet) */}
          {envMode === 'sandbox' && isActualAdmin && (
            <button
              type="button"
              onClick={onRequestPurgeSandbox}
              title="Purge all sandbox practice records"
              className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-[#D5DCE6] bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Purge Sandbox</span>
            </button>
          )}

          {/* Offline Mode Toggle (Desktop/Tablet) */}
          <button
            type="button"
            onClick={onToggleSimulatedOffline}
            title={
              simulatedOffline
                ? 'Resume cloud connectivity'
                : 'Toggle field offline mode'
            }
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              !isOnline
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-[#D5DCE6] bg-white text-[#334E73] hover:bg-[#F3F5F8]'
            }`}
          >
            {isOnline ? (
              <Cloud className="h-3.5 w-3.5 text-emerald-700" />
            ) : (
              <CloudOff className="h-3.5 w-3.5 text-amber-700" />
            )}
            <span className="hidden md:inline">{isOnline ? 'Online' : 'Offline'}</span>
          </button>

          {syncQueueCount > 0 && (
            <button
              type="button"
              onClick={onFlushSyncQueue}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1B3B6F] bg-[#EEF2F8] px-2.5 py-1.5 text-xs font-semibold text-[#1B3B6F] hover:bg-[#E1E8F2] whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">Sync ({syncQueueCount})</span>
            </button>
          )}

          {/* Sign Out */}
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-[#D5DCE6] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334E73] hover:bg-[#F3F5F8] whitespace-nowrap shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Sign Out</span>
          </button>

          {/* Primary CTA */}
          <button
            type="button"
            onClick={onOpenNewWorkPlan}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Work Plan</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>
    </header>
  );
}
