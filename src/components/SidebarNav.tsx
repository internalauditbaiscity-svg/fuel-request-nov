import {
  Building2,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  FolderKanban,
  Fuel,
  History,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  EnvironmentMode,
  NavSection,
  ROLE_LABELS,
  UserAccount,
  UserRole,
} from '../types/fuel';
import { canAccessNavSection } from '../utils/fuelEngine';

export type { NavSection } from '../types/fuel';

interface SidebarNavProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  currentUser: UserAccount;
  isActualAdmin: boolean;
  envMode: EnvironmentMode;
  sandboxRole: UserRole;
  onChangeSandboxRole: (role: UserRole) => void;
  sandboxDepartment: string;
  sandboxDepartmentOptions: string[];
  onChangeSandboxDepartment: (dept: string) => void;
  sandboxMatchingUsers: UserAccount[];
  selectedSandboxUserUid: string | null;
  onChangeSelectedSandboxUserUid: (uid: string | null) => void;
  onRequestPurgeSandbox: () => void;
  onSignOut: () => void;
  pendingApprovalCount: number;
  readyToDispenseCount: number;
  alertCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function SidebarNav({
  activeSection,
  onSelectSection,
  currentUser,
  isActualAdmin,
  envMode,
  sandboxRole,
  onChangeSandboxRole,
  sandboxDepartment,
  sandboxDepartmentOptions,
  onChangeSandboxDepartment,
  sandboxMatchingUsers,
  selectedSandboxUserUid,
  onChangeSelectedSandboxUserUid,
  onRequestPurgeSandbox,
  onSignOut,
  pendingApprovalCount,
  readyToDispenseCount,
  alertCount,
  mobileOpen,
  onCloseMobile,
}: SidebarNavProps) {
  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof FileSpreadsheet;
    badge?: number;
    visible: boolean;
  }> = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: alertCount > 0 ? alertCount : undefined,
      visible: canAccessNavSection(currentUser.role, 'dashboard'),
    },
    {
      id: 'registries',
      label: 'Master Registries',
      icon: FolderKanban,
      visible: canAccessNavSection(currentUser.role, 'registries'),
    },
    {
      id: 'work_plans',
      label: 'Department Request',
      icon: FileSpreadsheet,
      visible: canAccessNavSection(currentUser.role, 'work_plans'),
    },
    {
      id: 'approvals',
      label: 'Fuel Request Approval',
      icon: ClipboardCheck,
      badge: pendingApprovalCount > 0 ? pendingApprovalCount : undefined,
      visible: canAccessNavSection(currentUser.role, 'approvals'),
    },
    {
      id: 'dispensing',
      label: 'GSO Fuel Dispensing',
      icon: Fuel,
      badge: readyToDispenseCount > 0 ? readyToDispenseCount : undefined,
      visible: canAccessNavSection(currentUser.role, 'dispensing'),
    },
    {
      id: 'inventory',
      label: 'Depot Inventory & Logs',
      icon: Database,
      visible: canAccessNavSection(currentUser.role, 'inventory'),
    },
    {
      id: 'users',
      label: 'User Creation & RBAC',
      icon: Users,
      visible: canAccessNavSection(currentUser.role, 'users'),
    },
    {
      id: 'reports',
      label: 'Daily Reconciliation',
      icon: Fuel,
      visible: canAccessNavSection(currentUser.role, 'reports'),
    },
    {
      id: 'audit',
      label: 'Audit Logs',
      icon: History,
      visible: canAccessNavSection(currentUser.role, 'audit'),
    },
  ];

  const visibleItems = navItems.filter((item) => item.visible);

  const content = (
    <aside className="flex h-full w-[264px] flex-col bg-[#0B192C] text-slate-100 select-none">
      {/* Official City Header */}
      <div className="flex items-center justify-between border-b border-[#1A2F4D] px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#1B3B6F] border border-[#2C528F]">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold tracking-tight text-white truncate">
              LGU Bais City
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              Fuel & Fleet Command
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden rounded p-1.5 text-slate-400 hover:bg-[#13294B] hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Main Left Navigation */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-400">
          Main Menu
        </div>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#1B3B6F] text-white'
                  : 'text-slate-300 hover:bg-[#13294B] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="h-4 w-4 shrink-0 text-slate-300" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span className="font-mono text-xs tabular-nums text-slate-200 bg-[#0F2442] px-1.5 py-0.5 rounded">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sandbox Role Tester & Purge (Only available to Authenticated Admin in Sandbox) */}
      {envMode === 'sandbox' && isActualAdmin && (
        <div className="border-t border-[#1A2F4D] px-4 py-3 space-y-2 bg-[#091525]">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
            <span>Sandbox Role Preview</span>
            <button
              type="button"
              onClick={() => {
                onCloseMobile();
                onRequestPurgeSandbox();
              }}
              className="inline-flex items-center gap-1 text-red-300 hover:text-red-200"
            >
              <Trash2 className="h-3 w-3" />
              <span>Purge</span>
            </button>
          </div>
          <label htmlFor="sandbox-role-select" className="sr-only">
            Practice Role
          </label>
          <select
            id="sandbox-role-select"
            value={sandboxRole}
            onChange={(e) => onChangeSandboxRole(e.target.value as UserRole)}
            className="w-full rounded border border-[#243B5E] bg-[#13294B] px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none"
          >
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <label htmlFor="sandbox-dept-select" className="sr-only">
            Practice Department
          </label>
          <select
            id="sandbox-dept-select"
            value={sandboxDepartment}
            disabled={sandboxDepartmentOptions.length <= 1}
            onChange={(e) => onChangeSandboxDepartment(e.target.value)}
            className="w-full rounded border border-[#243B5E] bg-[#13294B] px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-80 disabled:cursor-not-allowed"
          >
            {sandboxDepartmentOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {sandboxRole !== 'admin' && sandboxMatchingUsers.length > 1 && (
            <>
              <label htmlFor="sandbox-user-select" className="sr-only">
                Preview RBAC User
              </label>
              <select
                id="sandbox-user-select"
                value={selectedSandboxUserUid || sandboxMatchingUsers[0]?.uid || ''}
                onChange={(e) => onChangeSelectedSandboxUserUid(e.target.value || null)}
                className="w-full rounded border border-[#243B5E] bg-[#13294B] px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none"
              >
                {sandboxMatchingUsers.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    @{u.username || u.email.split('@')[0]} — {u.displayName}
                  </option>
                ))}
              </select>
            </>
          )}
          {sandboxRole !== 'admin' && (() => {
            const matchedAccount =
              sandboxMatchingUsers.find((u) => u.uid === currentUser.uid) ??
              sandboxMatchingUsers[0] ??
              null;
            const activePerms = [
              currentUser.canEdit && 'Edit',
              currentUser.canDelete && 'Del',
              currentUser.canRequestSingleTrip && 'Single',
              currentUser.canSwitchToLive && 'Live',
            ].filter(Boolean) as string[];
            return (
              <div
                data-testid="sandbox-rbac-summary"
                className="rounded border border-[#1E3557] bg-[#0D1E36] px-2 py-1 text-[10px] font-mono text-slate-300 truncate"
                title={
                  matchedAccount
                    ? `RBAC Account: ${matchedAccount.displayName} (@${matchedAccount.username || matchedAccount.email.split('@')[0]})`
                    : 'No active RBAC account assigned to this role & office (defaults to Read-Only)'
                }
              >
                {matchedAccount
                  ? `@${matchedAccount.username || matchedAccount.email.split('@')[0]} · ${
                      activePerms.length > 0 ? activePerms.join(' · ') : 'Read-Only'
                    }`
                  : 'No RBAC user · Read-Only'}
              </div>
            );
          })()}
        </div>
      )}

      {/* Active User & Sign Out Footer */}
      <div className="border-t border-[#1A2F4D] p-4 space-y-2 text-xs">
        <div className="flex items-center gap-2 text-slate-200 font-medium truncate">
          <ShieldCheck className="h-4 w-4 shrink-0 text-slate-300" />
          <span className="truncate">{currentUser.displayName}</span>
        </div>
        <div className="text-[11px] text-slate-400 space-y-0.5">
          <div className="truncate">{ROLE_LABELS[currentUser.role]}</div>
          <div className="truncate text-slate-300">{currentUser.department}</div>
          <div className="pt-0.5 font-mono text-[10px] text-slate-400">
            Database: {envMode === 'live' ? 'LIVE CLOUD' : 'SANDBOX'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onCloseMobile();
            onSignOut();
          }}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-[#243B5E] bg-[#13294B] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1B3B6F] hover:text-white transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block shrink-0 h-screen sticky top-0">
        {content}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#0B192C]/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
