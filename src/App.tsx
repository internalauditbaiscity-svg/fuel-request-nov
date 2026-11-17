import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, LogIn, RefreshCw, Trash2 } from 'lucide-react';
import { ApprovalsView } from './components/ApprovalsView';
import { AuditLogsView } from './components/AuditLogsView';
import { DashboardView } from './components/DashboardView';
import { DepotInventoryView } from './components/DepotInventoryView';
import { DispensingView } from './components/DispensingView';
import { FleetRegistryView } from './components/FleetRegistryView';
import { LoginView } from './components/LoginView';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { ReportsView } from './components/ReportsView';
import { NavSection, SidebarNav } from './components/SidebarNav';
import { TopHeader } from './components/TopHeader';
import { UsersAdminView } from './components/UsersAdminView';
import { WorkPlansView } from './components/WorkPlansView';
import { useFuelStore } from './hooks/useFuelStore';
import {
  buildDailyReconciliationReport,
  canAccessNavSection,
  canManageUsers,
  canUserSwitchToLive,
  getDefaultNavSection,
} from './utils/fuelEngine';
import {
  GeneratedPdfResult,
  generateDailyReconciliationPdf,
  generateWorkPlanPdf,
} from './utils/pdfGenerator';

const VALID_SECTIONS: NavSection[] = [
  'dashboard',
  'fleet',
  'work_plans',
  'approvals',
  'dispensing',
  'inventory',
  'users',
  'reports',
  'audit',
];

export default function App() {
  const store = useFuelStore();
  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    const candidate = store.initialSection as NavSection | undefined;
    if (
      candidate &&
      VALID_SECTIONS.includes(candidate) &&
      canAccessNavSection(store.currentUser.role, candidate)
    ) {
      return candidate;
    }
    return getDefaultNavSection(store.currentUser.role);
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newWorkPlanOpen, setNewWorkPlanOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [reportDate, setReportDate] = useState<string>('');
  const [activePdf, setActivePdf] = useState<GeneratedPdfResult | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionNonce, setSessionNonce] = useState(0);

  const reconciliation = useMemo(
    () =>
      buildDailyReconciliationReport({
        date: reportDate,
        workPlans: store.visibleWorkPlans,
        tickets: store.visibleTickets,
        depots: store.data.depots,
        inventoryLogs: store.data.inventoryLogs,
      }),
    [
      reportDate,
      store.visibleWorkPlans,
      store.visibleTickets,
      store.data.depots,
      store.data.inventoryLogs,
    ]
  );

  const pendingApprovalCount = store.visibleWorkPlans.filter(
    (w) => w.status === 'pending_approval'
  ).length;
  const readyToDispenseCount = store.visibleTickets.filter(
    (t) => !t.servedOnce && (t.status === 'approved' || t.status === 'reduced') && t.approvedLiters > 0
  ).length;

  const isActualAdmin = Boolean(
    store.authenticatedUser?.role === 'admin' ||
      (store.envMode === 'live' && store.currentUser.role === 'admin')
  );
  const canSwitchEnvironment = canUserSwitchToLive(store.currentUser);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await store.signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    }
  };

  const handleClosePdf = useCallback(() => {
    setActivePdf((prev) => {
      if (prev?.blobUrl) {
        URL.revokeObjectURL(prev.blobUrl);
      }
      return null;
    });
  }, []);

  const clearDomInputsAndSession = useCallback(() => {
    if (typeof document !== 'undefined') {
      const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea'
      );
      fields.forEach((el) => {
        el.value = '';
      });
    }
    try {
      sessionStorage.clear();
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const activeUid = store.authenticatedUser?.uid ?? store.firebaseUser?.uid ?? null;
  const prevAuthRef = useRef<{ isAuthenticated: boolean; uid: string | null }>({
    isAuthenticated: store.isAuthenticated,
    uid: activeUid,
  });

  useEffect(() => {
    const prev = prevAuthRef.current;
    const signedInNow = !prev.isAuthenticated && store.isAuthenticated;
    const switchedUser = store.isAuthenticated && prev.uid !== null && activeUid !== prev.uid;
    const signedOutNow = prev.isAuthenticated && !store.isAuthenticated;

    if (signedInNow || switchedUser) {
      // Direct user to their role's default initial module upon sign-in
      const defaultSection = getDefaultNavSection(store.currentUser.role);
      setActiveSection(defaultSection);
      store.persistActiveSection(defaultSection);
      setMobileNavOpen(false);
      setNewWorkPlanOpen(false);
      setPurgeConfirmOpen(false);
      setReportDate('');
      setAuthError(null);
      handleClosePdf();
      setSessionNonce((n) => n + 1);
    } else if (signedOutNow) {
      clearDomInputsAndSession();
      setActiveSection('dashboard');
      setMobileNavOpen(false);
      setNewWorkPlanOpen(false);
      setPurgeConfirmOpen(false);
      setReportDate('');
      setAuthError(null);
      handleClosePdf();
      setSessionNonce((n) => n + 1);
    }

    prevAuthRef.current = { isAuthenticated: store.isAuthenticated, uid: activeUid };
  }, [
    store.isAuthenticated,
    store.currentUser.role,
    store.persistActiveSection,
    activeUid,
    handleClosePdf,
    clearDomInputsAndSession,
  ]);

  const handleSignOut = useCallback(async () => {
    clearDomInputsAndSession();
    setActiveSection('dashboard');
    setMobileNavOpen(false);
    setNewWorkPlanOpen(false);
    setPurgeConfirmOpen(false);
    setReportDate('');
    setAuthError(null);
    handleClosePdf();
    await store.logout();
    setSessionNonce((n) => n + 1);
  }, [clearDomInputsAndSession, handleClosePdf, store]);

  const handleSelectSection = (sec: NavSection) => {
    if (!canAccessNavSection(store.currentUser.role, sec)) {
      const fallback = getDefaultNavSection(store.currentUser.role);
      setActiveSection(fallback);
      store.persistActiveSection(fallback);
      return;
    }
    setActiveSection(sec);
    store.persistActiveSection(sec);
  };

  // Startup User Authentication Gate
  if (!store.isAuthenticated) {
    return (
      <LoginView
        key={`login_${sessionNonce}`}
        sessionExpiredNotice={store.sessionExpiredNotice}
        onCredentialLogin={store.loginWithCredentials}
        onGoogleSignIn={async () => {
          await store.signInWithGoogle();
        }}
      />
    );
  }

  const resolvedSection: NavSection = canAccessNavSection(store.currentUser.role, activeSection)
    ? activeSection
    : getDefaultNavSection(store.currentUser.role);
  const canCreateWorkPlan = canAccessNavSection(store.currentUser.role, 'work_plans');

  return (
    <div key={`app_${sessionNonce}`} className="min-h-screen flex bg-[#F3F5F8] text-[#0B192C]">
      <SidebarNav
        activeSection={resolvedSection}
        onSelectSection={handleSelectSection}
        currentUser={store.currentUser}
        isActualAdmin={isActualAdmin}
        envMode={store.envMode}
        sandboxRole={store.sandboxActiveRole}
        onChangeSandboxRole={(role) => {
          store.setSandboxActiveRole(role);
          const nextDefault = getDefaultNavSection(role);
          setActiveSection(nextDefault);
          store.persistActiveSection(nextDefault);
        }}
        sandboxDepartment={store.sandboxActiveDepartment}
        onChangeSandboxDepartment={store.setSandboxActiveDepartment}
        onRequestPurgeSandbox={() => setPurgeConfirmOpen(true)}
        onSignOut={handleSignOut}
        pendingApprovalCount={pendingApprovalCount}
        readyToDispenseCount={readyToDispenseCount}
        alertCount={reconciliation.alerts.length}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopHeader
          activeSection={resolvedSection}
          envMode={store.envMode}
          canSwitchEnvironment={canSwitchEnvironment}
          onChangeEnvMode={(mode) => {
            if (mode === 'live' && !canSwitchEnvironment) return;
            store.setEnvMode(mode);
            if (!canAccessNavSection(store.currentUser.role, resolvedSection)) {
              const fallback = getDefaultNavSection(store.currentUser.role);
              setActiveSection(fallback);
              store.persistActiveSection(fallback);
            }
          }}
          isOnline={store.isOnline}
          simulatedOffline={store.simulatedOffline}
          onToggleSimulatedOffline={() => store.setSimulatedOffline((v) => !v)}
          syncQueueCount={store.syncQueue.length}
          onFlushSyncQueue={store.flushSyncQueue}
          isActualAdmin={isActualAdmin}
          canCreateWorkPlan={canCreateWorkPlan}
          firebaseUser={store.firebaseUser}
          onSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenNewWorkPlan={() => {
            if (!canCreateWorkPlan) return;
            setActiveSection('work_plans');
            store.persistActiveSection('work_plans');
            setNewWorkPlanOpen(true);
          }}
          onRequestPurgeSandbox={() => setPurgeConfirmOpen(true)}
        />

        {/* Contextual Environment / Sync / Auth Banners */}
        <div className="px-4 pt-4 lg:px-6 space-y-2.5 max-w-[1440px] w-full mx-auto">
          {store.syncNotice && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[#C5D1E3] bg-[#EEF2F8] px-4 py-2.5 text-xs font-medium text-[#0B192C]">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#1B3B6F] shrink-0" />
                <span>{store.syncNotice}</span>
              </span>
            </div>
          )}

          {authError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-900">
              {authError}
            </div>
          )}

          {store.envMode === 'sandbox' && store.data.workPlans.length === 0 && store.data.vehicles.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#D5DCE6] bg-white px-4 py-2.5 text-xs">
              <span className="text-[#334E73]">
                Sandbox practice database is currently purged. Start entering clean test records or restore Bais City sample records.
              </span>
              <button
                type="button"
                onClick={store.restoreSandboxDemoData}
                className="inline-flex items-center gap-1.5 rounded border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#E6EBF2]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Restore Sample Data</span>
              </button>
            </div>
          )}

          {store.envMode === 'live' && !store.firebaseUser && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#1B3B6F] bg-white px-4 py-3 text-xs">
              <div className="flex items-center gap-2.5">
                <Database className="h-4 w-4 text-[#1B3B6F] shrink-0" />
                <span>
                  <strong>Live Cloud Database Selected:</strong> Sign in with Google to synchronize real-time records with Firebase Firestore. Offline entries will queue until authenticated.
                </span>
              </div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign In with Google</span>
              </button>
            </div>
          )}

          {store.envMode === 'live' &&
            store.firebaseUser &&
            canManageUsers(store.currentUser.role) &&
            store.data.depots.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#D5DCE6] bg-white px-4 py-2.5 text-xs">
                <span className="text-[#334E73]">
                  Live Cloud Firestore is ready. Initialize baseline Bais City GSO Depots and Fleet units?
                </span>
                <button
                  type="button"
                  onClick={store.seedLiveBaselineData}
                  className="rounded-md bg-[#1B3B6F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0B192C] whitespace-nowrap"
                >
                  Initialize Live Baseline
                </button>
              </div>
            )}
        </div>

        {/* Main Active Content Viewport */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {resolvedSection === 'dashboard' && (
            <DashboardView
              workPlans={store.visibleWorkPlans}
              tickets={store.visibleTickets}
              depots={store.data.depots}
              reconciliation={reconciliation}
              currentUser={store.currentUser}
              onNavigate={handleSelectSection}
            />
          )}

          {resolvedSection === 'fleet' && (
            <FleetRegistryView
              vehicles={store.visibleVehicles}
              currentUser={store.currentUser}
              onSaveVehicle={store.saveVehicle}
              onDeleteVehicle={store.deleteVehicle}
            />
          )}

          {resolvedSection === 'work_plans' && (
            <WorkPlansView
              workPlans={store.visibleWorkPlans}
              allWorkPlans={store.data.workPlans}
              tickets={store.visibleTickets}
              allTickets={store.data.tripTickets}
              vehicles={store.visibleVehicles}
              depots={store.data.depots}
              currentUser={store.currentUser}
              isModalOpen={newWorkPlanOpen}
              onOpenModal={() => setNewWorkPlanOpen(true)}
              onCloseModal={() => setNewWorkPlanOpen(false)}
              onCreateWorkPlan={store.createWorkPlanWithTickets}
              onPreviewPdf={(wp, planTickets) => setActivePdf(generateWorkPlanPdf(wp, planTickets))}
              onUpdateWorkPlanAdmin={store.updateWorkPlanAdmin}
              onDeleteWorkPlan={store.deleteWorkPlan}
            />
          )}

          {resolvedSection === 'approvals' && (
            <ApprovalsView
              workPlans={store.visibleWorkPlans}
              tickets={store.visibleTickets}
              currentUser={store.currentUser}
              onSubmitApproval={store.submitTabletopApproval}
            />
          )}

          {resolvedSection === 'dispensing' && (
            <DispensingView
              tickets={store.visibleTickets}
              workPlans={store.visibleWorkPlans}
              depots={store.data.depots}
              currentUser={store.currentUser}
              onDispenseTicket={store.dispenseTripTicket}
            />
          )}

          {resolvedSection === 'inventory' && (
            <DepotInventoryView
              depots={store.data.depots}
              inventoryLogs={store.data.inventoryLogs}
              currentUser={store.currentUser}
              onRecordTransaction={store.recordDepotTransaction}
              onVerifyPending={store.verifyPendingAdjustment}
            />
          )}

          {resolvedSection === 'users' && (
            <UsersAdminView
              users={store.data.users}
              currentUser={store.currentUser}
              onCreateUser={store.createUserAccount}
              onUpdateUser={store.updateUserAccount}
              onDeleteUser={store.deleteUserAccount}
              onToggleActive={store.toggleUserActive}
            />
          )}

          {resolvedSection === 'reports' && (
            <ReportsView
              reportDate={reportDate}
              onChangeReportDate={setReportDate}
              report={reconciliation}
              depots={store.data.depots}
              currentUser={store.currentUser}
              onPreviewDailyPdf={() =>
                setActivePdf(generateDailyReconciliationPdf(reconciliation, store.data.depots))
              }
              onDownloadDailyPdf={() => {
                const res = generateDailyReconciliationPdf(reconciliation, store.data.depots);
                res.doc.save(res.filename);
                URL.revokeObjectURL(res.blobUrl);
              }}
            />
          )}

          {resolvedSection === 'audit' && (
            <AuditLogsView logs={store.data.auditLogs} currentUser={store.currentUser} />
          )}
        </main>
      </div>

      {/* Sandbox Purge Confirmation Dialog */}
      {purgeConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Sandbox Purge"
        >
          <div className="w-full max-w-md rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-red-50 p-2 text-red-700 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-base font-bold text-[#0B192C]">
                  Purge Sandbox Practice Records?
                </h2>
                <p className="text-xs text-[#5A6F8C] leading-relaxed">
                  This will delete all practice Work Plans, Trip Tickets, Fleet Units, and Inventory Logs inside the <strong>Sandbox</strong> database. Your <strong>Live Cloud</strong> database remains untouched.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E6EBF2]">
              <button
                type="button"
                onClick={() => setPurgeConfirmOpen(false)}
                className="rounded-md border border-[#D5DCE6] px-4 py-2 text-xs font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await store.purgeSandboxRecords();
                  setPurgeConfirmOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Confirm Purge Sandbox</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      <PdfPreviewModal pdf={activePdf} onClose={handleClosePdf} />
    </div>
  );
}
