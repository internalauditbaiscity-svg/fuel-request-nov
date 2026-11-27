import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  normalizeEmailToId,
  OperationType,
  signInWithGoogle as firebaseSignInWithGoogle,
  signOutFirebase,
  stripUndefinedFields,
  testFirestoreConnection,
} from '../lib/firebase';
import {
  SEED_AUDIT_LOGS,
  SEED_DEPOTS,
  SEED_INVENTORY_LOGS,
  SEED_PMC_PROJECTS,
  SEED_STORAGE_TANKS,
  SEED_TRIP_TICKETS,
  SEED_USERS,
  SEED_VEHICLES,
  SEED_WORK_PLANS,
} from '../data/seedData';
import {
  AuditLog,
  AuditLogCategory,
  EnvironmentMode,
  FleetVehicle,
  FuelDepot,
  FuelType,
  InventoryLog,
  PmcProject,
  ReportUtilitiesConfig,
  StorageTank,
  SyncQueueItem,
  TripTicket,
  UserAccount,
  UserRole,
  WorkPlan,
} from '../types/fuel';
import {
  computeAggregateDepotCapacitiesFromTanks,
  computeTankSpecifications,
  normalizeStorageTankRecord,
  TANK_FUEL_PRODUCT_STYLES,
} from '../utils/tankRegistryEngine';
import {
  authenticateLocalUserCredentials,
  buildCredentialLoginPayloadsFromUser,
  buildInvitePayloadFromUser,
  canAccessDepartmentRecord,
  canAccessDepotLedgerRegister,
  canManageReportUtilities,
  canRegisterFleetUnit,
  canUserEditRecords,
  canUserEditWorkPlanRecord,
  canUserRequestSingleTrip,
  classifyAuditLogCategory,
  computeAggregateDepotWacFromTanks,
  computeCredentialProofId,
  computeSingleDispenseOutcome,
  computeWeightedAverageCostAfterDelivery,
  createDefaultReportUtilitiesConfig,
  deduplicateUsersByEmail,
  evaluateTabletopApproval,
  evaluateWorkPlanWeekStart,
  findMatchingRbacUsersForSandboxPreview,
  generateNextGsoTransactionCode,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getDefaultNavSection,
  getLocalIsoDate,
  getRemainingInactivityMs,
  getSandboxPreviewDepartmentsForRole,
  getWorkPlanDisplayLabel,
  hasCityWideAccess,
  hashPassword,
  hasValidPumpReadingProof,
  INACTIVITY_TIMEOUT_MS,
  isSessionExpired,
  matchGsoHeadVerificationCode,
  MAX_TICKETS_PER_WORKPLAN,
  mergeClaimedUserProfile,
  normalizePmcProject,
  normalizeReportUtilitiesConfig,
  normalizeUsernameInput,
  parsePersistedSession,
  PersistedSessionState,
  prepareFirestoreRecordPayload,
  reconcileCollectionRecords,
  resolveActiveUserFromRegistry,
  resolveDefaultSandboxDepartmentForRole,
  resolveDepotTransactionVerification,
  resolveEffectiveEnvironmentAfterGoogleAuth,
  resolvePrevailingWeightedAverageCost,
  resolveSandboxPreviewUser,
  sanitizeAuditDetails,
  USER_OFFICE_DEPARTMENT,
  validateGsoHeadVerificationCode,
} from '../utils/fuelEngine';

interface LocalSnapshotState {
  users: UserAccount[];
  depots: FuelDepot[];
  storageTanks: StorageTank[];
  vehicles: FleetVehicle[];
  pmcProjects: PmcProject[];
  workPlans: WorkPlan[];
  tripTickets: TripTicket[];
  inventoryLogs: InventoryLog[];
  auditLogs: AuditLog[];
  reportUtilities: ReportUtilitiesConfig;
}

const SANDBOX_STORAGE_KEY = 'bais_fuel_sandbox_v3';
const LIVE_CACHE_STORAGE_KEY = 'bais_fuel_live_cache_v2';
const SYNC_QUEUE_KEY = 'bais_fuel_sync_queue_v2';
export const AUTH_SESSION_STORAGE_KEY = 'bais_fuel_auth_session_v1';
const AUTH_PROFILE_CACHE_KEY = 'bais_fuel_auth_profile_v1';

function readPersistedSessionRaw(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(AUTH_SESSION_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

function writePersistedSession(session: PersistedSessionState) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function writeCachedAuthProfile(user: UserAccount) {
  try {
    if (typeof localStorage !== 'undefined') {
      const safeProfile: UserAccount = { ...user, passwordHash: undefined };
      localStorage.setItem(AUTH_PROFILE_CACHE_KEY, JSON.stringify(safeProfile));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function readCachedAuthProfile(): UserAccount | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(AUTH_PROFILE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserAccount) : null;
  } catch {
    return null;
  }
}

function clearPersistedSessionStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      localStorage.removeItem(AUTH_PROFILE_CACHE_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

function getInitialSeedState(): LocalSnapshotState {
  return {
    users: [...SEED_USERS],
    depots: [...SEED_DEPOTS],
    storageTanks: [...SEED_STORAGE_TANKS],
    vehicles: [...SEED_VEHICLES],
    pmcProjects: [...SEED_PMC_PROJECTS],
    workPlans: [...SEED_WORK_PLANS],
    tripTickets: [...SEED_TRIP_TICKETS],
    inventoryLogs: [...SEED_INVENTORY_LOGS],
    auditLogs: [...SEED_AUDIT_LOGS],
    reportUtilities: createDefaultReportUtilitiesConfig(),
  };
}

function loadLocalState(key: string): LocalSnapshotState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return getInitialSeedState();
    const parsed = JSON.parse(raw) as Partial<LocalSnapshotState>;
    const missingStorageTanks = parsed.storageTanks === undefined;
    let depots = parsed.depots ?? [];
    if (missingStorageTanks && key === SANDBOX_STORAGE_KEY) {
      const existingIds = new Set(depots.map((d) => d.id));
      const enriched = depots.map((d) => {
        const seedMatch = SEED_DEPOTS.find((s) => s.id === d.id);
        return seedMatch
          ? {
              ...seedMatch,
              ...d,
              siteCode: d.siteCode || seedMatch.siteCode,
              coordinates: d.coordinates || seedMatch.coordinates,
              permitNumber: d.permitNumber || seedMatch.permitNumber,
              calibrationExpiryDate: d.calibrationExpiryDate || seedMatch.calibrationExpiryDate,
              stationManager: d.stationManager || seedMatch.stationManager,
            }
          : d;
      });
      const extraSeedDepots = SEED_DEPOTS.filter((s) => !existingIds.has(s.id));
      depots = [...enriched, ...extraSeedDepots];
    }
    return {
      users: parsed.users && parsed.users.length > 0 ? parsed.users : [...SEED_USERS],
      depots,
      storageTanks:
        parsed.storageTanks !== undefined
          ? parsed.storageTanks.map((t) => normalizeStorageTankRecord(t))
          : key === SANDBOX_STORAGE_KEY
            ? [...SEED_STORAGE_TANKS]
            : [],
      vehicles: parsed.vehicles ?? [],
      pmcProjects:
        parsed.pmcProjects !== undefined
          ? parsed.pmcProjects.map((p) => normalizePmcProject(p))
          : key === SANDBOX_STORAGE_KEY
            ? [...SEED_PMC_PROJECTS]
            : [],
      workPlans: parsed.workPlans ?? [],
      tripTickets: parsed.tripTickets ?? [],
      inventoryLogs: parsed.inventoryLogs ?? [],
      auditLogs: parsed.auditLogs ?? [],
      reportUtilities: normalizeReportUtilitiesConfig(parsed.reportUtilities),
    };
  } catch {
    return getInitialSeedState();
  }
}

function saveLocalState(key: string, state: LocalSnapshotState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function loadSyncQueue(): SyncQueueItem[] {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as SyncQueueItem[]) : [];
  } catch {
    return [];
  }
}

function saveSyncQueue(items: SyncQueueItem[]) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const SEED_DEPOT_TS = new Map(SEED_DEPOTS.map((d) => [d.id, d.updatedAt]));
const SEED_STORAGE_TANK_TS = new Map(SEED_STORAGE_TANKS.map((t) => [t.id, t.updatedAt]));
const SEED_VEHICLE_TS = new Map(SEED_VEHICLES.map((v) => [v.id, v.updatedAt]));
const SEED_PMC_PROJECT_TS = new Map(SEED_PMC_PROJECTS.map((p) => [p.id, p.updatedAt]));
const SEED_WORKPLAN_TS = new Map(SEED_WORK_PLANS.map((w) => [w.id, w.updatedAt]));
const SEED_TICKET_TS = new Map(SEED_TRIP_TICKETS.map((t) => [t.id, t.updatedAt]));
const SEED_INV_TS = new Map(SEED_INVENTORY_LOGS.map((l) => [l.id, l.createdAt]));
const SEED_AUDIT_TS = new Map(SEED_AUDIT_LOGS.map((a) => [a.id, a.createdAt]));
const SEED_USER_TS = new Map(SEED_USERS.map((u) => [u.uid, u.updatedAt]));

function resolveInitialBootAuth(): {
  user: UserAccount | null;
  envMode: EnvironmentMode;
  role: UserRole;
  dept: string;
  section?: string;
  expired: boolean;
} {
  const initialSandbox = loadLocalState(SANDBOX_STORAGE_KEY);
  const initialLive = loadLocalState(LIVE_CACHE_STORAGE_KEY);

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const autoUser = SEED_USERS[0];
      writeCachedAuthProfile(autoUser);
      writePersistedSession({
        uid: autoUser.uid,
        envMode: 'sandbox',
        sandboxActiveRole: autoUser.role,
        sandboxActiveDepartment: autoUser.department,
        activeSection: 'dashboard',
        lastActivityAt: Date.now(),
      });
      return {
        user: autoUser,
        envMode: 'sandbox',
        role: autoUser.role,
        dept: autoUser.department,
        section: 'dashboard',
        expired: false,
      };
    }
  }

  const now = Date.now();
  const parsed = parsePersistedSession(readPersistedSessionRaw(), now, INACTIVITY_TIMEOUT_MS);
  if (parsed.expired) {
    clearPersistedSessionStorage();
    return {
      user: null,
      envMode: 'sandbox',
      role: 'admin',
      dept: 'Internal Audit Service',
      expired: true,
    };
  }

  if (parsed.session) {
    const cachedProfile = readCachedAuthProfile();
    const pool = [
      ...initialSandbox.users,
      ...initialLive.users,
      ...SEED_USERS,
      ...(cachedProfile ? [cachedProfile] : []),
    ];
    const matched = pool.find((u) => u.uid === parsed.session?.uid && u.active);
    if (matched) {
      writePersistedSession({
        ...parsed.session,
        lastActivityAt: now,
      });
      return {
        user: matched,
        envMode: parsed.session.envMode,
        role: parsed.session.sandboxActiveRole,
        dept: parsed.session.sandboxActiveDepartment,
        section: parsed.session.activeSection,
        expired: false,
      };
    }
  }

  return {
    user: null,
    envMode: 'sandbox',
    role: 'admin',
    dept: 'Internal Audit Service',
    expired: false,
  };
}

export function useFuelStore() {
  const [bootAuth] = useState(() => resolveInitialBootAuth());
  const [envMode, setEnvMode] = useState<EnvironmentMode>(bootAuth.envMode);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Startup Authentication Gate state (restored across refreshes within 10-min activity window)
  const [authenticatedUser, setAuthenticatedUser] = useState<UserAccount | null>(bootAuth.user);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(
    bootAuth.expired
      ? 'Your session expired after 10 minutes of inactivity. Please sign in again.'
      : null
  );

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [firestoreReachable, setFirestoreReachable] = useState<'online' | 'offline' | 'error'>('online');

  const [sandboxState, setSandboxState] = useState<LocalSnapshotState>(() =>
    loadLocalState(SANDBOX_STORAGE_KEY)
  );
  const [liveState, setLiveState] = useState<LocalSnapshotState>(() =>
    loadLocalState(LIVE_CACHE_STORAGE_KEY)
  );
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(() => loadSyncQueue());

  // Role switcher for Admin Sandbox practice & testing different LGU Bais departmental roles
  const [sandboxActiveRole, setSandboxActiveRoleState] = useState<UserRole>(bootAuth.role);
  const [sandboxActiveDepartment, setSandboxActiveDepartmentState] = useState<string>(bootAuth.dept);
  const [selectedSandboxUserUid, setSelectedSandboxUserUid] = useState<string | null>(null);
  const [liveUserProfile, setLiveUserProfile] = useState<UserAccount | null>(
    bootAuth.envMode === 'live' ? bootAuth.user : null
  );
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);

  const googleSignInInitiatedRef = useRef<boolean>(false);
  const preserveEnvOnAuthRef = useRef<EnvironmentMode | null>(null);
  const sandboxStateRef = useRef<LocalSnapshotState>(sandboxState);
  const liveStateRef = useRef<LocalSnapshotState>(liveState);
  const syncQueueRef = useRef<SyncQueueItem[]>(syncQueue);
  const activeSectionRef = useRef<string>(bootAuth.section || 'dashboard');
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastActivityWriteRef = useRef<number>(Date.now());

  sandboxStateRef.current = sandboxState;
  liveStateRef.current = liveState;
  syncQueueRef.current = syncQueue;

  const effectiveOnline = isOnline && !simulatedOffline;

  // Boot Firestore connection test as required by firebase-integration-rpc skill
  useEffect(() => {
    testFirestoreConnection().then(setFirestoreReachable);
  }, []);

  // Online / Offline listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persist sandbox & live state locally
  useEffect(() => {
    saveLocalState(SANDBOX_STORAGE_KEY, sandboxState);
  }, [sandboxState]);

  useEffect(() => {
    saveLocalState(LIVE_CACHE_STORAGE_KEY, liveState);
  }, [liveState]);

  useEffect(() => {
    saveSyncQueue(syncQueue);
  }, [syncQueue]);

  // Firebase Auth listener + Admin bootstrap + Invited/Different-Gmail profile resolution
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let freshGoogleAttempt = false;
      if (user) {
        freshGoogleAttempt = googleSignInInitiatedRef.current;
        googleSignInInitiatedRef.current = false;

        if (!freshGoogleAttempt) {
          const parsed = parsePersistedSession(
            readPersistedSessionRaw(),
            Date.now(),
            INACTIVITY_TIMEOUT_MS
          );
          if (parsed.expired) {
            clearPersistedSessionStorage();
            setFirebaseUser(null);
            setLiveUserProfile(null);
            setAuthenticatedUser(null);
            setSessionExpiredNotice(
              'Your session expired after 10 minutes of inactivity. Please sign in again.'
            );
            await signOutFirebase().catch(() => {});
            setAuthReady(true);
            return;
          }
        }
      }

      setFirebaseUser(user);
      if (user) {
        if (!user.email || !user.emailVerified) {
          if (freshGoogleAttempt) {
            const blockedLog: AuditLog = {
              id: makeId('aud'),
              actorUid: user.uid,
              actorEmail: (user.email || 'unverified@unknown').trim().toLowerCase().slice(0, 254),
              actorName: (user.displayName || 'Unverified Google Account').slice(0, 120),
              actorRole: 'unauthenticated',
              category: 'credential',
              environment: 'sandbox',
              action: 'GOOGLE_SSO_LOGIN_BLOCKED',
              entityType: 'session',
              entityId: user.uid,
              summary: 'Blocked Google SSO sign-in because the account email is unverified.',
              details: 'Method: Google SSO | Outcome: Blocked (Unverified Email)',
              createdAt: new Date().toISOString(),
            };
            setSandboxState((prev) => {
              const next = { ...prev, auditLogs: [blockedLog, ...prev.auditLogs] };
              saveLocalState(SANDBOX_STORAGE_KEY, next);
              return next;
            });
          }
          setGoogleAuthError(
            'Your Google account email must be verified before accessing Live Cloud.'
          );
          clearPersistedSessionStorage();
          setLiveUserProfile(null);
          setAuthenticatedUser(null);
          await signOutFirebase().catch(() => {});
          setAuthReady(true);
          return;
        }

        const authEmail = user.email.trim().toLowerCase();
        const emailId = normalizeEmailToId(authEmail);
        const now = new Date().toISOString();

        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);
          let resolvedProfile: UserAccount | null = null;

          if (userSnap.exists()) {
            const existingProfile = userSnap.data() as UserAccount;
            if (!existingProfile.active) {
              if (freshGoogleAttempt) {
                const suspLog: AuditLog = {
                  id: makeId('aud'),
                  actorUid: user.uid,
                  actorEmail: authEmail,
                  actorName: existingProfile.displayName,
                  actorRole: existingProfile.role,
                  department: existingProfile.department,
                  category: 'credential',
                  environment: 'live',
                  action: 'GOOGLE_SSO_LOGIN_BLOCKED',
                  entityType: 'session',
                  entityId: user.uid,
                  summary: `Blocked Google SSO sign-in for suspended account ${authEmail}.`,
                  details: `Method: Google SSO | Role: ${existingProfile.role} | Outcome: Blocked (Suspended Account)`,
                  createdAt: now,
                };
                setSandboxState((prev) => {
                  const next = { ...prev, auditLogs: [suspLog, ...prev.auditLogs] };
                  saveLocalState(SANDBOX_STORAGE_KEY, next);
                  return next;
                });
              }
              setGoogleAuthError('This user account is suspended. Contact your Administrator.');
              clearPersistedSessionStorage();
              setLiveUserProfile(null);
              setAuthenticatedUser(null);
              await signOutFirebase().catch(() => {});
              setAuthReady(true);
              return;
            }
            resolvedProfile = existingProfile;
          } else if (authEmail === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
            await setDoc(doc(db, 'admins', user.uid), {
              uid: user.uid,
              email: authEmail,
              grantedAt: now,
            });
            resolvedProfile = mergeClaimedUserProfile({
              uid: user.uid,
              email: authEmail,
              displayName: user.displayName,
              isBootstrappedAdmin: true,
              nowIso: now,
            });
            await setDoc(userDocRef, stripUndefinedFields(resolvedProfile as unknown as Record<string, unknown>));
          } else {
            let sourceRecord: Partial<UserAccount> | null = null;

            if (emailId) {
              try {
                const inviteSnap = await getDoc(doc(db, 'invites', emailId));
                if (inviteSnap.exists()) {
                  sourceRecord = inviteSnap.data() as Partial<UserAccount>;
                }
              } catch {
                // Continue checking legacy user records if invite doc does not exist
              }

              if (!sourceRecord) {
                try {
                  const legacySnap = await getDoc(doc(db, 'users', emailId));
                  if (legacySnap.exists()) {
                    sourceRecord = legacySnap.data() as UserAccount;
                  }
                } catch {
                  // Continue to email query fallback
                }
              }
            }

            if (!sourceRecord) {
              try {
                const q = query(collection(db, 'users'), where('email', '==', authEmail));
                const snap = await getDocs(q);
                if (!snap.empty) {
                  sourceRecord = snap.docs[0].data() as UserAccount;
                }
              } catch {
                // Proceed to unprivileged requester self-registration
              }
            }

            if (sourceRecord && sourceRecord.active === false) {
              setGoogleAuthError('This user account is suspended. Contact your Administrator.');
              clearPersistedSessionStorage();
              setLiveUserProfile(null);
              setAuthenticatedUser(null);
              await signOutFirebase().catch(() => {});
              setAuthReady(true);
              return;
            }

            resolvedProfile = mergeClaimedUserProfile({
              uid: user.uid,
              email: authEmail,
              displayName: user.displayName,
              sourceProfile: sourceRecord,
              nowIso: now,
            });

            await setDoc(
              userDocRef,
              stripUndefinedFields(resolvedProfile as unknown as Record<string, unknown>)
            );

            if (resolvedProfile.role === 'admin') {
              await setDoc(doc(db, 'admins', user.uid), {
                uid: user.uid,
                email: authEmail,
                grantedAt: now,
              });
            }
          }

          if (resolvedProfile) {
            const nowMs = Date.now();
            const defaultSection = getDefaultNavSection(resolvedProfile.role);
            lastActivityAtRef.current = nowMs;
            lastActivityWriteRef.current = nowMs;
            if (!activeSectionRef.current) {
              activeSectionRef.current = defaultSection;
            }
            const explicitPreserve = preserveEnvOnAuthRef.current;
            preserveEnvOnAuthRef.current = null;
            const storedSession = parsePersistedSession(
              readPersistedSessionRaw(),
              nowMs,
              INACTIVITY_TIMEOUT_MS
            ).session;
            const preservedEnv =
              explicitPreserve ??
              (storedSession && storedSession.uid === resolvedProfile.uid
                ? storedSession.envMode
                : null);
            const resolvedEnvMode = resolveEffectiveEnvironmentAfterGoogleAuth({
              preserveEnvMode: preservedEnv,
              user: resolvedProfile,
            });

            setGoogleAuthError(null);
            setSessionExpiredNotice(null);
            setLiveUserProfile(resolvedProfile);
            setAuthenticatedUser(resolvedProfile);
            setEnvMode(resolvedEnvMode);
            const upsertProfile = (prev: LocalSnapshotState): LocalSnapshotState => {
              const others = prev.users.filter((u) => u.uid !== resolvedProfile!.uid);
              return { ...prev, users: [resolvedProfile!, ...others] };
            };
            setLiveState((prev) => {
              const next = upsertProfile(prev);
              saveLocalState(LIVE_CACHE_STORAGE_KEY, next);
              return next;
            });
            setSandboxState((prev) => {
              const next = upsertProfile(prev);
              saveLocalState(SANDBOX_STORAGE_KEY, next);
              return next;
            });
            writeCachedAuthProfile(resolvedProfile);
            writePersistedSession({
              uid: resolvedProfile.uid,
              envMode: resolvedEnvMode,
              sandboxActiveRole: resolvedProfile.role,
              sandboxActiveDepartment: resolvedProfile.department,
              activeSection: activeSectionRef.current || defaultSection,
              lastActivityAt: nowMs,
            });

            if (freshGoogleAttempt) {
              const ssoLog: AuditLog = {
                id: makeId('aud'),
                actorUid: user.uid,
                actorEmail: resolvedProfile.email,
                actorName: resolvedProfile.displayName,
                actorRole: resolvedProfile.role,
                department: resolvedProfile.department,
                category: 'credential',
                environment: resolvedEnvMode,
                action: 'GOOGLE_SSO_LOGIN_SUCCESS',
                entityType: 'session',
                entityId: resolvedProfile.uid,
                summary: `Google SSO sign-in succeeded for ${resolvedProfile.displayName} (${resolvedProfile.email}) in ${resolvedEnvMode.toUpperCase()} mode.`,
                details: `Method: Google SSO | Role: ${resolvedProfile.role} | Office: ${resolvedProfile.department} | Environment: ${resolvedEnvMode.toUpperCase()}`,
                createdAt: now,
              };
              const appendSsoLog = (prev: LocalSnapshotState): LocalSnapshotState => ({
                ...prev,
                auditLogs: [ssoLog, ...prev.auditLogs],
              });
              if (resolvedEnvMode === 'live') {
                setLiveState((prev) => {
                  const next = appendSsoLog(prev);
                  saveLocalState(LIVE_CACHE_STORAGE_KEY, next);
                  return next;
                });
              } else {
                setSandboxState((prev) => {
                  const next = appendSsoLog(prev);
                  saveLocalState(SANDBOX_STORAGE_KEY, next);
                  return next;
                });
              }
              await setDoc(
                doc(db, `environments/${resolvedEnvMode}/auditLogs`, ssoLog.id),
                prepareFirestoreRecordPayload(ssoLog as unknown as Record<string, unknown>, user.uid, {
                  isCreate: true,
                  collection: 'auditLogs',
                })
              ).catch(() => {});
            }
          }
        } catch (err) {
          console.error('Google Sign-In profile resolution failed:', err);
          setGoogleAuthError(
            err instanceof Error
              ? err.message
              : 'Unable to verify your Google account permissions in Live Cloud.'
          );
          clearPersistedSessionStorage();
          setLiveUserProfile(null);
          setAuthenticatedUser(null);
          await signOutFirebase().catch(() => {});
        }
      } else {
        setLiveUserProfile(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const syncCredentialLoginDocs = useCallback(
    async (
      user: UserAccount,
      actorUid: string,
      previousUser?: UserAccount | null
    ): Promise<number> => {
      let written = 0;
      const payloads = buildCredentialLoginPayloadsFromUser(user, actorUid);
      const nextProofIds = new Set(payloads.map((p) => p.id));

      if (previousUser && previousUser.passwordHash) {
        const oldPayloads = buildCredentialLoginPayloadsFromUser(previousUser, actorUid);
        for (const oldPayload of oldPayloads) {
          if (!nextProofIds.has(oldPayload.id)) {
            await deleteDoc(doc(db, 'credentialLogins', oldPayload.id)).catch(() => {});
          }
        }
      }

      for (const credPayload of payloads) {
        await setDoc(doc(db, 'credentialLogins', credPayload.id), credPayload, { merge: true });
        written += 1;
      }
      return written;
    },
    []
  );

  const syncUserAndInviteDoc = useCallback(
    async (
      user: UserAccount,
      actorUid: string,
      isCreate: boolean,
      previousUser?: UserAccount | null
    ) => {
      const sanitizedUser = prepareFirestoreRecordPayload(
        user as unknown as Record<string, unknown>,
        actorUid,
        { isCreate, collection: 'users' }
      );
      await setDoc(doc(db, 'users', user.uid), sanitizedUser, { merge: true });
      const invitePayload = buildInvitePayloadFromUser(user, actorUid);
      if (invitePayload && typeof invitePayload.id === 'string') {
        await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
      }
      await syncCredentialLoginDocs(user, actorUid, previousUser);
    },
    [syncCredentialLoginDocs]
  );

  // Flush offline/unauthenticated sync queue automatically when online & authenticated
  const flushSyncQueue = useCallback(async () => {
    const currentQueue = syncQueueRef.current;
    if (!effectiveOnline || !firebaseUser || currentQueue.length === 0) return;

    const remaining: SyncQueueItem[] = [];
    let syncedCount = 0;

    for (const item of currentQueue) {
      const targetEnv: EnvironmentMode = item.envMode ?? 'live';
      const colPath =
        item.collection === 'users' ? 'users' : `environments/${targetEnv}/${item.collection}`;
      const docRef = doc(db, colPath, item.docId);
      try {
        if (item.collection === 'settings' && item.operation === 'set' && item.payload) {
          const normalizedSettings = normalizeReportUtilitiesConfig(
            item.payload as Partial<ReportUtilitiesConfig>
          );
          await setDoc(docRef, normalizedSettings);
        } else if (item.operation === 'set' && item.payload) {
          const payload = prepareFirestoreRecordPayload(item.payload, firebaseUser.uid, {
            isCreate: true,
            collection: item.collection,
          });
          await setDoc(docRef, payload);
          if (item.collection === 'users') {
            const userObj = item.payload as unknown as UserAccount;
            const invitePayload = buildInvitePayloadFromUser(userObj, firebaseUser.uid);
            if (invitePayload && typeof invitePayload.id === 'string') {
              await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
            }
            await syncCredentialLoginDocs(userObj, firebaseUser.uid);
          }
        } else if (item.operation === 'update' && item.payload && item.collection !== 'settings') {
          const payload = prepareFirestoreRecordPayload(item.payload, firebaseUser.uid, {
            isCreate: false,
            collection: item.collection,
          });
          try {
            await updateDoc(docRef, payload);
          } catch (updateErr) {
            const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
            if (msg.includes('No document to update') || msg.includes('not-found')) {
              const sourceState =
                targetEnv === 'sandbox' ? sandboxStateRef.current : liveStateRef.current;
              const list = sourceState[item.collection] as unknown as Array<
                Record<string, unknown> & { id?: string; uid?: string }
              >;
              const matchKey = item.collection === 'users' ? 'uid' : 'id';
              const fullLocal = list.find((entry) => entry[matchKey] === item.docId);
              if (fullLocal) {
                const fullPayload = prepareFirestoreRecordPayload(
                  { ...fullLocal, ...item.payload },
                  firebaseUser.uid,
                  { isCreate: true, collection: item.collection }
                );
                await setDoc(docRef, fullPayload);
              } else {
                throw updateErr;
              }
            } else {
              throw updateErr;
            }
          }
          if (item.collection === 'users') {
            const mergedUser =
              liveStateRef.current.users.find((u) => u.uid === item.docId) ??
              sandboxStateRef.current.users.find((u) => u.uid === item.docId);
            if (mergedUser) {
              const invitePayload = buildInvitePayloadFromUser(mergedUser, firebaseUser.uid);
              if (invitePayload && typeof invitePayload.id === 'string') {
                await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
              }
              await syncCredentialLoginDocs(mergedUser, firebaseUser.uid);
            }
          }
        } else if (item.operation === 'delete') {
          await deleteDoc(docRef);
        }
        syncedCount += 1;
      } catch (err) {
        console.error('Sync queue item failed:', item, err);
        remaining.push(item);
      }
    }

    setSyncQueue(remaining);
    if (syncedCount > 0) {
      setSyncNotice(`Synced ${syncedCount} queued record${syncedCount > 1 ? 's' : ''} to Firebase Cloud.`);
      setTimeout(() => setSyncNotice(null), 4000);
    }
  }, [effectiveOnline, firebaseUser, syncCredentialLoginDocs]);

  // Reconcile local AI Studio records (Sandbox/Live transactions + Users) with Firestore
  const reconcileEnvironmentToCloud = useCallback(
    async (targetEnv: EnvironmentMode, fbUser: FirebaseUser, profile: UserAccount) => {
      if (!effectiveOnline) return 0;

      const isElevatedAdmin =
        profile.role === 'admin' ||
        fbUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
      if (!isElevatedAdmin) return 0;

      const envPrefix = `environments/${targetEnv}`;
      const localSnapshot =
        targetEnv === 'sandbox' ? sandboxStateRef.current : liveStateRef.current;

      const [
        depotsSnap,
        storageTanksSnap,
        vehiclesSnap,
        pmcProjectsSnap,
        plansSnap,
        ticketsSnap,
        invSnap,
        auditSnap,
        usersSnap,
        credLoginsSnap,
      ] = await Promise.all([
        getDocs(collection(db, `${envPrefix}/depots`)),
        getDocs(collection(db, `${envPrefix}/storageTanks`)).catch(() => null),
        getDocs(collection(db, `${envPrefix}/vehicles`)),
        getDocs(collection(db, `${envPrefix}/pmcProjects`)).catch(() => null),
        getDocs(collection(db, `${envPrefix}/workPlans`)),
        getDocs(collection(db, `${envPrefix}/tripTickets`)),
        getDocs(collection(db, `${envPrefix}/inventoryLogs`)),
        getDocs(collection(db, `${envPrefix}/auditLogs`)),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'credentialLogins')).catch(() => null),
      ]);

      const cloudDepots = depotsSnap.docs.map((d) => d.data() as FuelDepot);
      const cloudStorageTanks = storageTanksSnap
        ? storageTanksSnap.docs.map((d) => normalizeStorageTankRecord(d.data() as StorageTank))
        : [];
      const cloudVehicles = vehiclesSnap.docs.map((d) => d.data() as FleetVehicle);
      const cloudPmcProjects = pmcProjectsSnap
        ? pmcProjectsSnap.docs.map((d) => d.data() as PmcProject)
        : [];
      const cloudPlans = plansSnap.docs.map((d) => d.data() as WorkPlan);
      const cloudTickets = ticketsSnap.docs.map((d) => d.data() as TripTicket);
      const cloudInv = invSnap.docs.map((d) => d.data() as InventoryLog);
      const cloudAudit = auditSnap.docs.map((d) => d.data() as AuditLog);
      const cloudUsers = usersSnap.docs.map((d) => d.data() as UserAccount);
      const existingCredLogins = new Map<string, { active?: boolean; updatedAt?: string }>();
      if (credLoginsSnap) {
        for (const d of credLoginsSnap.docs) {
          const data = d.data() as { active?: boolean; updatedAt?: string };
          existingCredLogins.set(d.id, data);
        }
      }

      const sandboxEmpty =
        targetEnv === 'sandbox' &&
        cloudDepots.length === 0 &&
        cloudStorageTanks.length === 0 &&
        cloudVehicles.length === 0 &&
        cloudPmcProjects.length === 0 &&
        cloudPlans.length === 0 &&
        cloudTickets.length === 0 &&
        cloudAudit.length === 0;

      let cloudPurgeAt: string | null = null;
      if (targetEnv === 'sandbox') {
        for (const log of cloudAudit) {
          if (log.action === 'SANDBOX_PURGED' && (!cloudPurgeAt || log.createdAt > cloudPurgeAt)) {
            cloudPurgeAt = log.createdAt;
          }
        }
      }

      const useSeedFilter = targetEnv === 'live' || !sandboxEmpty;

      const depotsRec = reconcileCollectionRecords({
        localItems: localSnapshot.depots,
        cloudItems: cloudDepots,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_DEPOT_TS : undefined,
      });
      const storageTanksRec = reconcileCollectionRecords({
        localItems: localSnapshot.storageTanks ?? [],
        cloudItems: cloudStorageTanks,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_STORAGE_TANK_TS : undefined,
      });
      const vehiclesRec = reconcileCollectionRecords({
        localItems: localSnapshot.vehicles,
        cloudItems: cloudVehicles,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_VEHICLE_TS : undefined,
      });
      const pmcProjectsRec = reconcileCollectionRecords({
        localItems: localSnapshot.pmcProjects ?? [],
        cloudItems: cloudPmcProjects,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_PMC_PROJECT_TS : undefined,
      });
      const plansRec = reconcileCollectionRecords({
        localItems: localSnapshot.workPlans,
        cloudItems: cloudPlans,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_WORKPLAN_TS : undefined,
      });
      const ticketsRec = reconcileCollectionRecords({
        localItems: localSnapshot.tripTickets,
        cloudItems: cloudTickets,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_TICKET_TS : undefined,
      });
      const invRec = reconcileCollectionRecords({
        localItems: localSnapshot.inventoryLogs,
        cloudItems: cloudInv,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_INV_TS : undefined,
      });
      const auditRec = reconcileCollectionRecords({
        localItems: localSnapshot.auditLogs,
        cloudItems: cloudAudit,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_AUDIT_TS : undefined,
      });

      const localUsersCombined = deduplicateUsersByEmail([
        ...localSnapshot.users,
        ...liveStateRef.current.users,
        ...sandboxStateRef.current.users,
      ]);
      const cloudEmailsSet = new Set(
        cloudUsers.map((u) => u.email.trim().toLowerCase()).filter(Boolean)
      );
      const usersToConsider = localUsersCombined.filter((u) => {
        const emailLower = u.email.trim().toLowerCase();
        const isPlaceholder = u.uid === normalizeEmailToId(emailLower);
        if (isPlaceholder && cloudEmailsSet.has(emailLower)) {
          return cloudUsers.some((cu) => cu.uid === u.uid);
        }
        return true;
      });

      const usersSeedFilter = cloudUsers.length > 1 ? SEED_USER_TS : undefined;
      const usersRec = reconcileCollectionRecords({
        localItems: usersToConsider,
        cloudItems: cloudUsers,
        keyField: 'uid',
        seedUpdatedAtByKey: usersSeedFilter,
      });

      let pushedCount = 0;

      // 1. Sync Users, Invites & CredentialLogin proof docs first
      for (const usr of usersRec.toCreate) {
        try {
          await syncUserAndInviteDoc(usr, fbUser.uid, true);
          pushedCount += 1;
        } catch (err) {
          console.warn('User create sync skipped:', usr.uid, err);
        }
      }
      for (const usr of usersRec.toUpdate) {
        try {
          const cloudExisting = cloudUsers.find((cu) => cu.uid === usr.uid);
          const mergedUsr: UserAccount = cloudExisting
            ? { ...usr, createdAt: cloudExisting.createdAt }
            : usr;
          await syncUserAndInviteDoc(mergedUsr, fbUser.uid, false, cloudExisting);
          pushedCount += 1;
        } catch (err) {
          console.warn('User update sync skipped:', usr.uid, err);
        }
      }

      const mergedUsers = deduplicateUsersByEmail(usersRec.merged);

      // Backfill any existing Firestore /users missing /credentialLogins/{proofId} docs
      for (const usr of mergedUsers) {
        if (!usr.passwordHash) continue;
        const expectedPayloads = buildCredentialLoginPayloadsFromUser(usr, fbUser.uid);
        for (const credPayload of expectedPayloads) {
          const existingCred = existingCredLogins.get(credPayload.id);
          const needsWrite =
            !existingCred ||
            existingCred.active !== (credPayload.active as boolean) ||
            (typeof credPayload.updatedAt === 'string' &&
              (!existingCred.updatedAt || credPayload.updatedAt > existingCred.updatedAt));
          if (needsWrite) {
            try {
              await setDoc(doc(db, 'credentialLogins', credPayload.id), credPayload, {
                merge: true,
              });
              pushedCount += 1;
            } catch (err) {
              console.warn('CredentialLogin backfill skipped:', usr.uid, err);
            }
          }
        }
      }

      // 2. Sync Depots & Vehicles before dependent Plans, Tickets & Inventory Logs
      const pushEnvItems = async <T extends { id: string }>(
        colName: string,
        items: T[],
        isCreate: boolean
      ) => {
        for (const item of items) {
          try {
            const ref = doc(db, `${envPrefix}/${colName}`, item.id);
            const payload = prepareFirestoreRecordPayload(
              item as unknown as Record<string, unknown>,
              fbUser.uid,
              { isCreate, collection: colName }
            );
            if (isCreate) {
              await setDoc(ref, payload);
            } else {
              await setDoc(ref, payload, { merge: true });
            }
            pushedCount += 1;
          } catch (err) {
            console.warn(`Reconcile ${envPrefix}/${colName}/${item.id} skipped:`, err);
          }
        }
      };

      await pushEnvItems('depots', depotsRec.toCreate, true);
      await pushEnvItems('depots', depotsRec.toUpdate, false);
      await pushEnvItems('storageTanks', storageTanksRec.toCreate, true);
      await pushEnvItems('storageTanks', storageTanksRec.toUpdate, false);
      await pushEnvItems('vehicles', vehiclesRec.toCreate, true);
      await pushEnvItems('vehicles', vehiclesRec.toUpdate, false);
      await pushEnvItems('pmcProjects', pmcProjectsRec.toCreate, true);
      await pushEnvItems('pmcProjects', pmcProjectsRec.toUpdate, false);
      await pushEnvItems('workPlans', plansRec.toCreate, true);
      await pushEnvItems('workPlans', plansRec.toUpdate, false);
      await pushEnvItems('tripTickets', ticketsRec.toCreate, true);
      await pushEnvItems('tripTickets', ticketsRec.toUpdate, false);
      await pushEnvItems('inventoryLogs', invRec.toCreate, true);
      await pushEnvItems('inventoryLogs', invRec.toUpdate, false);
      await pushEnvItems('auditLogs', auditRec.toCreate, true);

      let mergedReportUtilities = normalizeReportUtilitiesConfig(localSnapshot.reportUtilities);
      try {
        const settingsRef = doc(db, `${envPrefix}/settings`, 'report_utilities');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          const cloudSettings = normalizeReportUtilitiesConfig(
            settingsSnap.data() as Partial<ReportUtilitiesConfig>
          );
          if (
            mergedReportUtilities.updatedAt &&
            (!cloudSettings.updatedAt || mergedReportUtilities.updatedAt > cloudSettings.updatedAt)
          ) {
            await setDoc(settingsRef, mergedReportUtilities);
            pushedCount += 1;
          } else {
            mergedReportUtilities = cloudSettings;
          }
        } else if (mergedReportUtilities.updatedAt) {
          await setDoc(settingsRef, mergedReportUtilities);
          pushedCount += 1;
        }
      } catch (err) {
        console.warn(`Reconcile ${envPrefix}/settings/report_utilities skipped:`, err);
      }

      const nextState: LocalSnapshotState = {
        users: mergedUsers,
        depots: depotsRec.merged,
        storageTanks: storageTanksRec.merged.map((t) => normalizeStorageTankRecord(t)),
        vehicles: vehiclesRec.merged,
        pmcProjects: pmcProjectsRec.merged,
        workPlans: plansRec.merged,
        tripTickets: ticketsRec.merged,
        inventoryLogs: invRec.merged,
        auditLogs: auditRec.merged,
        reportUtilities: mergedReportUtilities,
      };

      if (targetEnv === 'sandbox') {
        setSandboxState(nextState);
        setLiveState((prev) => ({ ...prev, users: mergedUsers }));
      } else {
        setLiveState(nextState);
        setSandboxState((prev) => ({ ...prev, users: mergedUsers }));
      }

      if (pushedCount > 0) {
        setSyncNotice(
          `Synchronized ${pushedCount} local record${pushedCount > 1 ? 's' : ''} (${targetEnv.toUpperCase()} & User Credentials) to Cloud.`
        );
        setTimeout(() => setSyncNotice(null), 5000);
      }

      return pushedCount;
    },
    [effectiveOnline, syncUserAndInviteDoc]
  );

  // Real-time Firestore listeners + initial reconciliation for BOTH Sandbox and Live modes
  useEffect(() => {
    if (!authReady || !firebaseUser || !liveUserProfile || !liveUserProfile.active) {
      return;
    }

    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const targetEnv: EnvironmentMode = envMode;
    const envPrefix = `environments/${targetEnv}`;
    const cityWide = hasCityWideAccess(liveUserProfile.role);
    const isAdminUser =
      liveUserProfile.role === 'admin' ||
      firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

    const setTargetEnvState = targetEnv === 'sandbox' ? setSandboxState : setLiveState;

    const startSyncAndListeners = async () => {
      try {
        await flushSyncQueue();
        if (effectiveOnline && isAdminUser) {
          await reconcileEnvironmentToCloud(targetEnv, firebaseUser, liveUserProfile);
        }
      } catch (err) {
        console.warn('Initial cloud reconciliation encountered an issue:', err);
      }

      if (cancelled) return;

      const selfUserUnsub = onSnapshot(
        doc(db, 'users', firebaseUser.uid),
        (snapshot) => {
          if (!snapshot.exists()) return;
          const freshProfile = snapshot.data() as UserAccount;
          if (!freshProfile.active) {
            setGoogleAuthError('This user account is suspended. Contact your Administrator.');
            clearPersistedSessionStorage();
            setLiveUserProfile(null);
            setAuthenticatedUser(null);
            void signOutFirebase().catch(() => {});
            return;
          }
          setLiveUserProfile(freshProfile);
          setAuthenticatedUser(freshProfile);
          writeCachedAuthProfile(freshProfile);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      );
      unsubs.push(selfUserUnsub);

      const attach = <T,>(
        colName: keyof LocalSnapshotState,
        firestoreColPath: string,
        filterField?: string,
        filterValue?: string
      ) => {
        const baseRef = collection(db, firestoreColPath);
        const ref =
          filterField && filterValue !== undefined
            ? query(baseRef, where(filterField, '==', filterValue))
            : baseRef;
        const unsub = onSnapshot(
          ref,
          (snapshot) => {
            const rows = snapshot.docs.map((d) => d.data() as T);
            if (colName === 'users') {
              const userRows = rows as unknown as UserAccount[];
              setLiveState((prev) => ({ ...prev, users: userRows }));
              setSandboxState((prev) => ({ ...prev, users: userRows }));
              return;
            }
            if (colName === 'pmcProjects') {
              const normalizedPmc = (rows as unknown as PmcProject[]).map((p) =>
                normalizePmcProject(p)
              );
              setTargetEnvState((prev) => ({ ...prev, pmcProjects: normalizedPmc }));
              return;
            }
            if (colName === 'storageTanks') {
              const normalizedTanks = (rows as unknown as StorageTank[]).map((t) =>
                normalizeStorageTankRecord(t)
              );
              setTargetEnvState((prev) => ({ ...prev, storageTanks: normalizedTanks }));
              return;
            }
            setTargetEnvState((prev) => ({ ...prev, [colName]: rows }));
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, firestoreColPath);
          }
        );
        unsubs.push(unsub);
      };

      attach<FuelDepot>('depots', `${envPrefix}/depots`);
      attach<StorageTank>('storageTanks', `${envPrefix}/storageTanks`);
      attach<FleetVehicle>(
        'vehicles',
        `${envPrefix}/vehicles`,
        cityWide ? undefined : 'office',
        cityWide ? undefined : liveUserProfile.department
      );
      attach<WorkPlan>(
        'workPlans',
        `${envPrefix}/workPlans`,
        cityWide ? undefined : 'department',
        cityWide ? undefined : liveUserProfile.department
      );
      attach<TripTicket>(
        'tripTickets',
        `${envPrefix}/tripTickets`,
        cityWide ? undefined : 'department',
        cityWide ? undefined : liveUserProfile.department
      );
      attach<InventoryLog>('inventoryLogs', `${envPrefix}/inventoryLogs`);
      attach<PmcProject>('pmcProjects', `${envPrefix}/pmcProjects`);

      if (isAdminUser) {
        attach<AuditLog>('auditLogs', `${envPrefix}/auditLogs`);
        attach<UserAccount>('users', 'users');
      }

      const reportUtilitiesUnsub = onSnapshot(
        doc(db, `${envPrefix}/settings`, 'report_utilities'),
        (snapshot) => {
          if (!snapshot.exists()) return;
          const remoteConfig = normalizeReportUtilitiesConfig(
            snapshot.data() as Partial<ReportUtilitiesConfig>
          );
          setTargetEnvState((prev) => ({ ...prev, reportUtilities: remoteConfig }));
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `${envPrefix}/settings/report_utilities`);
        }
      );
      unsubs.push(reportUtilitiesUnsub);
    };

    void startSyncAndListeners();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [
    authReady,
    firebaseUser,
    envMode,
    effectiveOnline,
    liveUserProfile?.uid,
    liveUserProfile?.role,
    liveUserProfile?.department,
    liveUserProfile?.active,
    flushSyncQueue,
    reconcileEnvironmentToCloud,
  ]);

  useEffect(() => {
    if (effectiveOnline && firebaseUser && syncQueue.length > 0) {
      void flushSyncQueue();
    }
  }, [effectiveOnline, firebaseUser, syncQueue.length, flushSyncQueue]);

  const activeData = envMode === 'live' ? liveState : sandboxState;

  const sandboxPreviewDepartmentOptions = useMemo(
    () =>
      getSandboxPreviewDepartmentsForRole(
        sandboxActiveRole,
        activeData.users,
        activeData.vehicles
      ),
    [sandboxActiveRole, activeData.users, activeData.vehicles]
  );

  const resolvedSandboxDepartment = useMemo(
    () =>
      resolveDefaultSandboxDepartmentForRole(
        sandboxActiveRole,
        sandboxActiveDepartment,
        activeData.users,
        activeData.vehicles
      ),
    [sandboxActiveRole, sandboxActiveDepartment, activeData.users, activeData.vehicles]
  );

  const sandboxPreviewMatchingUsers = useMemo(
    () =>
      findMatchingRbacUsersForSandboxPreview(
        sandboxActiveRole,
        resolvedSandboxDepartment,
        activeData.users,
        activeData.vehicles
      ),
    [sandboxActiveRole, resolvedSandboxDepartment, activeData.users, activeData.vehicles]
  );

  // Keep Sandbox Role Preview department strictly aligned with office rules for the selected role
  useEffect(() => {
    if (
      authenticatedUser?.role === 'admin' &&
      sandboxActiveDepartment !== resolvedSandboxDepartment
    ) {
      setSandboxActiveDepartmentState(resolvedSandboxDepartment);
    }
  }, [authenticatedUser?.role, sandboxActiveDepartment, resolvedSandboxDepartment]);

  const appendAuditRef = useRef<
    | ((
        action: string,
        entityType: string,
        entityId: string,
        summary: string,
        options?: {
          category?: AuditLogCategory;
          details?: string;
          actorOverride?: Partial<
            Pick<UserAccount, 'uid' | 'email' | 'displayName' | 'role' | 'department'>
          >;
          envOverride?: EnvironmentMode;
        }
      ) => Promise<void>)
    | null
  >(null);

  const setSandboxActiveRole = useCallback(
    (nextRole: UserRole) => {
      const currentData = envMode === 'live' ? liveStateRef.current : sandboxStateRef.current;
      const nextDept = resolveDefaultSandboxDepartmentForRole(
        nextRole,
        sandboxActiveDepartment,
        currentData.users,
        currentData.vehicles
      );
      setSandboxActiveRoleState(nextRole);
      setSandboxActiveDepartmentState(nextDept);
      setSelectedSandboxUserUid(null);
      if (authenticatedUser?.role === 'admin' && nextRole !== sandboxActiveRole) {
        void appendAuditRef.current?.(
          'SANDBOX_ROLE_PREVIEW_CHANGED',
          'session',
          authenticatedUser.uid,
          `Admin switched Sandbox Role Preview from ${sandboxActiveRole} to ${nextRole} (${nextDept}).`,
          {
            category: 'system',
            details: `Previous Role: ${sandboxActiveRole} | Preview Role: ${nextRole} | Preview Office: ${nextDept}`,
            actorOverride: authenticatedUser,
            envOverride: 'sandbox',
          }
        );
      }
    },
    [envMode, sandboxActiveDepartment, sandboxActiveRole, authenticatedUser]
  );

  const setSandboxActiveDepartment = useCallback(
    (nextDept: string) => {
      const currentData = envMode === 'live' ? liveStateRef.current : sandboxStateRef.current;
      const resolved = resolveDefaultSandboxDepartmentForRole(
        sandboxActiveRole,
        nextDept,
        currentData.users,
        currentData.vehicles
      );
      setSandboxActiveDepartmentState(resolved);
      setSelectedSandboxUserUid(null);
    },
    [envMode, sandboxActiveRole]
  );

  // Active User Context (Live Registry RBAC + Sandbox Admin Role Preview)
  const currentUser: UserAccount = useMemo(() => {
    if (envMode === 'live' && firebaseUser && liveUserProfile) {
      return resolveActiveUserFromRegistry(liveUserProfile, activeData.users);
    }
    if (authenticatedUser) {
      return resolveSandboxPreviewUser({
        authenticatedUser,
        sandboxActiveRole,
        sandboxActiveDepartment: resolvedSandboxDepartment,
        users: activeData.users,
        selectedSandboxUserUid,
        vehicles: activeData.vehicles,
      });
    }
    return {
      uid: 'unauthenticated',
      email: 'guest@baiscity.gov.ph',
      displayName: 'Unauthenticated',
      role: 'requester',
      department: 'City Engineering Office',
      active: false,
      createdBy: 'system',
      createdAt: '2026-11-12T00:00:00Z',
      updatedAt: '2026-11-12T00:00:00Z',
    };
  }, [
    envMode,
    firebaseUser,
    liveUserProfile,
    authenticatedUser,
    sandboxActiveRole,
    resolvedSandboxDepartment,
    activeData.users,
    activeData.vehicles,
    selectedSandboxUserUid,
  ]);

  // Department-filtered views for strict RBAC data visibility
  const visibleWorkPlans = useMemo(
    () =>
      activeData.workPlans
        .filter((wp) =>
          canAccessDepartmentRecord(currentUser.role, currentUser.department, wp.department)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activeData.workPlans, currentUser.role, currentUser.department]
  );

  const visibleTickets = useMemo(
    () =>
      activeData.tripTickets
        .filter((tt) =>
          canAccessDepartmentRecord(currentUser.role, currentUser.department, tt.department)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activeData.tripTickets, currentUser.role, currentUser.department]
  );

  const visibleVehicles = useMemo(
    () =>
      activeData.vehicles
        .filter((v) =>
          canAccessDepartmentRecord(currentUser.role, currentUser.department, v.office)
        )
        .sort((a, b) => a.plateNumber.localeCompare(b.plateNumber)),
    [activeData.vehicles, currentUser.role, currentUser.department]
  );

  // Unified Persistence Helper (Synchronizes BOTH Sandbox & Live + shared Users to Firestore)
  const persistMutation = useCallback(
    async (
      col: SyncQueueItem['collection'],
      docId: string,
      operation: SyncQueueItem['operation'],
      payload?: Record<string, unknown>,
      targetEnvOverride?: EnvironmentMode
    ) => {
      const targetEnv: EnvironmentMode = targetEnvOverride ?? envMode;
      const normalizedPayload =
        payload && firebaseUser && operation === 'set'
          ? prepareFirestoreRecordPayload(payload, firebaseUser.uid, {
              isCreate: true,
              collection: col,
            })
          : payload;

      const applyLocalListMutation = (prev: LocalSnapshotState): LocalSnapshotState => {
        if (col === 'settings') {
          return {
            ...prev,
            reportUtilities: normalizeReportUtilitiesConfig(
              normalizedPayload as Partial<ReportUtilitiesConfig> | undefined
            ),
          };
        }
        const list = [...(prev[col] as Array<{ id?: string; uid?: string }>)];
        const matchKey = col === 'users' ? 'uid' : 'id';
        const idx = list.findIndex((item) => item[matchKey] === docId);

        if (operation === 'delete') {
          if (idx >= 0) list.splice(idx, 1);
        } else if (operation === 'set' && normalizedPayload) {
          if (idx >= 0) list[idx] = normalizedPayload as { id?: string; uid?: string };
          else list.unshift(normalizedPayload as { id?: string; uid?: string });
        } else if (operation === 'update' && normalizedPayload) {
          if (idx >= 0) {
            list[idx] = { ...list[idx], ...normalizedPayload };
          } else if (col === 'users' && typeof normalizedPayload.uid === 'string') {
            list.unshift(normalizedPayload as { id?: string; uid?: string });
          }
        }
        return { ...prev, [col]: list };
      };

      if (col === 'users') {
        setSandboxState(applyLocalListMutation);
        setLiveState(applyLocalListMutation);
      } else if (targetEnv === 'sandbox') {
        setSandboxState(applyLocalListMutation);
      } else {
        setLiveState(applyLocalListMutation);
      }

      if (!effectiveOnline || !firebaseUser) {
        setSyncQueue((prev) => [
          ...prev,
          {
            id: makeId('sync'),
            envMode: targetEnv,
            collection: col,
            docId,
            operation,
            payload: normalizedPayload,
            createdAt: new Date().toISOString(),
          },
        ]);
        if (!effectiveOnline) {
          setSyncNotice('Offline entry saved locally. Will auto-sync to Firebase when online.');
          setTimeout(() => setSyncNotice(null), 4000);
        }
        return;
      }

      const colPath = col === 'users' ? 'users' : `environments/${targetEnv}/${col}`;
      const docRef = doc(db, colPath, docId);
      try {
        if (operation === 'set' && normalizedPayload) {
          await setDoc(docRef, normalizedPayload);
        } else if (operation === 'update' && normalizedPayload) {
          const updatePayload = prepareFirestoreRecordPayload(
            normalizedPayload,
            firebaseUser.uid,
            { isCreate: false, collection: col }
          );
          try {
            await updateDoc(docRef, updatePayload);
          } catch (updateErr) {
            const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
            if (msg.includes('No document to update') || msg.includes('not-found')) {
              if (col === 'settings') {
                await setDoc(
                  docRef,
                  normalizeReportUtilitiesConfig(normalizedPayload as Partial<ReportUtilitiesConfig>)
                );
                return;
              }
              const sourceState =
                targetEnv === 'sandbox' ? sandboxStateRef.current : liveStateRef.current;
              const list = sourceState[col] as unknown as Array<
                Record<string, unknown> & { id?: string; uid?: string }
              >;
              const matchKey = col === 'users' ? 'uid' : 'id';
              const fullLocal = list.find((item) => item[matchKey] === docId);
              if (fullLocal) {
                await setDoc(
                  docRef,
                  prepareFirestoreRecordPayload(
                    { ...fullLocal, ...normalizedPayload },
                    firebaseUser.uid,
                    { isCreate: true, collection: col }
                  )
                );
                return;
              }
            }
            throw updateErr;
          }
        } else if (operation === 'delete') {
          await deleteDoc(docRef);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `${colPath}/${docId}`);
      }
    },
    [envMode, effectiveOnline, firebaseUser]
  );

  const appendAudit = useCallback(
    async (
      action: string,
      entityType: string,
      entityId: string,
      summary: string,
      options?: {
        category?: AuditLogCategory;
        details?: string;
        actorOverride?: {
          uid?: string;
          email?: string;
          displayName?: string;
          role?: UserRole | 'unauthenticated' | 'system';
          department?: string;
        };
        envOverride?: EnvironmentMode;
      }
    ) => {
      const targetEnv = options?.envOverride ?? envMode;
      const actorUid = options?.actorOverride?.uid ?? firebaseUser?.uid ?? currentUser.uid;
      const actorEmail = (options?.actorOverride?.email ?? currentUser.email ?? 'system@baiscity.gov.ph')
        .trim()
        .slice(0, 254);
      const actorName = (options?.actorOverride?.displayName ?? currentUser.displayName ?? '')
        .trim()
        .slice(0, 120);
      const actorRole = (options?.actorOverride?.role ?? currentUser.role ?? 'system')
        .trim()
        .slice(0, 48);
      const department = (options?.actorOverride?.department ?? currentUser.department ?? '')
        .trim()
        .slice(0, 120);
      const category =
        options?.category ??
        classifyAuditLogCategory({
          action,
          entityType,
        });
      const safeSummary = sanitizeAuditDetails(summary, 400) || 'Audit entry';
      const safeDetails = sanitizeAuditDetails(options?.details, 1200);

      const log: AuditLog = {
        id: makeId('aud'),
        actorUid: actorUid || 'system',
        actorEmail,
        ...(actorName ? { actorName } : {}),
        actorRole,
        ...(department ? { department } : {}),
        category,
        environment: targetEnv,
        action: action.trim().slice(0, 80),
        entityType: entityType.trim().slice(0, 64),
        entityId: entityId.trim().slice(0, 128) || 'unknown',
        summary: safeSummary.length < 2 ? 'Audit entry' : safeSummary,
        ...(safeDetails ? { details: safeDetails } : {}),
        createdAt: new Date().toISOString(),
      };
      await persistMutation(
        'auditLogs',
        log.id,
        'set',
        log as unknown as Record<string, unknown>,
        targetEnv
      );
    },
    [envMode, firebaseUser?.uid, currentUser, persistMutation]
  );

  appendAuditRef.current = appendAudit;

  const changeEnvMode = useCallback(
    (nextEnv: EnvironmentMode) => {
      if (nextEnv === envMode) return;
      const prevEnv = envMode;
      setEnvMode(nextEnv);
      if (authenticatedUser) {
        void appendAudit(
          'ENVIRONMENT_SWITCHED',
          'environment',
          nextEnv,
          `Switched operating environment from ${prevEnv.toUpperCase()} to ${nextEnv.toUpperCase()}.`,
          {
            category: 'system',
            details: `From: ${prevEnv.toUpperCase()} | To: ${nextEnv.toUpperCase()} | Account: ${authenticatedUser.email}`,
            envOverride: nextEnv,
          }
        );
      }
    },
    [envMode, authenticatedUser, appendAudit]
  );

  const isAuthenticatedSession = Boolean(authenticatedUser || (envMode === 'live' && firebaseUser));

  const signInWithGoogle = useCallback(async () => {
    setGoogleAuthError(null);
    setSessionExpiredNotice(null);
    clearPersistedSessionStorage();
    preserveEnvOnAuthRef.current = null;
    googleSignInInitiatedRef.current = true;
    try {
      return await firebaseSignInWithGoogle();
    } catch (err) {
      googleSignInInitiatedRef.current = false;
      throw err;
    }
  }, []);

  // Credential Authentication (Username/Email & Password assigned by Administrator, Local + Cross-Device Cloud Proof)
  const loginWithCredentials = useCallback(
    async (
      username: string,
      password: string
    ): Promise<{ ok: boolean; user?: UserAccount; error?: string }> => {
      setGoogleAuthError(null);
      const localResult = authenticateLocalUserCredentials({
        liveUsers: liveStateRef.current.users,
        sandboxUsers: sandboxStateRef.current.users,
        seedUsers: SEED_USERS,
        identifier: username,
        password,
      });

      let matched: UserAccount | undefined = localResult.ok ? localResult.user : undefined;

      // Cross-device fallback: look up SHA-256 proof-keyed credential record in Firestore
      if (!matched && effectiveOnline) {
        const cleanId = normalizeUsernameInput(username);
        if (cleanId && password) {
          const passwordHash = hashPassword(password);
          const proofId = computeCredentialProofId(cleanId, passwordHash);
          if (proofId) {
            try {
              const credSnap = await getDoc(doc(db, 'credentialLogins', proofId));
              if (credSnap.exists()) {
                const cred = credSnap.data() as Partial<UserAccount> & { uid: string };
                if (cred.active === false) {
                  const safeIdentifier = cleanId.slice(0, 120);
                  await appendAudit(
                    'CREDENTIAL_LOGIN_FAILED',
                    'session',
                    cred.uid || safeIdentifier || 'unknown',
                    `Blocked credential sign-in for suspended cloud account "${safeIdentifier}".`,
                    {
                      category: 'credential',
                      details: `Method: Cloud Credential Proof | Identifier: ${safeIdentifier} | Outcome: Blocked (Suspended Account)`,
                      actorOverride: {
                        uid: cred.uid || 'unauthenticated',
                        email: (cred.email || safeIdentifier || 'unknown@baiscity.gov.ph').slice(0, 254),
                        displayName: cred.displayName || safeIdentifier,
                        role: cred.role || 'unauthenticated',
                        department: cred.department || 'Unassigned',
                      },
                      envOverride: 'sandbox',
                    }
                  );
                  return {
                    ok: false,
                    error: 'This user account is suspended. Contact your Administrator.',
                  };
                }
                const cloudMatched: UserAccount = {
                  uid: cred.uid,
                  username:
                    (cred.username && normalizeUsernameInput(cred.username)) ||
                    normalizeEmailToId(cred.email || cleanId).slice(0, 64),
                  passwordHash,
                  email: (cred.email || `${cleanId}@baiscity.gov.ph`).trim().toLowerCase(),
                  displayName: cred.displayName || cleanId,
                  role: cred.role ?? 'requester',
                  department: cred.department || 'City Engineering Office',
                  positionTitle: cred.positionTitle,
                  canEdit: cred.role === 'admin' ? true : Boolean(cred.canEdit),
                  canDelete: cred.role === 'admin' ? true : Boolean(cred.canDelete),
                  canSwitchToLive: cred.role === 'admin' ? true : Boolean(cred.canSwitchToLive),
                  canRequestSingleTrip:
                    cred.role === 'admin' ? true : Boolean(cred.canRequestSingleTrip),
                  active: true,
                  createdBy: cred.createdBy || 'admin',
                  createdAt: cred.createdAt || new Date().toISOString(),
                  updatedAt: cred.updatedAt || new Date().toISOString(),
                };
                const upsertCredUser = (prev: LocalSnapshotState): LocalSnapshotState => {
                  const cleanEmail = cloudMatched.email.trim().toLowerCase();
                  const others = prev.users.filter(
                    (u) => u.uid !== cloudMatched.uid && u.email.trim().toLowerCase() !== cleanEmail
                  );
                  return { ...prev, users: [cloudMatched, ...others] };
                };
                setSandboxState((prev) => {
                  const next = upsertCredUser(prev);
                  saveLocalState(SANDBOX_STORAGE_KEY, next);
                  return next;
                });
                setLiveState((prev) => {
                  const next = upsertCredUser(prev);
                  saveLocalState(LIVE_CACHE_STORAGE_KEY, next);
                  return next;
                });
                matched = cloudMatched;
              }
            } catch (err) {
              console.warn('Cloud credential proof lookup failed:', err);
            }
          }
        }
      }

      if (!matched) {
        const safeIdentifier = normalizeUsernameInput(username).slice(0, 120) || 'blank';
        const reason = localResult.error || 'Invalid username or password.';
        await appendAudit(
          'CREDENTIAL_LOGIN_FAILED',
          'session',
          safeIdentifier,
          `Failed credential sign-in attempt for identifier "${safeIdentifier}".`,
          {
            category: 'credential',
            details: `Method: Username/Password | Identifier: ${safeIdentifier} | Outcome: Rejected | Reason: ${reason}`,
            actorOverride: {
              uid: 'unauthenticated',
              email: safeIdentifier.includes('@') ? safeIdentifier : `${safeIdentifier}@login-attempt`,
              displayName: `Login Attempt (${safeIdentifier})`,
              role: 'unauthenticated',
              department: 'Authentication Gate',
            },
            envOverride: 'sandbox',
          }
        );
        return localResult;
      }

      const authMethod = localResult.ok ? 'Local Credential Registry' : 'Cloud Credential Proof';
      const nowMs = Date.now();
      const defaultSection = getDefaultNavSection(matched.role);
      lastActivityAtRef.current = nowMs;
      lastActivityWriteRef.current = nowMs;
      activeSectionRef.current = defaultSection;
      setSessionExpiredNotice(null);
      setEnvMode('sandbox');
      setAuthenticatedUser(matched);
      setSandboxActiveRoleState(matched.role);
      setSandboxActiveDepartmentState(matched.department);
      setSelectedSandboxUserUid(null);
      writeCachedAuthProfile(matched);
      writePersistedSession({
        uid: matched.uid,
        envMode: 'sandbox',
        sandboxActiveRole: matched.role,
        sandboxActiveDepartment: matched.department,
        activeSection: defaultSection,
        lastActivityAt: nowMs,
      });
      await appendAudit(
        'CREDENTIAL_LOGIN_SUCCESS',
        'session',
        matched.uid,
        `Credential sign-in succeeded for ${matched.displayName} (${matched.username || matched.email}) as ${matched.role}.`,
        {
          category: 'credential',
          details: `Method: ${authMethod} | Username: ${matched.username || 'N/A'} | Email: ${matched.email} | Role: ${matched.role} | Office: ${matched.department} | Environment: SANDBOX`,
          actorOverride: matched,
          envOverride: 'sandbox',
        }
      );
      return { ok: true, user: matched };
    },
    [effectiveOnline, appendAudit]
  );

  const logout = useCallback(async () => {
    const signingOutUser = authenticatedUser ?? currentUser;
    if (signingOutUser && signingOutUser.uid !== 'unauthenticated') {
      await appendAudit(
        'USER_SIGN_OUT',
        'session',
        signingOutUser.uid,
        `User ${signingOutUser.displayName} (${signingOutUser.email}) signed out of ${envMode.toUpperCase()} session.`,
        {
          category: 'credential',
          details: `Action: Explicit Sign Out | Role: ${signingOutUser.role} | Office: ${signingOutUser.department} | Environment: ${envMode.toUpperCase()}`,
          actorOverride: signingOutUser,
          envOverride: envMode,
        }
      ).catch(() => {});
    }
    clearPersistedSessionStorage();
    setGoogleAuthError(null);
    setSessionExpiredNotice(null);
    setAuthenticatedUser(null);
    setLiveUserProfile(null);
    setSandboxActiveRoleState('admin');
    setSandboxActiveDepartmentState(USER_OFFICE_DEPARTMENT);
    setSelectedSandboxUserUid(null);
    activeSectionRef.current = 'dashboard';
    if (firebaseUser) {
      await signOutFirebase();
    }
  }, [firebaseUser, authenticatedUser, currentUser, envMode, appendAudit]);

  const expireSessionDueToInactivity = useCallback(async () => {
    const expiringUser = authenticatedUser ?? currentUser;
    if (expiringUser && expiringUser.uid !== 'unauthenticated') {
      await appendAudit(
        'SESSION_EXPIRED_INACTIVITY',
        'session',
        expiringUser.uid,
        `Session automatically terminated for ${expiringUser.displayName} (${expiringUser.email}) after 10 minutes of inactivity.`,
        {
          category: 'credential',
          details: `Trigger: 10-Minute Inactivity Timeout | Role: ${expiringUser.role} | Office: ${expiringUser.department} | Environment: ${envMode.toUpperCase()}`,
          actorOverride: expiringUser,
          envOverride: envMode,
        }
      ).catch(() => {});
    }
    clearPersistedSessionStorage();
    setAuthenticatedUser(null);
    setLiveUserProfile(null);
    setSandboxActiveRoleState('admin');
    setSandboxActiveDepartmentState(USER_OFFICE_DEPARTMENT);
    setSelectedSandboxUserUid(null);
    activeSectionRef.current = 'dashboard';
    setSessionExpiredNotice(
      'Your session expired after 10 minutes of inactivity. Please sign in again.'
    );
    if (firebaseUser) {
      await signOutFirebase().catch(() => {});
    }
  }, [firebaseUser, authenticatedUser, currentUser, envMode, appendAudit]);

  const persistActiveSection = useCallback(
    (section: string) => {
      activeSectionRef.current = section;
      if (!isAuthenticatedSession || !authenticatedUser) return;
      const nowMs = Date.now();
      lastActivityAtRef.current = nowMs;
      lastActivityWriteRef.current = nowMs;
      writePersistedSession({
        uid: authenticatedUser.uid,
        envMode,
        sandboxActiveRole,
        sandboxActiveDepartment,
        activeSection: section,
        lastActivityAt: nowMs,
      });
    },
    [isAuthenticatedSession, authenticatedUser, envMode, sandboxActiveRole, sandboxActiveDepartment]
  );

  // Sync role / department / envMode updates into persisted session while authenticated
  useEffect(() => {
    if (!isAuthenticatedSession || !authenticatedUser) return;
    writePersistedSession({
      uid: authenticatedUser.uid,
      envMode,
      sandboxActiveRole,
      sandboxActiveDepartment,
      activeSection: activeSectionRef.current || 'dashboard',
      lastActivityAt: lastActivityAtRef.current,
    });
  }, [isAuthenticatedSession, authenticatedUser, envMode, sandboxActiveRole, sandboxActiveDepartment]);

  // 10-minute sliding inactivity auto-logout monitor (survives refreshes within 10 mins)
  useEffect(() => {
    if (!isAuthenticatedSession) return;

    let timeoutId: number | null = null;

    const scheduleExpiryTimer = (lastMs: number) => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      const remaining = getRemainingInactivityMs(lastMs, Date.now(), INACTIVITY_TIMEOUT_MS);
      timeoutId = window.setTimeout(() => {
        void checkInactivityNow();
      }, Math.max(100, remaining + 50));
    };

    const checkInactivityNow = async () => {
      const raw = readPersistedSessionRaw();
      if (!raw) {
        await expireSessionDueToInactivity();
        return;
      }
      const parsed = parsePersistedSession(raw, Date.now(), INACTIVITY_TIMEOUT_MS);
      if (parsed.expired || !parsed.session) {
        await expireSessionDueToInactivity();
        return;
      }
      lastActivityAtRef.current = parsed.session.lastActivityAt;
      if (isSessionExpired(parsed.session.lastActivityAt, Date.now(), INACTIVITY_TIMEOUT_MS)) {
        await expireSessionDueToInactivity();
        return;
      }
      scheduleExpiryTimer(parsed.session.lastActivityAt);
    };

    const handleUserActivity = () => {
      const nowMs = Date.now();
      if (nowMs - lastActivityWriteRef.current < 5000) {
        return;
      }
      const raw = readPersistedSessionRaw();
      if (raw) {
        const parsed = parsePersistedSession(raw, nowMs, INACTIVITY_TIMEOUT_MS);
        if (parsed.expired) {
          void expireSessionDueToInactivity();
          return;
        }
      }
      lastActivityAtRef.current = nowMs;
      lastActivityWriteRef.current = nowMs;
      if (authenticatedUser) {
        writePersistedSession({
          uid: authenticatedUser.uid,
          envMode,
          sandboxActiveRole,
          sandboxActiveDepartment,
          activeSection: activeSectionRef.current || 'dashboard',
          lastActivityAt: nowMs,
        });
      }
      scheduleExpiryTimer(nowMs);
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkInactivityNow();
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_SESSION_STORAGE_KEY && !e.newValue) {
        void expireSessionDueToInactivity();
      }
    };

    scheduleExpiryTimer(lastActivityAtRef.current);
    const intervalId = window.setInterval(() => {
      void checkInactivityNow();
    }, 5000);

    const activityEvents: Array<keyof WindowEventMap> = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'pointerdown',
    ];
    activityEvents.forEach((evt) => window.addEventListener(evt, handleUserActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      activityEvents.forEach((evt) => window.removeEventListener(evt, handleUserActivity));
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [
    isAuthenticatedSession,
    authenticatedUser,
    envMode,
    sandboxActiveRole,
    sandboxActiveDepartment,
    expireSessionDueToInactivity,
  ]);

  // 1. Create Weekly Work Plan + Embedded Trip Tickets (Sequential WP # + 7-Digit Ticket #s + Max 12)
  const createWorkPlanWithTickets = useCallback(
    async (
      planInput: Omit<
        WorkPlan,
        | 'id'
        | 'controlNumber'
        | 'status'
        | 'totalRequestedLiters'
        | 'totalApprovedLiters'
        | 'totalDispensedLiters'
        | 'ownerId'
        | 'createdAt'
        | 'updatedAt'
      > & { controlNumber?: string },
      ticketDrafts: Array<
        Omit<
          TripTicket,
          | 'id'
          | 'workPlanId'
          | 'ticketNumber'
          | 'department'
          | 'projectTitle'
          | 'approvedLiters'
          | 'dispensedLiters'
          | 'forfeitedLiters'
          | 'servedOnce'
          | 'status'
          | 'ownerId'
          | 'createdAt'
          | 'updatedAt'
        >
      >
    ) => {
      if (ticketDrafts.length === 0 || ticketDrafts.length > MAX_TICKETS_PER_WORKPLAN) {
        throw new Error(`Work plan must contain between 1 and ${MAX_TICKETS_PER_WORKPLAN} trip tickets.`);
      }
      const isSingleTrip = planInput.requestType === 'single_trip';
      if (isSingleTrip && !canUserRequestSingleTrip(currentUser)) {
        throw new Error(
          'Single Trip Ticket permission is deactivated for this user account. Contact your Administrator.'
        );
      }
      if (!isSingleTrip) {
        const effectivePrepDate = (planInput.preparationDate || '').trim() || getLocalIsoDate();
        const weekStartEval = evaluateWorkPlanWeekStart(effectivePrepDate, planInput.weekStart);
        if (!weekStartEval.allowed) {
          throw new Error(
            weekStartEval.reason ||
              'Week Start Date cannot be earlier than Preparation Date. Work plans can only be prepared moving forward.'
          );
        }
        if (planInput.weekEnd && planInput.weekEnd < planInput.weekStart) {
          throw new Error('Week End Date cannot be earlier than Week Start Date.');
        }
      }

      const now = new Date().toISOString();
      const wpId = makeId('wp');
      const explicitYearMatch = planInput.controlNumber?.match(/^WP-(\d{4})-/);
      const weekStartYearMatch = planInput.weekStart?.match(/^(\d{4})-/);
      const targetYear = explicitYearMatch
        ? Number(explicitYearMatch[1])
        : weekStartYearMatch
          ? Number(weekStartYearMatch[1])
          : new Date().getFullYear();
      const sequentialControlNo = isSingleTrip
        ? ''
        : generateNextWorkPlanNumber(activeData.workPlans, targetYear);
      const sequentialTicketNos = generateNextTripTicketNumbers(
        activeData.tripTickets,
        ticketDrafts.length
      );
      const totalRequested = ticketDrafts.reduce((sum, t) => sum + t.requestedLiters, 0);

      const effectiveDepartment = hasCityWideAccess(currentUser.role)
        ? planInput.department.trim()
        : currentUser.department.trim();

      const writeOwnerUid = firebaseUser?.uid ?? currentUser.uid;
      const newPlan: WorkPlan = {
        ...planInput,
        department: effectiveDepartment,
        controlNumber: sequentialControlNo,
        id: wpId,
        status: 'pending_approval',
        totalRequestedLiters: Math.round(totalRequested * 10) / 10,
        totalApprovedLiters: 0,
        totalDispensedLiters: 0,
        ownerId: writeOwnerUid,
        createdAt: now,
        updatedAt: now,
      };

      await persistMutation('workPlans', wpId, 'set', newPlan as unknown as Record<string, unknown>);

      const createdTickets: TripTicket[] = [];
      for (let i = 0; i < ticketDrafts.length; i++) {
        const draft = ticketDrafts[i];
        const ttId = makeId('tt');
        const ticket: TripTicket = {
          ...draft,
          id: ttId,
          workPlanId: wpId,
          ticketNumber: sequentialTicketNos[i],
          department: effectiveDepartment,
          projectTitle: planInput.projectTitle,
          approvedLiters: 0,
          dispensedLiters: 0,
          forfeitedLiters: 0,
          servedOnce: false,
          status: 'pending',
          ownerId: writeOwnerUid,
          createdAt: now,
          updatedAt: now,
        };
        createdTickets.push(ticket);
        await persistMutation('tripTickets', ttId, 'set', ticket as unknown as Record<string, unknown>);
      }

      const planDisplayRef = getWorkPlanDisplayLabel(newPlan);
      await appendAudit(
        'WORKPLAN_CREATED',
        'workPlan',
        wpId,
        `Submitted ${isSingleTrip ? planDisplayRef : `Weekly Work Plan ${planDisplayRef}`} (${newPlan.department}) with ${ticketDrafts.length} trip ticket(s) totaling ${newPlan.totalRequestedLiters.toFixed(1)} L.`
      );
      return { workPlan: newPlan, tickets: createdTickets };
    },
    [
      activeData.workPlans,
      activeData.tripTickets,
      firebaseUser?.uid,
      currentUser,
      persistMutation,
      appendAudit,
    ]
  );

  // 2. Interactive Tabletop Approval with Reduction Latitude
  const submitTabletopApproval = useCallback(
    async (
      workPlan: WorkPlan,
      ticketAdjustments: Array<{ ticket: TripTicket; proposedLiters: number; reason: string }>,
      approverNote: string
    ) => {
      const now = new Date().toISOString();
      let totalApproved = 0;
      let anyReduced = false;
      let anyApproved = false;

      for (const adj of ticketAdjustments) {
        const evalRes = evaluateTabletopApproval(adj.ticket.requestedLiters, adj.proposedLiters);
        totalApproved += evalRes.approvedLiters;
        if (evalRes.status === 'reduced') anyReduced = true;
        if (evalRes.approvedLiters > 0) anyApproved = true;

        await persistMutation('tripTickets', adj.ticket.id, 'update', {
          approvedLiters: evalRes.approvedLiters,
          status: evalRes.status,
          reductionReason: adj.reason || undefined,
          updatedAt: now,
        });
      }

      const planStatus: WorkPlan['status'] = !anyApproved
        ? 'rejected'
        : anyReduced
          ? 'partially_approved'
          : 'approved';

      await persistMutation('workPlans', workPlan.id, 'update', {
        status: planStatus,
        totalApprovedLiters: Math.round(totalApproved * 10) / 10,
        approverNote: approverNote || workPlan.approverNote,
        updatedAt: now,
      });

      await appendAudit(
        'TABLETOP_APPROVAL_SUBMITTED',
        'workPlan',
        workPlan.id,
        `Tabletop assessment on ${getWorkPlanDisplayLabel(workPlan)}: ${totalApproved.toFixed(1)} L approved of ${workPlan.totalRequestedLiters.toFixed(1)} L requested.`
      );
    },
    [currentUser.displayName, persistMutation, appendAudit]
  );

  // 3. GSO Once-Daily Dispensing (Forfeits unserved balance immediately + requires pump photo proof)
  const dispenseTripTicket = useCallback(
    async (
      ticket: TripTicket,
      actualDispensedLiters: number,
      pumpProof?: { dataUrl: string; fileName: string },
      dispenserOptions?: { tankId?: string; pumpId?: string }
    ) => {
      if (!pumpProof || !hasValidPumpReadingProof(pumpProof.dataUrl)) {
        return {
          ok: false,
          error:
            'Mandatory upload of pump reading picture file is required as proof of actual dispensing.',
        };
      }

      const depot = activeData.depots.find((d) => d.id === ticket.depotId);
      if (!depot) {
        return { ok: false, error: 'Selected fuel depot not found.' };
      }

      const outcome = computeSingleDispenseOutcome({
        ticket,
        actualDispensedLiters,
        depot,
      });

      if (!outcome.ok) {
        return { ok: false, error: outcome.error };
      }

      const now = new Date().toISOString();
      const cleanPhotoName = (pumpProof.fileName || 'pump-reading.jpg').trim().slice(0, 160);
      const gsoTransactionCode = generateNextGsoTransactionCode(
        'dispense',
        activeData.inventoryLogs,
        activeData.tripTickets
      );

      // Resolve connected StorageTank from Master Registry FIRST so per-tank WAC is applied accurately
      const matchedTank =
        (dispenserOptions?.tankId
          ? activeData.storageTanks.find((t) => t.id === dispenserOptions.tankId)
          : undefined) ??
        activeData.storageTanks.find(
          (t) => t.depotId === depot.id && t.mappedFuelType === ticket.fuelType
        );
      const resolvedPumpId =
        dispenserOptions?.pumpId?.trim() ||
        matchedTank?.connectedDispensers?.[0] ||
        undefined;

      const unitPrice = resolvePrevailingWeightedAverageCost({
        fuelType: ticket.fuelType,
        timestampIso: now,
        inventoryLogs: activeData.inventoryLogs,
        depots: activeData.depots,
        storageTanks: activeData.storageTanks,
        depotId: depot.id,
        tankId: matchedTank?.id,
      });

      await persistMutation('tripTickets', ticket.id, 'update', {
        gsoTransactionCode,
        dispensedLiters: outcome.dispensedLiters,
        forfeitedLiters: outcome.forfeitedLiters,
        unitPriceAtDispense: unitPrice,
        servedOnce: true,
        dispensedAt: now,
        dispensedBy: currentUser.displayName,
        pumpReadingPhotoDataUrl: pumpProof.dataUrl,
        pumpReadingPhotoName: cleanPhotoName,
        status: outcome.newTicketStatus,
        updatedAt: now,
      });

      const currentStock =
        ticket.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters;
      const depotUpdate =
        ticket.fuelType === 'gasoline'
          ? { gasolineCurrentLiters: outcome.newDepotBalance, updatedAt: now }
          : { dieselCurrentLiters: outcome.newDepotBalance, updatedAt: now };
      await persistMutation('depots', depot.id, 'update', depotUpdate);

      let tankBeforeDispense = currentStock;
      let tankAfterDispense = outcome.newDepotBalance;
      if (matchedTank) {
        tankBeforeDispense = matchedTank.currentBookVolumeLiters;
        tankAfterDispense = Math.max(
          0,
          Math.round((matchedTank.currentBookVolumeLiters - outcome.dispensedLiters) * 10) / 10
        );
        await persistMutation('storageTanks', matchedTank.id, 'update', {
          currentBookVolumeLiters: tankAfterDispense,
          updatedAt: now,
        });
      }

      const parentPlan = activeData.workPlans.find((w) => w.id === ticket.workPlanId);
      if (parentPlan) {
        const nextPlanDispensed =
          Math.round((parentPlan.totalDispensedLiters + outcome.dispensedLiters) * 10) / 10;
        await persistMutation('workPlans', parentPlan.id, 'update', {
          totalDispensedLiters: nextPlanDispensed,
          updatedAt: now,
        });
      }

      const invLog: InventoryLog = {
        id: makeId('inv'),
        depotId: depot.id,
        depotName: depot.name,
        ...(matchedTank ? { tankId: matchedTank.id } : {}),
        ...(resolvedPumpId ? { pumpId: resolvedPumpId } : {}),
        fuelType: ticket.fuelType,
        transactionType: 'dispense',
        litersDelta: -outcome.dispensedLiters,
        balanceBefore: tankBeforeDispense,
        balanceAfter: tankAfterDispense,
        prevailingWeightedAverageCostPhp: unitPrice,
        gsoTransactionCode,
        tripTicketNumber: ticket.ticketNumber,
        referenceNumber: ticket.ticketNumber,
        notes: `Once-daily dispense to ${ticket.plateNumber} (${ticket.driverName})${resolvedPumpId ? ` via ${resolvedPumpId}` : ''}${matchedTank ? ` [${matchedTank.tankCode}]` : ''} @ Tank WAC ₱${unitPrice.toFixed(4)}/L. Pump proof: ${cleanPhotoName}. Unserved balance forfeited: ${outcome.forfeitedLiters.toFixed(1)} L.`,
        approvalStatus: 'verified',
        gsoApproverName: currentUser.displayName,
        digitalVerificationCode: `DISP-${ticket.ticketNumber.slice(-5)}`,
        verifiedAt: now,
        ownerId: firebaseUser?.uid ?? currentUser.uid,
        createdAt: now,
      };
      await persistMutation('inventoryLogs', invLog.id, 'set', invLog as unknown as Record<string, unknown>);

      await appendAudit(
        'FUEL_DISPENSED_ONCE',
        'tripTicket',
        ticket.id,
        `[${gsoTransactionCode}] Dispensed ${outcome.dispensedLiters.toFixed(1)} L ${ticket.fuelType} for ${ticket.ticketNumber} (${ticket.plateNumber})${matchedTank ? ` from ${matchedTank.tankCode}` : ''} @ Tank WAC PHP ${unitPrice.toFixed(4)}/L with pump photo proof (${cleanPhotoName}). Forfeited balance: ${outcome.forfeitedLiters.toFixed(1)} L.`
      );

      return { ok: true, outcome };
    },
    [
      activeData.depots,
      activeData.storageTanks,
      activeData.workPlans,
      activeData.inventoryLogs,
      activeData.tripTickets,
      firebaseUser?.uid,
      currentUser,
      persistMutation,
      appendAudit,
    ]
  );

  // 4. Depot Delivery & Pre-Fill Dipping Shrinkage/Overage Adjustment
  const recordDepotTransaction = useCallback(
    async (params: {
      depot: FuelDepot;
      fuelType: FuelType;
      tankId?: string;
      transactionType: 'delivery' | 'shrinkage_adjustment' | 'overage_adjustment';
      litersAmount: number;
      deliveryUnitCostPhp?: number;
      deliveryTotalAmountPhp?: number;
      physicalDipLiters?: number;
      referenceNumber: string;
      purchaseOrderRef?: string;
      supplierName?: string;
      deliveryDate?: string;
      notes: string;
      gsoApproverName?: string;
      digitalVerificationCode?: string;
      postImmediately?: boolean;
      requireSeparateGsoApproval?: boolean;
    }): Promise<InventoryLog> => {
      const now = new Date().toISOString();
      const latestState = envMode === 'live' ? liveStateRef.current : sandboxStateRef.current;
      const depot = latestState.depots.find((d) => d.id === params.depot.id) ?? params.depot;
      const { fuelType, transactionType, litersAmount } = params;

      const matchedTank =
        (params.tankId
          ? latestState.storageTanks.find((t) => t.id === params.tankId)
          : undefined) ??
        latestState.storageTanks.find(
          (t) => t.depotId === depot.id && t.mappedFuelType === fuelType
        );

      const depotBefore =
        fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters;
      const depotCapacity =
        fuelType === 'gasoline' ? depot.gasolineCapacityLiters : depot.dieselCapacityLiters;

      const delta =
        transactionType === 'shrinkage_adjustment'
          ? -Math.abs(litersAmount)
          : Math.abs(litersAmount);
      const depotAfter = Math.max(
        0,
        Math.min(depotCapacity, Math.round((depotBefore + delta) * 10) / 10)
      );

      // Per-tank stock balance (used as exact basis for per-tank WAC)
      const tankBefore = matchedTank ? matchedTank.currentBookVolumeLiters : depotBefore;
      const tankCapacity = matchedTank ? matchedTank.grossCapacityLiters : depotCapacity;
      const tankAfter = Math.max(
        0,
        Math.min(tankCapacity, Math.round((tankBefore + delta) * 10) / 10)
      );

      const gsoTransactionCode = generateNextGsoTransactionCode(
        transactionType,
        latestState.inventoryLogs,
        latestState.tripTickets
      );

      const rawManualCode = params.requireSeparateGsoApproval
        ? ''
        : (params.digitalVerificationCode ?? '').trim();
      let validatedManualCode: string | undefined;
      let validatedApproverName: string | undefined = params.gsoApproverName;
      if (rawManualCode.length > 0) {
        const allKnownUsers = deduplicateUsersByEmail([
          ...liveStateRef.current.users,
          ...sandboxStateRef.current.users,
        ]);
        const gsoMatch = matchGsoHeadVerificationCode(rawManualCode, allKnownUsers);
        if (!gsoMatch.matched || !gsoMatch.gsoHead) {
          await appendAudit(
            'GSO_VERIFICATION_REJECTED',
            'inventoryLog',
            depot.id,
            `Rejected invalid GSO Head verification code during ${depot.name} ${fuelType} ${transactionType.replace(/_/g, ' ')}.`,
            {
              category: 'credential',
              details: `Depot: ${depot.name} | Fuel: ${fuelType.toUpperCase()} | Transaction: ${transactionType} | Ref: ${params.referenceNumber.trim().slice(0, 64)} | Code Verification: Failed`,
            }
          ).catch(() => {});
          throw new Error(
            gsoMatch.error ||
              'Invalid GSO Head Verification Code. Enter an active GSO Head account code or queue for separate GSO Head approval.'
          );
        }
        validatedManualCode = gsoMatch.normalizedCode;
        validatedApproverName = gsoMatch.gsoHead.displayName;
      }

      const verification = resolveDepotTransactionVerification({
        transactionType,
        digitalVerificationCode: validatedManualCode,
        gsoApproverName: validatedApproverName,
        actorDisplayName: currentUser.displayName,
        gsoTransactionCode,
        postImmediately: params.postImmediately,
        requireSeparateGsoApproval: params.requireSeparateGsoApproval,
      });
      const isVerifiedNow = verification.isVerifiedNow;

      const currentWac = resolvePrevailingWeightedAverageCost({
        fuelType,
        timestampIso: now,
        inventoryLogs: latestState.inventoryLogs,
        depots: latestState.depots,
        storageTanks: latestState.storageTanks,
        depotId: depot.id,
        tankId: matchedTank?.id,
      });

      const isDelivery = transactionType === 'delivery';
      const deliveryUnitCost =
        isDelivery && typeof params.deliveryUnitCostPhp === 'number' && params.deliveryUnitCostPhp > 0
          ? Math.round(params.deliveryUnitCostPhp * 10000) / 10000
          : isDelivery
            ? currentWac
            : undefined;
      const computedWacAfter =
        isDelivery && deliveryUnitCost !== undefined
          ? computeWeightedAverageCostAfterDelivery({
              currentStockLiters: tankBefore,
              currentWacPhp: currentWac,
              deliveredLiters: Math.abs(litersAmount),
              deliveryUnitCostPhp: deliveryUnitCost,
            })
          : undefined;

      const cleanPoRef = params.purchaseOrderRef?.trim().toUpperCase().slice(0, 64);
      const cleanSupplier = params.supplierName?.trim().slice(0, 120);
      const cleanDeliveryDate = params.deliveryDate?.trim().slice(0, 20);
      const cleanTotalAmount =
        isDelivery &&
        typeof params.deliveryTotalAmountPhp === 'number' &&
        Number.isFinite(params.deliveryTotalAmountPhp) &&
        params.deliveryTotalAmountPhp >= 0
          ? Math.min(1_000_000_000, Math.round(params.deliveryTotalAmountPhp * 100) / 100)
          : undefined;
      const cleanPhysicalDip =
        typeof params.physicalDipLiters === 'number' &&
        Number.isFinite(params.physicalDipLiters) &&
        params.physicalDipLiters >= 0
          ? Math.round(params.physicalDipLiters * 10) / 10
          : undefined;

      const log: InventoryLog = {
        id: makeId('inv'),
        depotId: depot.id,
        depotName: depot.name,
        ...(matchedTank ? { tankId: matchedTank.id } : {}),
        fuelType,
        transactionType,
        litersDelta: delta,
        balanceBefore: tankBefore,
        balanceAfter: isVerifiedNow ? tankAfter : tankBefore,
        ...(isDelivery && deliveryUnitCost !== undefined
          ? {
              deliveryUnitCostPhp: deliveryUnitCost,
              ...(cleanTotalAmount !== undefined ? { deliveryTotalAmountPhp: cleanTotalAmount } : {}),
              weightedAverageCostBefore: currentWac,
              weightedAverageCostAfter: computedWacAfter,
              prevailingWeightedAverageCostPhp: computedWacAfter,
            }
          : {
              prevailingWeightedAverageCostPhp: currentWac,
            }),
        ...(cleanPhysicalDip !== undefined ? { physicalDipLiters: cleanPhysicalDip } : {}),
        gsoTransactionCode,
        referenceNumber: params.referenceNumber.trim().slice(0, 64),
        ...(cleanPoRef ? { purchaseOrderRef: cleanPoRef } : {}),
        ...(cleanSupplier ? { supplierName: cleanSupplier } : {}),
        ...(cleanDeliveryDate ? { deliveryDate: cleanDeliveryDate } : {}),
        notes: params.notes.trim().slice(0, 400),
        approvalStatus: verification.approvalStatus,
        ...(isVerifiedNow && verification.gsoApproverName
          ? { gsoApproverName: verification.gsoApproverName }
          : {}),
        ...(isVerifiedNow && verification.digitalVerificationCode
          ? { digitalVerificationCode: verification.digitalVerificationCode }
          : {}),
        ...(isVerifiedNow ? { verifiedAt: now } : {}),
        ownerId: firebaseUser?.uid ?? currentUser.uid,
        createdAt: now,
      };

      await persistMutation('inventoryLogs', log.id, 'set', log as unknown as Record<string, unknown>);

      if (isVerifiedNow) {
        let updatedStorageTanks = latestState.storageTanks;
        if (matchedTank) {
          const tankPayload: Record<string, unknown> = {
            currentBookVolumeLiters: tankAfter,
            ...(isDelivery && computedWacAfter !== undefined
              ? { currentWacPhp: computedWacAfter }
              : {}),
            ...(cleanPhysicalDip !== undefined
              ? { lastDipVolumeLiters: cleanPhysicalDip, lastDipAt: now }
              : {}),
            updatedAt: now,
          };
          await persistMutation('storageTanks', matchedTank.id, 'update', tankPayload);
          updatedStorageTanks = latestState.storageTanks.map((t) =>
            t.id === matchedTank.id
              ? {
                  ...t,
                  currentBookVolumeLiters: tankAfter,
                  ...(isDelivery && computedWacAfter !== undefined
                    ? { currentWacPhp: computedWacAfter }
                    : {}),
                }
              : t
          );
        }

        const aggregateDepotWac =
          isDelivery && computedWacAfter !== undefined
            ? computeAggregateDepotWacFromTanks({
                depotId: depot.id,
                fuelType,
                storageTanks: updatedStorageTanks,
                fallbackWacPhp: computedWacAfter,
              })
            : undefined;

        const depotUpdate =
          fuelType === 'gasoline'
            ? {
                gasolineCurrentLiters: depotAfter,
                ...(aggregateDepotWac !== undefined
                  ? { gasolinePricePerLiter: aggregateDepotWac }
                  : {}),
                lastDipVerifiedAt: now,
                lastDipVerifiedBy: verification.gsoApproverName || currentUser.displayName,
                updatedAt: now,
              }
            : {
                dieselCurrentLiters: depotAfter,
                ...(aggregateDepotWac !== undefined
                  ? { dieselPricePerLiter: aggregateDepotWac }
                  : {}),
                lastDipVerifiedAt: now,
                lastDipVerifiedBy: verification.gsoApproverName || currentUser.displayName,
                updatedAt: now,
              };
        await persistMutation('depots', depot.id, 'update', depotUpdate);
      }

      await appendAudit(
        `DEPOT_${transactionType.toUpperCase()}`,
        'inventoryLog',
        log.id,
        `[${gsoTransactionCode}] ${depot.name}${matchedTank ? ` (${matchedTank.tankCode})` : ''} ${fuelType} ${transactionType.replace(/_/g, ' ')}: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} L${isDelivery && computedWacAfter !== undefined ? ` @ PHP ${deliveryUnitCost?.toFixed(2)}/L -> Est. Tank WAC PHP ${computedWacAfter.toFixed(4)}/L` : ''} (${log.approvalStatus}).`,
        {
          category: 'transaction',
          details: [
            `Tx Code: ${gsoTransactionCode}`,
            `Depot: ${depot.name}`,
            matchedTank ? `Tank: ${matchedTank.tankCode}` : '',
            `Fuel Class: ${fuelType.toUpperCase()}`,
            `Type: ${transactionType.replace(/_/g, ' ')}`,
            `Volume Delta: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} L`,
            `Tank Balance Before -> After: ${tankBefore.toLocaleString()} L -> ${(isVerifiedNow ? tankAfter : tankBefore).toLocaleString()} L`,
            isDelivery && deliveryUnitCost !== undefined ? `Delivery Unit Cost: PHP ${deliveryUnitCost.toFixed(4)}/L` : '',
            isDelivery && cleanTotalAmount !== undefined ? `Delivery Total Amount: PHP ${cleanTotalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
            isDelivery && computedWacAfter !== undefined ? `Tank WAC (Projected/Effected): PHP ${computedWacAfter.toFixed(4)}/L` : '',
            `Reference: ${log.referenceNumber}`,
            cleanPoRef ? `PO Ref: ${cleanPoRef}` : '',
            cleanSupplier ? `Supplier: ${cleanSupplier}` : '',
            `Verification Status: ${log.approvalStatus}`,
          ]
            .filter(Boolean)
            .join(' | '),
        }
      );
      return log;
    },
    [
      envMode,
      firebaseUser?.uid,
      currentUser,
      persistMutation,
      appendAudit,
    ]
  );

  // 4b. Fuel Depot & UST Master Registry CRUD (Single Source of Truth)
  const saveDepotInfo = useCallback(
    async (
      depotId: string,
      updates: Partial<
        Pick<
          FuelDepot,
          | 'siteCode'
          | 'name'
          | 'location'
          | 'coordinates'
          | 'permitNumber'
          | 'calibrationExpiryDate'
          | 'stationManager'
          | 'reorderThresholdPct'
        >
      >
    ) => {
      const existing = activeData.depots.find((d) => d.id === depotId);
      if (!existing) return;
      const now = new Date().toISOString();
      const cleanedUpdates: Record<string, unknown> = {
        name: (updates.name ?? existing.name).trim().slice(0, 120),
        location: (updates.location ?? existing.location).trim().slice(0, 160),
        updatedAt: now,
      };
      if (updates.siteCode !== undefined && updates.siteCode.trim()) {
        cleanedUpdates.siteCode = updates.siteCode.trim().toUpperCase().slice(0, 32);
      }
      if (updates.coordinates !== undefined && updates.coordinates.trim()) {
        cleanedUpdates.coordinates = updates.coordinates.trim().slice(0, 80);
      }
      if (updates.permitNumber !== undefined && updates.permitNumber.trim()) {
        cleanedUpdates.permitNumber = updates.permitNumber.trim().slice(0, 64);
      }
      if (updates.calibrationExpiryDate !== undefined && updates.calibrationExpiryDate.trim()) {
        cleanedUpdates.calibrationExpiryDate = updates.calibrationExpiryDate.trim().slice(0, 20);
      }
      if (updates.stationManager !== undefined && updates.stationManager.trim()) {
        cleanedUpdates.stationManager = updates.stationManager.trim().slice(0, 120);
      }
      if (typeof updates.reorderThresholdPct === 'number' && Number.isFinite(updates.reorderThresholdPct)) {
        cleanedUpdates.reorderThresholdPct = Math.max(0, Math.min(100, updates.reorderThresholdPct));
      }

      await persistMutation('depots', depotId, 'update', cleanedUpdates);
      await appendAudit(
        'DEPOT_METADATA_UPDATED',
        'depot',
        depotId,
        `Updated Fuel Depot Master info for ${String(cleanedUpdates.name)} (${String(cleanedUpdates.siteCode || existing.siteCode || depotId)}).`
      );
    },
    [activeData.depots, persistMutation, appendAudit]
  );

  const syncDepotCapacitiesFromTanks = useCallback(
    async (depotId: string, nextTanks: StorageTank[], nowIso: string) => {
      const depot = activeData.depots.find((d) => d.id === depotId);
      if (!depot) return;
      const depotTanks = nextTanks.filter((t) => t.depotId === depotId);
      if (depotTanks.length === 0) return;

      const agg = computeAggregateDepotCapacitiesFromTanks(depotId, nextTanks);
      const nextDieselCap = Math.max(
        agg.dieselCapacityLiters > 0 ? agg.dieselCapacityLiters : depot.dieselCapacityLiters,
        depot.dieselCurrentLiters,
        100
      );
      const nextGasCap = Math.max(
        agg.gasolineCapacityLiters > 0 ? agg.gasolineCapacityLiters : depot.gasolineCapacityLiters,
        depot.gasolineCurrentLiters,
        100
      );
      await persistMutation('depots', depotId, 'update', {
        dieselCapacityLiters: nextDieselCap,
        gasolineCapacityLiters: nextGasCap,
        updatedAt: nowIso,
      });
    },
    [activeData.depots, persistMutation]
  );

  const saveStorageTank = useCallback(
    async (
      tankDraft: Omit<
        StorageTank,
        | 'id'
        | 'mappedFuelType'
        | 'grossCapacityLiters'
        | 'safeFillCapacityLiters'
        | 'deadstockVolumeLiters'
        | 'netWorkingVolumeLiters'
        | 'ownerId'
        | 'createdAt'
        | 'updatedAt'
      >,
      existingTankId?: string
    ): Promise<StorageTank> => {
      const now = new Date().toISOString();
      const existing = existingTankId
        ? activeData.storageTanks.find((t) => t.id === existingTankId)
        : undefined;
      const id = existing?.id ?? makeId('tank');
      const productStyle = TANK_FUEL_PRODUCT_STYLES[tankDraft.fuelProduct] ?? TANK_FUEL_PRODUCT_STYLES.diesel;
      const specs = computeTankSpecifications({
        geometry: tankDraft.geometry,
        diameterCm: tankDraft.diameterCm,
        lengthCm: tankDraft.lengthCm,
        widthCm: tankDraft.widthCm,
        heightCm: tankDraft.heightCm,
        tiltAngleDegrees: tankDraft.tiltAngleDegrees,
        overfillBufferPct: tankDraft.overfillBufferPct,
        deadstockClearanceCm: tankDraft.deadstockClearanceCm,
        customStrappingPoints: tankDraft.customStrappingPoints,
      });

      const parentDepot = activeData.depots.find((d) => d.id === tankDraft.depotId);
      const fallbackTankWac =
        productStyle.mappedDepotFuelType === 'gasoline'
          ? parentDepot?.gasolinePricePerLiter ?? 64.5
          : parentDepot?.dieselPricePerLiter ?? 58.2;
      const resolvedTankWac =
        typeof tankDraft.currentWacPhp === 'number' && Number.isFinite(tankDraft.currentWacPhp) && tankDraft.currentWacPhp > 0
          ? Math.round(tankDraft.currentWacPhp * 10000) / 10000
          : typeof existing?.currentWacPhp === 'number' && Number.isFinite(existing.currentWacPhp) && existing.currentWacPhp > 0
            ? existing.currentWacPhp
            : fallbackTankWac;

      const record = normalizeStorageTankRecord({
        ...tankDraft,
        id,
        tankCode: tankDraft.tankCode.trim().toUpperCase().slice(0, 40),
        name: tankDraft.name.trim().slice(0, 120),
        locationZone: tankDraft.locationZone.trim().slice(0, 120),
        manholeTag: tankDraft.manholeTag?.trim() ? tankDraft.manholeTag.trim().slice(0, 80) : undefined,
        mappedFuelType: productStyle.mappedDepotFuelType,
        connectedDispensers: Array.from(
          new Set(tankDraft.connectedDispensers.map((p) => p.trim()).filter(Boolean))
        ).slice(0, 32),
        grossCapacityLiters: specs.grossCapacityLiters,
        safeFillCapacityLiters: specs.safeFillCapacityLiters,
        deadstockVolumeLiters: specs.deadstockVolumeLiters,
        netWorkingVolumeLiters: specs.netWorkingVolumeLiters,
        calibrationCertificateNo: tankDraft.calibrationCertificateNo?.trim()
          ? tankDraft.calibrationCertificateNo.trim().slice(0, 64)
          : undefined,
        calibrationExpiryDate: tankDraft.calibrationExpiryDate?.trim()
          ? tankDraft.calibrationExpiryDate.trim().slice(0, 20)
          : undefined,
        openingDipLiters: Math.min(specs.grossCapacityLiters, Math.max(0, tankDraft.openingDipLiters)),
        currentBookVolumeLiters: Math.min(
          specs.grossCapacityLiters,
          Math.max(0, tankDraft.currentBookVolumeLiters)
        ),
        currentWacPhp: resolvedTankWac,
        ownerId: existing?.ownerId ?? firebaseUser?.uid ?? currentUser.uid,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      await persistMutation(
        'storageTanks',
        record.id,
        existing ? 'update' : 'set',
        record as unknown as Record<string, unknown>
      );

      const nextTanks = existing
        ? activeData.storageTanks.map((t) => (t.id === record.id ? record : t))
        : [record, ...activeData.storageTanks];
      await syncDepotCapacitiesFromTanks(record.depotId, nextTanks, now);

      await appendAudit(
        existing ? 'STORAGE_TANK_UPDATED' : 'STORAGE_TANK_REGISTERED',
        'storageTank',
        record.id,
        `${existing ? 'Updated' : 'Registered'} ${record.tankCode} (${record.name}, ${productStyle.label}, Gross ${record.grossCapacityLiters.toLocaleString()} L / Safe Fill ${record.safeFillCapacityLiters.toLocaleString()} L).`
      );
      return record;
    },
    [
      activeData.depots,
      activeData.storageTanks,
      firebaseUser?.uid,
      currentUser.uid,
      persistMutation,
      syncDepotCapacitiesFromTanks,
      appendAudit,
    ]
  );

  const deleteStorageTank = useCallback(
    async (tank: StorageTank) => {
      const now = new Date().toISOString();
      await persistMutation('storageTanks', tank.id, 'delete');
      const remainingTanks = activeData.storageTanks.filter((t) => t.id !== tank.id);
      await syncDepotCapacitiesFromTanks(tank.depotId, remainingTanks, now);
      await appendAudit(
        'STORAGE_TANK_DELETED',
        'storageTank',
        tank.id,
        `Removed tank ${tank.tankCode} (${tank.name}) from Master Registry.`
      );
    },
    [activeData.storageTanks, persistMutation, syncDepotCapacitiesFromTanks, appendAudit]
  );

  const recordTankDipReading = useCallback(
    async (params: {
      tankId: string;
      calculatedVolumeLiters: number;
      timestampIso: string;
    }) => {
      const tank = activeData.storageTanks.find((t) => t.id === params.tankId);
      if (!tank) return;
      const roundedVol = Math.round(Math.max(0, params.calculatedVolumeLiters) * 10) / 10;
      await persistMutation('storageTanks', tank.id, 'update', {
        lastDipVolumeLiters: roundedVol,
        lastDipAt: params.timestampIso,
        updatedAt: params.timestampIso,
      });
      await persistMutation('depots', tank.depotId, 'update', {
        lastDipVerifiedAt: params.timestampIso,
        lastDipVerifiedBy: currentUser.displayName,
        updatedAt: params.timestampIso,
      });
      await appendAudit(
        'TANK_DIPSTICK_LOGGED',
        'storageTank',
        tank.id,
        `Logged physical dipstick reading for ${tank.tankCode} (${tank.name}): ${roundedVol.toLocaleString()} L.`,
        {
          category: 'transaction',
          details: `Tank Code: ${tank.tankCode} | Tank Name: ${tank.name} | Fuel Class: ${tank.mappedFuelType.toUpperCase()} | Calculated Dip Volume: ${roundedVol.toLocaleString()} L | Reading Timestamp: ${params.timestampIso}`,
        }
      );
    },
    [activeData.storageTanks, currentUser.displayName, persistMutation, appendAudit]
  );

  const verifyPendingAdjustment = useCallback(
    async (log: InventoryLog, _gsoApproverName: string, digitalVerificationCode: string) => {
      if (!canAccessDepotLedgerRegister(currentUser.role)) {
        throw new Error(
          'Access Denied: GSO Depot Dispenser cannot access or verify Depot Ledger Register records.'
        );
      }
      const allKnownUsers = deduplicateUsersByEmail([
        ...liveStateRef.current.users,
        ...sandboxStateRef.current.users,
      ]);
      const gsoMatch = matchGsoHeadVerificationCode(digitalVerificationCode, allKnownUsers);
      if (!gsoMatch.matched || !gsoMatch.gsoHead) {
        await appendAudit(
          'GSO_VERIFICATION_REJECTED',
          'inventoryLog',
          log.id,
          `Rejected invalid GSO Head verification code for pending inventory log ${log.referenceNumber}.`,
          {
            category: 'credential',
            details: `Log Ref: ${log.referenceNumber} | Depot: ${log.depotName} | Fuel: ${log.fuelType.toUpperCase()} | Code Verification: Failed`,
          }
        ).catch(() => {});
        throw new Error(
          gsoMatch.error ||
            'Invalid GSO Head Verification Code. Only the distinct code assigned to an active GSO Head account is accepted.'
        );
      }
      const verifiedApproverName = gsoMatch.gsoHead.displayName;
      const verifiedCode = gsoMatch.normalizedCode;

      const latestState = envMode === 'live' ? liveStateRef.current : sandboxStateRef.current;
      const depot = latestState.depots.find((d) => d.id === log.depotId);
      if (!depot) return;
      const now = new Date().toISOString();

      // Resolve target StorageTank FIRST so per-tank balance & per-tank WAC are computed exclusively for this tank
      const matchedTank =
        (log.tankId ? latestState.storageTanks.find((t) => t.id === log.tankId) : undefined) ??
        latestState.storageTanks.find(
          (t) => t.depotId === depot.id && t.mappedFuelType === log.fuelType
        );

      const depotBefore =
        log.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters;
      const depotCapacity =
        log.fuelType === 'gasoline' ? depot.gasolineCapacityLiters : depot.dieselCapacityLiters;
      const depotAfter = Math.max(
        0,
        Math.min(depotCapacity, Math.round((depotBefore + log.litersDelta) * 10) / 10)
      );

      const tankBefore = matchedTank ? matchedTank.currentBookVolumeLiters : depotBefore;
      const tankCapacity = matchedTank ? matchedTank.grossCapacityLiters : depotCapacity;
      const tankAfter = Math.max(
        0,
        Math.min(tankCapacity, Math.round((tankBefore + log.litersDelta) * 10) / 10)
      );

      const isDelivery = log.transactionType === 'delivery';
      const currentWac = resolvePrevailingWeightedAverageCost({
        fuelType: log.fuelType,
        timestampIso: now,
        inventoryLogs: latestState.inventoryLogs,
        depots: latestState.depots,
        storageTanks: latestState.storageTanks,
        depotId: depot.id,
        tankId: matchedTank?.id,
      });
      const deliveryUnitCost = log.deliveryUnitCostPhp ?? currentWac;
      const computedWacAfter = isDelivery
        ? computeWeightedAverageCostAfterDelivery({
            currentStockLiters: tankBefore,
            currentWacPhp: currentWac,
            deliveredLiters: Math.abs(log.litersDelta),
            deliveryUnitCostPhp: deliveryUnitCost,
          })
        : undefined;

      await persistMutation('inventoryLogs', log.id, 'update', {
        approvalStatus: 'verified',
        balanceBefore: tankBefore,
        balanceAfter: tankAfter,
        ...(isDelivery && computedWacAfter !== undefined
          ? {
              weightedAverageCostBefore: currentWac,
              weightedAverageCostAfter: computedWacAfter,
              prevailingWeightedAverageCostPhp: computedWacAfter,
            }
          : {
              prevailingWeightedAverageCostPhp: currentWac,
            }),
        gsoApproverName: verifiedApproverName,
        digitalVerificationCode: verifiedCode,
        verifiedAt: now,
      });

      let updatedStorageTanks = latestState.storageTanks;
      if (matchedTank) {
        await persistMutation('storageTanks', matchedTank.id, 'update', {
          currentBookVolumeLiters: tankAfter,
          ...(isDelivery && computedWacAfter !== undefined
            ? { currentWacPhp: computedWacAfter }
            : {}),
          updatedAt: now,
        });
        updatedStorageTanks = latestState.storageTanks.map((t) =>
          t.id === matchedTank.id
            ? {
                ...t,
                currentBookVolumeLiters: tankAfter,
                ...(isDelivery && computedWacAfter !== undefined
                  ? { currentWacPhp: computedWacAfter }
                  : {}),
              }
            : t
        );
      }

      const aggregateDepotWac =
        isDelivery && computedWacAfter !== undefined
          ? computeAggregateDepotWacFromTanks({
              depotId: depot.id,
              fuelType: log.fuelType,
              storageTanks: updatedStorageTanks,
              fallbackWacPhp: computedWacAfter,
            })
          : undefined;

      const depotUpdate =
        log.fuelType === 'gasoline'
          ? {
              gasolineCurrentLiters: depotAfter,
              ...(aggregateDepotWac !== undefined
                ? { gasolinePricePerLiter: aggregateDepotWac }
                : {}),
              lastDipVerifiedAt: now,
              lastDipVerifiedBy: verifiedApproverName,
              updatedAt: now,
            }
          : {
              dieselCurrentLiters: depotAfter,
              ...(aggregateDepotWac !== undefined
                ? { dieselPricePerLiter: aggregateDepotWac }
                : {}),
              lastDipVerifiedAt: now,
              lastDipVerifiedBy: verifiedApproverName,
              updatedAt: now,
            };
      await persistMutation('depots', depot.id, 'update', depotUpdate);

      await appendAudit(
        isDelivery ? 'INVENTORY_DELIVERY_VERIFIED' : 'INVENTORY_ADJUSTMENT_VERIFIED',
        'inventoryLog',
        log.id,
        `GSO Head ${verifiedApproverName} verified ${isDelivery ? 'fuel delivery' : 'dipstick variance adjustment'} ${log.referenceNumber}${matchedTank ? ` on ${matchedTank.tankCode}` : ''} (${log.litersDelta > 0 ? '+' : ''}${log.litersDelta.toFixed(1)} L${isDelivery && computedWacAfter !== undefined ? `, Tank WAC PHP ${computedWacAfter.toFixed(4)}/L` : ''}).`,
        {
          category: 'transaction',
          details: [
            log.gsoTransactionCode ? `Tx Code: ${log.gsoTransactionCode}` : '',
            `Depot: ${depot.name}`,
            matchedTank ? `Tank: ${matchedTank.tankCode}` : '',
            `Fuel Class: ${log.fuelType.toUpperCase()}`,
            `Type: ${log.transactionType.replace(/_/g, ' ')}`,
            `Delta: ${log.litersDelta > 0 ? '+' : ''}${log.litersDelta.toFixed(1)} L`,
            `Tank Balance: ${tankBefore.toLocaleString()} L -> ${tankAfter.toLocaleString()} L`,
            isDelivery && computedWacAfter !== undefined
              ? `Tank WAC: PHP ${currentWac.toFixed(4)}/L -> PHP ${computedWacAfter.toFixed(4)}/L`
              : `Effected Tank WAC: PHP ${currentWac.toFixed(4)}/L`,
            `GSO Head Approver: ${verifiedApproverName}`,
          ]
            .filter(Boolean)
            .join(' | '),
        }
      );
    },
    [currentUser.role, envMode, persistMutation, appendAudit]
  );

  // 5. Fleet CRUD (Registration allowed for Admin & GSO Head; Edit/Delete gated via Admin-assigned canEdit / canDelete)
  const saveVehicle = useCallback(
    async (
      vehicleData: Omit<FleetVehicle, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
      existingId?: string
    ) => {
      const now = new Date().toISOString();
      if (existingId) {
        if (!canUserEditRecords(currentUser)) {
          throw new Error('Only System Administrator or users with Edit permission can modify existing fleet records.');
        }
        await persistMutation('vehicles', existingId, 'update', {
          ...vehicleData,
          updatedAt: now,
        });
        await appendAudit(
          'VEHICLE_UPDATED',
          'vehicle',
          existingId,
          `Updated fleet record ${vehicleData.plateNumber} (${vehicleData.makeModel}).`
        );
      } else {
        if (!canRegisterFleetUnit(currentUser.role)) {
          throw new Error('Only System Administrator and GSO Head can register fleet units.');
        }
        const id = makeId('veh');
        const newVeh: FleetVehicle = {
          ...vehicleData,
          id,
          ownerId: firebaseUser?.uid ?? currentUser.uid,
          createdAt: now,
          updatedAt: now,
        };
        await persistMutation('vehicles', id, 'set', newVeh as unknown as Record<string, unknown>);
        await appendAudit(
          'VEHICLE_CREATED',
          'vehicle',
          id,
          `Registered fleet unit ${newVeh.plateNumber} (${newVeh.makeModel}) under ${newVeh.office}.`
        );
      }
    },
    [firebaseUser?.uid, currentUser, persistMutation, appendAudit]
  );

  const deleteVehicle = useCallback(
    async (vehicle: FleetVehicle) => {
      await persistMutation('vehicles', vehicle.id, 'delete');
      await appendAudit(
        'VEHICLE_DELETED',
        'vehicle',
        vehicle.id,
        `Deleted fleet unit ${vehicle.plateNumber} (${vehicle.makeModel}).`
      );
    },
    [persistMutation, appendAudit]
  );

  // 5b. PMC Project Registry CRUD (PMC Staff & System Administrator)
  const savePmcProject = useCallback(
    async (
      projectData: Omit<PmcProject, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
      existingId?: string
    ) => {
      const now = new Date().toISOString();
      if (existingId) {
        await persistMutation('pmcProjects', existingId, 'update', {
          ...projectData,
          updatedAt: now,
        });
        await appendAudit(
          'PMC_PROJECT_UPDATED',
          'pmcProject',
          existingId,
          `Updated PMC project ${projectData.aipCode} (${projectData.projectName}) — Approval Year ${projectData.approvalYear}, Fuel POW PHP ${projectData.fuelComponentAmountPhp.toFixed(2)}.`
        );
      } else {
        const id = makeId('pmc');
        const newProject: PmcProject = {
          ...projectData,
          id,
          ownerId: firebaseUser?.uid ?? currentUser.uid,
          createdAt: now,
          updatedAt: now,
        };
        await persistMutation(
          'pmcProjects',
          id,
          'set',
          newProject as unknown as Record<string, unknown>
        );
        await appendAudit(
          'PMC_PROJECT_CREATED',
          'pmcProject',
          id,
          `Registered PMC project ${newProject.aipCode} (${newProject.projectName}) — Approval Year ${newProject.approvalYear}, Fuel POW PHP ${newProject.fuelComponentAmountPhp.toFixed(2)}.`
        );
      }
    },
    [firebaseUser?.uid, currentUser.uid, persistMutation, appendAudit]
  );

  const deletePmcProject = useCallback(
    async (project: PmcProject) => {
      await persistMutation('pmcProjects', project.id, 'delete');
      await appendAudit(
        'PMC_PROJECT_DELETED',
        'pmcProject',
        project.id,
        `Deleted PMC project ${project.aipCode} (${project.projectName}).`
      );
    },
    [persistMutation, appendAudit]
  );

  const deleteWorkPlan = useCallback(
    async (workPlan: WorkPlan) => {
      const linkedTickets = activeData.tripTickets.filter((t) => t.workPlanId === workPlan.id);
      for (const tt of linkedTickets) {
        await persistMutation('tripTickets', tt.id, 'delete');
      }
      await persistMutation('workPlans', workPlan.id, 'delete');
      await appendAudit(
        'WORKPLAN_DELETED',
        'workPlan',
        workPlan.id,
        `Deleted ${getWorkPlanDisplayLabel(workPlan)} and ${linkedTickets.length} embedded trip ticket(s).`
      );
    },
    [activeData.tripTickets, persistMutation, appendAudit]
  );

  const updateWorkPlanAdmin = useCallback(
    async (workPlanId: string, updates: Partial<WorkPlan>) => {
      const targetPlan = activeData.workPlans.find((w) => w.id === workPlanId);
      if (targetPlan && !canUserEditWorkPlanRecord(currentUser, targetPlan)) {
        throw new Error(
          targetPlan.requestType === 'single_trip'
            ? 'Single Trip Ticket edit permission is deactivated for this user account.'
            : 'Edit permission is required to modify this record.'
        );
      }
      await persistMutation('workPlans', workPlanId, 'update', {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
      await appendAudit(
        'WORKPLAN_EDITED',
        'workPlan',
        workPlanId,
        `Modified work plan ${workPlanId}.`
      );
    },
    [activeData.workPlans, currentUser, persistMutation, appendAudit]
  );

  const applySavedUserImmediately = useCallback(
    (savedUser: UserAccount) => {
      const normalizedEmail = savedUser.email.trim().toLowerCase();
      const upsertIntoSnapshot = (prev: LocalSnapshotState): LocalSnapshotState => {
        const idx = prev.users.findIndex(
          (u) =>
            u.uid === savedUser.uid ||
            (normalizedEmail.length > 0 && u.email.trim().toLowerCase() === normalizedEmail)
        );
        const nextUsers = [...prev.users];
        if (idx >= 0) {
          nextUsers[idx] = { ...nextUsers[idx], ...savedUser };
        } else {
          nextUsers.unshift(savedUser);
        }
        return { ...prev, users: nextUsers };
      };

      const nextSandbox = upsertIntoSnapshot(sandboxStateRef.current);
      const nextLive = upsertIntoSnapshot(liveStateRef.current);
      sandboxStateRef.current = nextSandbox;
      liveStateRef.current = nextLive;
      setSandboxState(nextSandbox);
      setLiveState(nextLive);
      saveLocalState(SANDBOX_STORAGE_KEY, nextSandbox);
      saveLocalState(LIVE_CACHE_STORAGE_KEY, nextLive);

      const matchesProfile = (profile: UserAccount | null): boolean =>
        Boolean(
          profile &&
            (profile.uid === savedUser.uid ||
              (normalizedEmail.length > 0 &&
                profile.email.trim().toLowerCase() === normalizedEmail))
        );

      setAuthenticatedUser((prev) => {
        if (!matchesProfile(prev)) return prev;
        const merged: UserAccount = { ...prev!, ...savedUser };
        writeCachedAuthProfile(merged);
        return merged;
      });
      setLiveUserProfile((prev) => {
        if (!matchesProfile(prev)) return prev;
        const merged: UserAccount = { ...prev!, ...savedUser };
        writeCachedAuthProfile(merged);
        return merged;
      });

      if (
        savedUser.active &&
        savedUser.role === sandboxActiveRole &&
        savedUser.department.trim().toLowerCase() === resolvedSandboxDepartment.trim().toLowerCase()
      ) {
        setSelectedSandboxUserUid(savedUser.uid);
      }
    },
    [sandboxActiveRole, resolvedSandboxDepartment]
  );

  // 6. Admin User Creation, Edit, Delete & RBAC Management (Always synced to /users + /invites + /credentialLogins)
  const createUserAccount = useCallback(
    async (input: {
      username: string;
      password: string;
      email: string;
      displayName: string;
      role: UserRole;
      department: string;
      positionTitle: string;
      canEdit: boolean;
      canDelete: boolean;
      canSwitchToLive: boolean;
      canRequestSingleTrip: boolean;
      gsoVerificationCode?: string;
    }) => {
      const now = new Date().toISOString();
      const cleanUsername = normalizeUsernameInput(input.username).slice(0, 64);
      if (cleanUsername.length < 2) {
        throw new Error('User Account Name must be at least 2 characters.');
      }
      if (!input.password || input.password.length < 6) {
        throw new Error('Assigned Password must be at least 6 characters.');
      }
      const cleanDisplayName = input.displayName.trim().slice(0, 120);
      if (cleanDisplayName.length < 2) {
        throw new Error('Full Name must be at least 2 characters.');
      }
      const cleanDepartment = input.department.trim().slice(0, 120);
      if (cleanDepartment.length < 2) {
        throw new Error('Department Concerned must be at least 2 characters.');
      }

      const cleanEmail = input.email.trim().toLowerCase() || `${cleanUsername}@baiscity.gov.ph`;
      const emailKey = normalizeEmailToId(cleanEmail || cleanUsername) || makeId('usr');
      const allKnownUsers = deduplicateUsersByEmail([
        ...liveStateRef.current.users,
        ...sandboxStateRef.current.users,
      ]);
      const existingByEmail = allKnownUsers.find(
        (u) => u.email.trim().toLowerCase() === cleanEmail
      );

      const targetUid = existingByEmail ? existingByEmail.uid : emailKey;
      const gsoCodeValidation = validateGsoHeadVerificationCode({
        role: input.role,
        code: input.gsoVerificationCode,
        existingUsers: allKnownUsers,
        excludeUid: targetUid,
      });
      if (!gsoCodeValidation.valid) {
        throw new Error(gsoCodeValidation.error || 'Invalid GSO Head Verification Code.');
      }

      const userDoc: UserAccount = {
        uid: targetUid,
        username: cleanUsername,
        passwordHash: hashPassword(input.password),
        email: cleanEmail,
        displayName: cleanDisplayName,
        role: input.role,
        department: cleanDepartment,
        positionTitle: input.positionTitle.trim().slice(0, 120) || 'Staff',
        canEdit: input.role === 'admin' ? true : input.canEdit,
        canDelete: input.role === 'admin' ? true : input.canDelete,
        canSwitchToLive: input.role === 'admin' ? true : input.canSwitchToLive,
        canRequestSingleTrip: input.role === 'admin' ? true : input.canRequestSingleTrip,
        ...(input.role === 'gso_head' && gsoCodeValidation.normalizedCode
          ? { gsoVerificationCode: gsoCodeValidation.normalizedCode }
          : {}),
        active: true,
        createdBy: existingByEmail?.createdBy || firebaseUser?.uid || currentUser.uid,
        createdAt: existingByEmail?.createdAt || now,
        updatedAt: now,
      };
      applySavedUserImmediately(userDoc);
      await persistMutation('users', targetUid, 'set', userDoc as unknown as Record<string, unknown>);

      if (firebaseUser && effectiveOnline) {
        const invitePayload = buildInvitePayloadFromUser(userDoc, firebaseUser.uid);
        if (invitePayload && typeof invitePayload.id === 'string') {
          try {
            await setDoc(doc(db, 'invites', invitePayload.id), invitePayload);
          } catch (err) {
            console.warn('Invite write skipped:', err);
          }
        }
        try {
          await syncCredentialLoginDocs(userDoc, firebaseUser.uid, existingByEmail);
        } catch (err) {
          console.warn('CredentialLogin write skipped:', err);
        }
      }

      await appendAudit(
        'USER_CREATED',
        'user',
        targetUid,
        `Created user ${userDoc.username} (${userDoc.email}) with role ${userDoc.role}, edit=${userDoc.canEdit}, delete=${userDoc.canDelete}, singleTrip=${userDoc.canRequestSingleTrip}, liveSwitch=${userDoc.canSwitchToLive}, dept=${userDoc.department}${userDoc.role === 'gso_head' ? ', gsoHeadCodeAssigned=true' : ''}.`
      );
    },
    [
      currentUser.uid,
      firebaseUser,
      effectiveOnline,
      applySavedUserImmediately,
      persistMutation,
      syncCredentialLoginDocs,
      appendAudit,
    ]
  );

  const updateUserAccount = useCallback(
    async (
      uid: string,
      updates: {
        username: string;
        password?: string;
        email: string;
        displayName: string;
        role: UserRole;
        department: string;
        positionTitle: string;
        canEdit: boolean;
        canDelete: boolean;
        canSwitchToLive: boolean;
        canRequestSingleTrip: boolean;
        gsoVerificationCode?: string;
      }
    ) => {
      const now = new Date().toISOString();
      const cleanEmail = updates.email.trim().toLowerCase();
      const cleanUsername = normalizeUsernameInput(updates.username).slice(0, 64);
      if (cleanUsername.length < 2) {
        throw new Error('User Account Name must be at least 2 characters.');
      }
      if (updates.password && updates.password.trim().length > 0 && updates.password.length < 6) {
        throw new Error('Reset Password must be at least 6 characters.');
      }
      const cleanDisplayName = updates.displayName.trim().slice(0, 120);
      if (cleanDisplayName.length < 2) {
        throw new Error('Full Name must be at least 2 characters.');
      }
      const cleanDepartment = updates.department.trim().slice(0, 120);
      if (cleanDepartment.length < 2) {
        throw new Error('Department Concerned must be at least 2 characters.');
      }

      const allKnownUsers = deduplicateUsersByEmail([
        ...liveStateRef.current.users,
        ...sandboxStateRef.current.users,
      ]);
      const gsoCodeValidation = validateGsoHeadVerificationCode({
        role: updates.role,
        code: updates.gsoVerificationCode,
        existingUsers: allKnownUsers,
        excludeUid: uid,
      });
      if (!gsoCodeValidation.valid) {
        throw new Error(gsoCodeValidation.error || 'Invalid GSO Head Verification Code.');
      }

      const previousUser =
        liveStateRef.current.users.find((u) => u.uid === uid) ??
        sandboxStateRef.current.users.find((u) => u.uid === uid) ??
        null;

      const resolvedPasswordHash =
        updates.password && updates.password.trim().length > 0
          ? hashPassword(updates.password)
          : previousUser?.passwordHash;

      const mergedUser: UserAccount = {
        uid,
        email: cleanEmail || previousUser?.email || `${cleanUsername}@baiscity.gov.ph`,
        username: cleanUsername,
        ...(resolvedPasswordHash ? { passwordHash: resolvedPasswordHash } : {}),
        displayName: cleanDisplayName,
        role: updates.role,
        department: cleanDepartment,
        positionTitle: updates.positionTitle.trim().slice(0, 120) || 'Staff',
        canEdit: updates.role === 'admin' ? true : updates.canEdit,
        canDelete: updates.role === 'admin' ? true : updates.canDelete,
        canSwitchToLive: updates.role === 'admin' ? true : updates.canSwitchToLive,
        canRequestSingleTrip: updates.role === 'admin' ? true : updates.canRequestSingleTrip,
        ...(updates.role === 'gso_head' && gsoCodeValidation.normalizedCode
          ? { gsoVerificationCode: gsoCodeValidation.normalizedCode }
          : {}),
        active: previousUser?.active ?? true,
        createdBy: previousUser?.createdBy || firebaseUser?.uid || currentUser.uid,
        createdAt: previousUser?.createdAt || now,
        updatedAt: now,
      };

      // Immediately effect updated RBAC permissions across both Sandbox & Live + active session
      // Use 'set' so removing gsoVerificationCode on role change cleanly strips the field from Firestore & local state.
      applySavedUserImmediately(mergedUser);
      await persistMutation('users', uid, 'set', mergedUser as unknown as Record<string, unknown>);

      if (firebaseUser && effectiveOnline && mergedUser.email) {
        const invitePayload = buildInvitePayloadFromUser(mergedUser, firebaseUser.uid);
        if (invitePayload && typeof invitePayload.id === 'string') {
          try {
            await setDoc(doc(db, 'invites', invitePayload.id), invitePayload);
          } catch (err) {
            console.warn('Invite sync on user update skipped:', err);
          }
        }
        try {
          await syncCredentialLoginDocs(mergedUser, firebaseUser.uid, previousUser);
        } catch (err) {
          console.warn('CredentialLogin sync on user update skipped:', err);
        }
      }

      await appendAudit(
        'USER_UPDATED',
        'user',
        uid,
        `Admin updated user ${mergedUser.username} (${mergedUser.department}) — role=${mergedUser.role}, edit=${mergedUser.canEdit}, delete=${mergedUser.canDelete}, singleTrip=${mergedUser.canRequestSingleTrip}, liveSwitch=${mergedUser.canSwitchToLive}${mergedUser.role === 'gso_head' ? ', gsoHeadCodeAssigned=true' : ''}.`
      );
    },
    [
      currentUser.uid,
      firebaseUser,
      effectiveOnline,
      applySavedUserImmediately,
      persistMutation,
      syncCredentialLoginDocs,
      appendAudit,
    ]
  );

  const deleteUserAccount = useCallback(
    async (user: UserAccount) => {
      await persistMutation('users', user.uid, 'delete');
      setSelectedSandboxUserUid((prev) => (prev === user.uid ? null : prev));
      if (firebaseUser && effectiveOnline) {
        const emailId = normalizeEmailToId(user.email);
        if (emailId) {
          if (emailId !== user.uid) {
            await deleteDoc(doc(db, 'users', emailId)).catch(() => {});
          }
          await deleteDoc(doc(db, 'invites', emailId)).catch(() => {});
        }
        if (user.passwordHash) {
          const oldPayloads = buildCredentialLoginPayloadsFromUser(user, firebaseUser.uid);
          for (const credPayload of oldPayloads) {
            await deleteDoc(doc(db, 'credentialLogins', credPayload.id)).catch(() => {});
          }
        }
      }
      await appendAudit(
        'USER_DELETED',
        'user',
        user.uid,
        `Admin deleted user account ${user.username || user.email}.`
      );
    },
    [firebaseUser, effectiveOnline, persistMutation, appendAudit]
  );

  const toggleUserActive = useCallback(
    async (user: UserAccount) => {
      const nextActive = !user.active;
      const now = new Date().toISOString();
      const updatedUser: UserAccount = { ...user, active: nextActive, updatedAt: now };
      applySavedUserImmediately(updatedUser);
      await persistMutation('users', user.uid, 'update', {
        active: nextActive,
        updatedAt: now,
      });
      if (firebaseUser && effectiveOnline) {
        const invitePayload = buildInvitePayloadFromUser(updatedUser, firebaseUser.uid);
        if (invitePayload && typeof invitePayload.id === 'string') {
          await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true }).catch(
            () => {}
          );
        }
        await syncCredentialLoginDocs(updatedUser, firebaseUser.uid).catch(() => {});
        const emailId = normalizeEmailToId(user.email);
        if (emailId && emailId !== user.uid) {
          await updateDoc(doc(db, 'users', emailId), {
            active: nextActive,
            updatedAt: now,
          }).catch(() => {});
        }
      }
      await appendAudit(
        'USER_STATUS_TOGGLED',
        'user',
        user.uid,
        `Set user ${user.username || user.email} active status to ${nextActive}.`
      );
    },
    [
      firebaseUser,
      effectiveOnline,
      applySavedUserImmediately,
      persistMutation,
      syncCredentialLoginDocs,
      appendAudit,
    ]
  );

  // 7. Purge Sandbox Records & Re-seed Sandbox (Synchronized to Firestore environments/sandbox)
  const purgeSandboxRecords = useCallback(async () => {
    const now = new Date().toISOString();
    const freshDepot: FuelDepot = {
      id: 'depot_gso_central',
      name: 'GSO Central Fuel Depot',
      location: 'Bais City Hall Compound, Brgy. Hangyad',
      gasolineCapacityLiters: 15000,
      gasolineCurrentLiters: 15000,
      gasolinePricePerLiter: 64.5,
      dieselCapacityLiters: 30000,
      dieselCurrentLiters: 30000,
      dieselPricePerLiter: 58.2,
      reorderThresholdPct: 25,
      updatedAt: now,
    };
    const purgeLog: AuditLog = {
      id: makeId('aud'),
      actorUid: firebaseUser?.uid ?? currentUser.uid,
      actorEmail: currentUser.email,
      actorRole: currentUser.role,
      department: currentUser.department,
      action: 'SANDBOX_PURGED',
      entityType: 'environment',
      entityId: 'sandbox',
      summary: 'Purged all practice records in Sandbox database.',
      createdAt: now,
    };

    setSandboxState((prev) => ({
      users: prev.users.length > 0 ? prev.users : [...SEED_USERS],
      depots: [freshDepot],
      storageTanks: [],
      vehicles: [],
      pmcProjects: [],
      workPlans: [],
      tripTickets: [],
      inventoryLogs: [],
      auditLogs: [purgeLog],
      reportUtilities: normalizeReportUtilitiesConfig(prev.reportUtilities),
    }));

    setSyncQueue((prev) => prev.filter((q) => (q.envMode ?? 'live') !== 'sandbox'));

    if (firebaseUser && effectiveOnline) {
      const cols = ['tripTickets', 'workPlans', 'vehicles', 'pmcProjects', 'storageTanks', 'inventoryLogs', 'depots', 'auditLogs'] as const;
      for (const colName of cols) {
        try {
          const snap = await getDocs(collection(db, `environments/sandbox/${colName}`));
          if (!snap.empty) {
            const batch = writeBatch(db);
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        } catch (err) {
          console.warn(`Sandbox purge cleanup failed for ${colName}:`, err);
        }
      }
      await setDoc(doc(db, 'environments/sandbox/depots', freshDepot.id), freshDepot).catch(
        () => {}
      );
      await setDoc(
        doc(db, 'environments/sandbox/auditLogs', purgeLog.id),
        prepareFirestoreRecordPayload(purgeLog as unknown as Record<string, unknown>, firebaseUser.uid, {
          isCreate: true,
          collection: 'auditLogs',
        })
      ).catch(() => {});
    }
  }, [firebaseUser, effectiveOnline, currentUser]);

  const restoreSandboxDemoData = useCallback(async () => {
    const restored = getInitialSeedState();
    const unifiedUsers = deduplicateUsersByEmail([
      ...sandboxStateRef.current.users,
      ...liveStateRef.current.users,
      ...SEED_USERS,
    ]);
    setSandboxState({
      ...restored,
      users: unifiedUsers,
      reportUtilities: normalizeReportUtilitiesConfig(sandboxStateRef.current.reportUtilities),
    });

    if (firebaseUser && effectiveOnline) {
      const envPrefix = 'environments/sandbox';
      const writeSeeds = async <T extends { id: string }>(colName: string, items: T[]) => {
        for (const item of items) {
          await setDoc(
            doc(db, `${envPrefix}/${colName}`, item.id),
            prepareFirestoreRecordPayload(item as unknown as Record<string, unknown>, firebaseUser.uid, {
              isCreate: true,
              collection: colName,
            })
          ).catch((err) => console.warn(`Restore seed ${colName}/${item.id} skipped:`, err));
        }
      };
      await writeSeeds('depots', restored.depots);
      await writeSeeds('storageTanks', restored.storageTanks);
      await writeSeeds('vehicles', restored.vehicles);
      await writeSeeds('pmcProjects', restored.pmcProjects);
      await writeSeeds('workPlans', restored.workPlans);
      await writeSeeds('tripTickets', restored.tripTickets);
      await writeSeeds('inventoryLogs', restored.inventoryLogs);
      await writeSeeds('auditLogs', restored.auditLogs);
      setSyncNotice('Restored Sandbox baseline records and synchronized to Cloud.');
      setTimeout(() => setSyncNotice(null), 4000);
    }
    await appendAudit(
      'SANDBOX_DEMO_RESTORED',
      'environment',
      'sandbox',
      'Restored Sandbox practice environment to official baseline demonstration records.',
      {
        category: 'system',
        details: 'Environment: SANDBOX | Action: Baseline Demo Restore',
        envOverride: 'sandbox',
      }
    );
  }, [firebaseUser, effectiveOnline, appendAudit]);

  const seedLiveBaselineData = useCallback(async () => {
    if (!firebaseUser || envMode !== 'live') return;
    const batch = writeBatch(db);
    for (const depot of SEED_DEPOTS) {
      batch.set(doc(db, 'environments/live/depots', depot.id), depot);
    }
    for (const tank of SEED_STORAGE_TANKS) {
      batch.set(doc(db, 'environments/live/storageTanks', tank.id), {
        ...tank,
        ownerId: firebaseUser.uid,
      });
    }
    for (const veh of SEED_VEHICLES) {
      batch.set(doc(db, 'environments/live/vehicles', veh.id), {
        ...veh,
        ownerId: firebaseUser.uid,
      });
    }
    await batch.commit();
    await appendAudit(
      'LIVE_BASELINE_SEEDED',
      'environment',
      'live',
      'Initialized Bais City GSO Depots, UST Storage Tanks, and Fleet Registry baseline in Live Firestore.'
    );
  }, [firebaseUser, envMode, appendAudit]);

  const saveReportUtilitiesConfig = useCallback(
    async (
      draftConfig: Partial<ReportUtilitiesConfig>
    ): Promise<{ ok: boolean; error?: string; config?: ReportUtilitiesConfig }> => {
      if (!canManageReportUtilities(currentUser.role)) {
        return {
          ok: false,
          error: 'Only System Administrators are authorized to modify Report Utilities settings.',
        };
      }

      const now = new Date().toISOString();
      const normalized = normalizeReportUtilitiesConfig({
        ...draftConfig,
        id: 'report_utilities',
        updatedBy: (currentUser.displayName || currentUser.email || 'System Administrator').slice(
          0,
          128
        ),
        updatedAt: now,
      });

      const targetEnv: EnvironmentMode = envMode;
      const updateState = (prev: LocalSnapshotState): LocalSnapshotState => ({
        ...prev,
        reportUtilities: normalized,
      });

      if (targetEnv === 'sandbox') {
        setSandboxState((prev) => {
          const next = updateState(prev);
          saveLocalState(SANDBOX_STORAGE_KEY, next);
          return next;
        });
      } else {
        setLiveState((prev) => {
          const next = updateState(prev);
          saveLocalState(LIVE_CACHE_STORAGE_KEY, next);
          return next;
        });
      }

      if (!effectiveOnline || !firebaseUser) {
        setSyncQueue((prev) => [
          ...prev.filter(
            (q) =>
              !(
                (q.envMode ?? 'live') === targetEnv &&
                q.collection === 'settings' &&
                q.docId === 'report_utilities'
              )
          ),
          {
            id: makeId('sync'),
            envMode: targetEnv,
            collection: 'settings',
            docId: 'report_utilities',
            operation: 'set',
            payload: normalized as unknown as Record<string, unknown>,
            createdAt: now,
          },
        ]);
      } else {
        try {
          await setDoc(doc(db, `environments/${targetEnv}/settings`, 'report_utilities'), normalized);
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.WRITE,
            `environments/${targetEnv}/settings/report_utilities`
          );
        }
      }

      await appendAudit(
        'REPORT_UTILITIES_UPDATED',
        'settings',
        'report_utilities',
        'Updated system-wide Report Utilities preview and full report layout sequence.'
      );

      setSyncNotice('Report Utilities layout saved and applied retroactively across the system.');
      setTimeout(() => setSyncNotice(null), 4000);

      return { ok: true, config: normalized };
    },
    [currentUser, envMode, effectiveOnline, firebaseUser, appendAudit]
  );

  const deduplicatedUsers = useMemo(
    () => deduplicateUsersByEmail(activeData.users),
    [activeData.users]
  );

  const normalizedReportUtilities = useMemo(
    () => normalizeReportUtilitiesConfig(activeData.reportUtilities),
    [activeData.reportUtilities]
  );

  const normalizedData = useMemo(
    () => ({
      ...activeData,
      users: deduplicatedUsers,
      reportUtilities: normalizedReportUtilities,
    }),
    [activeData, deduplicatedUsers, normalizedReportUtilities]
  );

  return {
    envMode,
    setEnvMode: changeEnvMode,
    firebaseUser,
    authReady,
    authenticatedUser,
    isAuthenticated: isAuthenticatedSession,
    initialSection: bootAuth.section,
    sessionExpiredNotice,
    googleAuthError,
    clearSessionExpiredNotice: () => setSessionExpiredNotice(null),
    persistActiveSection,
    loginWithCredentials,
    logout,
    isOnline: effectiveOnline,
    simulatedOffline,
    setSimulatedOffline,
    firestoreReachable,
    syncQueue,
    syncNotice,
    flushSyncQueue,
    currentUser,
    sandboxActiveRole,
    setSandboxActiveRole,
    sandboxActiveDepartment: resolvedSandboxDepartment,
    setSandboxActiveDepartment,
    sandboxPreviewDepartmentOptions,
    sandboxPreviewMatchingUsers,
    selectedSandboxUserUid,
    setSelectedSandboxUserUid,
    data: normalizedData,
    reportUtilities: normalizedReportUtilities,
    visibleWorkPlans,
    visibleTickets,
    visibleVehicles,
    signInWithGoogle,
    signOutFirebase,
    createWorkPlanWithTickets,
    submitTabletopApproval,
    dispenseTripTicket,
    recordDepotTransaction,
    verifyPendingAdjustment,
    saveDepotInfo,
    saveStorageTank,
    deleteStorageTank,
    recordTankDipReading,
    saveVehicle,
    deleteVehicle,
    savePmcProject,
    deletePmcProject,
    deleteWorkPlan,
    updateWorkPlanAdmin,
    createUserAccount,
    updateUserAccount,
    deleteUserAccount,
    toggleUserActive,
    purgeSandboxRecords,
    restoreSandboxDemoData,
    seedLiveBaselineData,
    saveReportUtilitiesConfig,
  };
}
