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
  signInWithGoogle,
  signOutFirebase,
  testFirestoreConnection,
} from '../lib/firebase';
import {
  SEED_AUDIT_LOGS,
  SEED_DEPOTS,
  SEED_INVENTORY_LOGS,
  SEED_TRIP_TICKETS,
  SEED_USERS,
  SEED_VEHICLES,
  SEED_WORK_PLANS,
} from '../data/seedData';
import {
  AuditLog,
  EnvironmentMode,
  FleetVehicle,
  FuelDepot,
  FuelType,
  InventoryLog,
  SyncQueueItem,
  TripTicket,
  UserAccount,
  UserRole,
  WorkPlan,
} from '../types/fuel';
import {
  canAccessDepartmentRecord,
  computeSingleDispenseOutcome,
  evaluateTabletopApproval,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getRemainingInactivityMs,
  hashPassword,
  hasValidPumpReadingProof,
  INACTIVITY_TIMEOUT_MS,
  isSessionExpired,
  MAX_TICKETS_PER_WORKPLAN,
  parsePersistedSession,
  PersistedSessionState,
} from '../utils/fuelEngine';

interface LocalSnapshotState {
  users: UserAccount[];
  depots: FuelDepot[];
  vehicles: FleetVehicle[];
  workPlans: WorkPlan[];
  tripTickets: TripTicket[];
  inventoryLogs: InventoryLog[];
  auditLogs: AuditLog[];
}

const SANDBOX_STORAGE_KEY = 'bais_fuel_sandbox_v2';
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
    vehicles: [...SEED_VEHICLES],
    workPlans: [...SEED_WORK_PLANS],
    tripTickets: [...SEED_TRIP_TICKETS],
    inventoryLogs: [...SEED_INVENTORY_LOGS],
    auditLogs: [...SEED_AUDIT_LOGS],
  };
}

function loadLocalState(key: string): LocalSnapshotState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return getInitialSeedState();
    const parsed = JSON.parse(raw) as Partial<LocalSnapshotState>;
    return {
      users: parsed.users && parsed.users.length > 0 ? parsed.users : [...SEED_USERS],
      depots: parsed.depots ?? [],
      vehicles: parsed.vehicles ?? [],
      workPlans: parsed.workPlans ?? [],
      tripTickets: parsed.tripTickets ?? [],
      inventoryLogs: parsed.inventoryLogs ?? [],
      auditLogs: parsed.auditLogs ?? [],
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
  const [sandboxActiveRole, setSandboxActiveRole] = useState<UserRole>(bootAuth.role);
  const [sandboxActiveDepartment, setSandboxActiveDepartment] = useState<string>(bootAuth.dept);
  const [liveUserProfile, setLiveUserProfile] = useState<UserAccount | null>(
    bootAuth.envMode === 'live' ? bootAuth.user : null
  );
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const activeSectionRef = useRef<string>(bootAuth.section || 'dashboard');
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastActivityWriteRef = useRef<number>(Date.now());

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

  // Persist sandbox state locally
  useEffect(() => {
    saveLocalState(SANDBOX_STORAGE_KEY, sandboxState);
  }, [sandboxState]);

  useEffect(() => {
    saveSyncQueue(syncQueue);
  }, [syncQueue]);

  // Firebase Auth listener + Admin bootstrap
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
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

      setFirebaseUser(user);
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);
          let resolvedProfile: UserAccount | null = null;
          if (userSnap.exists()) {
            resolvedProfile = userSnap.data() as UserAccount;
          } else if (
            user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase() &&
            user.emailVerified
          ) {
            const now = new Date().toISOString();
            await setDoc(doc(db, 'admins', user.uid), {
              uid: user.uid,
              email: user.email,
              grantedAt: now,
            });
            resolvedProfile = {
              uid: user.uid,
              username: 'admin',
              email: user.email,
              displayName: user.displayName || 'Bais Internal Audit Admin',
              role: 'admin',
              department: 'Internal Audit Service',
              positionTitle: 'System Administrator',
              canEdit: true,
              canDelete: true,
              active: true,
              createdBy: 'system',
              createdAt: now,
              updatedAt: now,
            };
            await setDoc(userDocRef, resolvedProfile);
          } else if (user.email) {
            const q = query(collection(db, 'users'), where('email', '==', user.email));
            const snap = await getDocs(q);
            if (!snap.empty) {
              resolvedProfile = snap.docs[0].data() as UserAccount;
            } else {
              resolvedProfile = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName || user.email,
                role: 'requester',
                department: 'City Engineering Office',
                canEdit: false,
                canDelete: false,
                active: true,
                createdBy: 'self',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            }
          }
          if (resolvedProfile) {
            const nowMs = Date.now();
            lastActivityAtRef.current = nowMs;
            lastActivityWriteRef.current = nowMs;
            setSessionExpiredNotice(null);
            setLiveUserProfile(resolvedProfile);
            setAuthenticatedUser(resolvedProfile);
            setEnvMode('live');
            writeCachedAuthProfile(resolvedProfile);
            writePersistedSession({
              uid: resolvedProfile.uid,
              envMode: 'live',
              sandboxActiveRole: resolvedProfile.role,
              sandboxActiveDepartment: resolvedProfile.department,
              activeSection: activeSectionRef.current || 'dashboard',
              lastActivityAt: nowMs,
            });
          }
        } catch (err) {
          console.warn('Profile bootstrap check:', err);
        }
      } else {
        setLiveUserProfile(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Real-time Firestore listeners when authenticated in Live mode
  useEffect(() => {
    if (!authReady || !firebaseUser || envMode !== 'live') return;

    const envPrefix = `environments/live`;
    const unsubs: Array<() => void> = [];

    const attach = <T,>(
      colName: keyof LocalSnapshotState,
      firestoreColPath: string
    ) => {
      const ref = collection(db, firestoreColPath);
      const unsub = onSnapshot(
        ref,
        (snapshot) => {
          const rows = snapshot.docs.map((d) => d.data() as T);
          setLiveState((prev) => {
            const next = { ...prev, [colName]: rows };
            saveLocalState(LIVE_CACHE_STORAGE_KEY, next);
            return next;
          });
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, firestoreColPath);
        }
      );
      unsubs.push(unsub);
    };

    attach<FuelDepot>('depots', `${envPrefix}/depots`);
    attach<FleetVehicle>('vehicles', `${envPrefix}/vehicles`);
    attach<WorkPlan>('workPlans', `${envPrefix}/workPlans`);
    attach<TripTicket>('tripTickets', `${envPrefix}/tripTickets`);
    attach<InventoryLog>('inventoryLogs', `${envPrefix}/inventoryLogs`);
    attach<AuditLog>('auditLogs', `${envPrefix}/auditLogs`);

    if (liveUserProfile?.role === 'admin' || firebaseUser.email === BOOTSTRAPPED_ADMIN_EMAIL) {
      attach<UserAccount>('users', 'users');
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, firebaseUser, envMode, liveUserProfile?.role]);

  // Flush offline sync queue automatically when online & authenticated in Live mode
  const flushSyncQueue = useCallback(async () => {
    if (!effectiveOnline || !firebaseUser || syncQueue.length === 0) return;

    const remaining: SyncQueueItem[] = [];
    let syncedCount = 0;

    for (const item of syncQueue) {
      const colPath =
        item.collection === 'users' ? 'users' : `environments/live/${item.collection}`;
      const docRef = doc(db, colPath, item.docId);
      try {
        if (item.operation === 'set' && item.payload) {
          await setDoc(docRef, item.payload);
        } else if (item.operation === 'update' && item.payload) {
          await updateDoc(docRef, item.payload);
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
      setSyncNotice(`Synced ${syncedCount} offline record${syncedCount > 1 ? 's' : ''} to Firebase Cloud.`);
      setTimeout(() => setSyncNotice(null), 4000);
    }
  }, [effectiveOnline, firebaseUser, syncQueue]);

  useEffect(() => {
    if (effectiveOnline && firebaseUser && syncQueue.length > 0 && envMode === 'live') {
      flushSyncQueue();
    }
  }, [effectiveOnline, firebaseUser, syncQueue.length, envMode, flushSyncQueue]);

  const activeData = envMode === 'live' ? liveState : sandboxState;

  // Active User Context (Authenticated User + Sandbox Admin Role Preview)
  const currentUser: UserAccount = useMemo(() => {
    if (envMode === 'live' && firebaseUser && liveUserProfile) {
      return liveUserProfile;
    }
    if (authenticatedUser) {
      // Allow an authenticated Admin in Sandbox to preview other roles via sidebar tester
      if (authenticatedUser.role === 'admin' && sandboxActiveRole !== 'admin') {
        return {
          ...authenticatedUser,
          displayName: `${authenticatedUser.displayName} (${sandboxActiveRole.replace(/_/g, ' ')})`,
          role: sandboxActiveRole,
          department: sandboxActiveDepartment,
        };
      }
      return authenticatedUser;
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
  }, [envMode, firebaseUser, liveUserProfile, authenticatedUser, sandboxActiveRole, sandboxActiveDepartment]);

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

  // Unified Persistence Helper
  const persistMutation = useCallback(
    async (
      col: SyncQueueItem['collection'],
      docId: string,
      operation: SyncQueueItem['operation'],
      payload?: Record<string, unknown>
    ) => {
      if (envMode === 'sandbox') {
        setSandboxState((prev) => {
          const list = [...(prev[col] as Array<{ id?: string; uid?: string }>)];
          const matchKey = col === 'users' ? 'uid' : 'id';
          const idx = list.findIndex((item) => item[matchKey] === docId);

          if (operation === 'delete') {
            if (idx >= 0) list.splice(idx, 1);
          } else if (operation === 'set' && payload) {
            if (idx >= 0) list[idx] = payload as { id?: string; uid?: string };
            else list.unshift(payload as { id?: string; uid?: string });
          } else if (operation === 'update' && payload && idx >= 0) {
            list[idx] = { ...list[idx], ...payload };
          }
          return { ...prev, [col]: list };
        });
        return;
      }

      setLiveState((prev) => {
        const list = [...(prev[col] as Array<{ id?: string; uid?: string }>)];
        const matchKey = col === 'users' ? 'uid' : 'id';
        const idx = list.findIndex((item) => item[matchKey] === docId);

        if (operation === 'delete') {
          if (idx >= 0) list.splice(idx, 1);
        } else if (operation === 'set' && payload) {
          if (idx >= 0) list[idx] = payload as { id?: string; uid?: string };
          else list.unshift(payload as { id?: string; uid?: string });
        } else if (operation === 'update' && payload && idx >= 0) {
          list[idx] = { ...list[idx], ...payload };
        }
        const next = { ...prev, [col]: list };
        saveLocalState(LIVE_CACHE_STORAGE_KEY, next);
        return next;
      });

      if (!effectiveOnline || !firebaseUser) {
        setSyncQueue((prev) => [
          ...prev,
          {
            id: makeId('sync'),
            collection: col,
            docId,
            operation,
            payload,
            createdAt: new Date().toISOString(),
          },
        ]);
        setSyncNotice('Offline entry saved locally. Will auto-sync to Firebase when online.');
        return;
      }

      const colPath = col === 'users' ? 'users' : `environments/live/${col}`;
      const docRef = doc(db, colPath, docId);
      try {
        if (operation === 'set' && payload) {
          await setDoc(docRef, payload);
        } else if (operation === 'update' && payload) {
          await updateDoc(docRef, payload);
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
    async (action: string, entityType: string, entityId: string, summary: string) => {
      const log: AuditLog = {
        id: makeId('aud'),
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        department: currentUser.department,
        action,
        entityType,
        entityId,
        summary,
        createdAt: new Date().toISOString(),
      };
      await persistMutation('auditLogs', log.id, 'set', log as unknown as Record<string, unknown>);
    },
    [currentUser, persistMutation]
  );

  const isAuthenticatedSession = Boolean(authenticatedUser || (envMode === 'live' && firebaseUser));

  // Credential Authentication (Username & Password assigned by Administrator)
  const loginWithCredentials = useCallback(
    (username: string, password: string): { ok: boolean; user?: UserAccount; error?: string } => {
      const cleanUser = username.trim().toLowerCase();
      if (!cleanUser || !password) {
        return { ok: false, error: 'Enter both Account Name and Password.' };
      }

      const candidatePool = [
        ...sandboxState.users,
        ...liveState.users,
      ];
      const matched = candidatePool.find(
        (u) =>
          (u.username && u.username.toLowerCase() === cleanUser) ||
          u.email.toLowerCase() === cleanUser
      );

      if (!matched) {
        return { ok: false, error: 'Account Name not recognized. Contact your Administrator.' };
      }
      if (!matched.active) {
        return { ok: false, error: 'This user account is suspended. Contact your Administrator.' };
      }
      if (!matched.passwordHash || hashPassword(password) !== matched.passwordHash) {
        return { ok: false, error: 'Invalid password for this account.' };
      }

      const nowMs = Date.now();
      lastActivityAtRef.current = nowMs;
      lastActivityWriteRef.current = nowMs;
      activeSectionRef.current = 'dashboard';
      setSessionExpiredNotice(null);
      setAuthenticatedUser(matched);
      setSandboxActiveRole(matched.role);
      setSandboxActiveDepartment(matched.department);
      writeCachedAuthProfile(matched);
      writePersistedSession({
        uid: matched.uid,
        envMode,
        sandboxActiveRole: matched.role,
        sandboxActiveDepartment: matched.department,
        activeSection: 'dashboard',
        lastActivityAt: nowMs,
      });
      return { ok: true, user: matched };
    },
    [sandboxState.users, liveState.users, envMode]
  );

  const logout = useCallback(async () => {
    clearPersistedSessionStorage();
    setSessionExpiredNotice(null);
    setAuthenticatedUser(null);
    setLiveUserProfile(null);
    setSandboxActiveRole('admin');
    activeSectionRef.current = 'dashboard';
    if (firebaseUser) {
      await signOutFirebase();
    }
  }, [firebaseUser]);

  const expireSessionDueToInactivity = useCallback(async () => {
    clearPersistedSessionStorage();
    setAuthenticatedUser(null);
    setLiveUserProfile(null);
    setSandboxActiveRole('admin');
    activeSectionRef.current = 'dashboard';
    setSessionExpiredNotice(
      'Your session expired after 10 minutes of inactivity. Please sign in again.'
    );
    if (firebaseUser) {
      await signOutFirebase().catch(() => {});
    }
  }, [firebaseUser]);

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

      const now = new Date().toISOString();
      const wpId = makeId('wp');
      const sequentialControlNo = generateNextWorkPlanNumber(activeData.workPlans);
      const sequentialTicketNos = generateNextTripTicketNumbers(
        activeData.tripTickets,
        ticketDrafts.length
      );
      const totalRequested = ticketDrafts.reduce((sum, t) => sum + t.requestedLiters, 0);

      const newPlan: WorkPlan = {
        ...planInput,
        controlNumber: sequentialControlNo,
        id: wpId,
        status: 'pending_approval',
        totalRequestedLiters: Math.round(totalRequested * 10) / 10,
        totalApprovedLiters: 0,
        totalDispensedLiters: 0,
        ownerId: currentUser.uid,
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
          department: planInput.department,
          projectTitle: planInput.projectTitle,
          approvedLiters: 0,
          dispensedLiters: 0,
          forfeitedLiters: 0,
          servedOnce: false,
          status: 'pending',
          ownerId: currentUser.uid,
          createdAt: now,
          updatedAt: now,
        };
        createdTickets.push(ticket);
        await persistMutation('tripTickets', ttId, 'set', ticket as unknown as Record<string, unknown>);
      }

      await appendAudit(
        'WORKPLAN_CREATED',
        'workPlan',
        wpId,
        `Submitted Weekly Work Plan ${newPlan.controlNumber} (${newPlan.department}) with ${ticketDrafts.length} trip ticket(s) totaling ${newPlan.totalRequestedLiters.toFixed(1)} L.`
      );
      return { workPlan: newPlan, tickets: createdTickets };
    },
    [activeData.workPlans, activeData.tripTickets, currentUser.uid, persistMutation, appendAudit]
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
        approvedBy: currentUser.displayName,
        updatedAt: now,
      });

      await appendAudit(
        'TABLETOP_APPROVAL_SUBMITTED',
        'workPlan',
        workPlan.id,
        `Tabletop assessment on ${workPlan.controlNumber}: ${totalApproved.toFixed(1)} L approved of ${workPlan.totalRequestedLiters.toFixed(1)} L requested.`
      );
    },
    [currentUser.displayName, persistMutation, appendAudit]
  );

  // 3. GSO Once-Daily Dispensing (Forfeits unserved balance immediately + requires pump photo proof)
  const dispenseTripTicket = useCallback(
    async (
      ticket: TripTicket,
      actualDispensedLiters: number,
      pumpProof?: { dataUrl: string; fileName: string }
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
      const unitPrice =
        ticket.fuelType === 'gasoline' ? depot.gasolinePricePerLiter : depot.dieselPricePerLiter;
      const cleanPhotoName = (pumpProof.fileName || 'pump-reading.jpg').trim().slice(0, 160);

      await persistMutation('tripTickets', ticket.id, 'update', {
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
        fuelType: ticket.fuelType,
        transactionType: 'dispense',
        litersDelta: -outcome.dispensedLiters,
        balanceBefore: currentStock,
        balanceAfter: outcome.newDepotBalance,
        referenceNumber: ticket.ticketNumber,
        notes: `Once-daily dispense to ${ticket.plateNumber} (${ticket.driverName}). Pump proof: ${cleanPhotoName}. Unserved balance forfeited: ${outcome.forfeitedLiters.toFixed(1)} L.`,
        approvalStatus: 'verified',
        gsoApproverName: currentUser.displayName,
        digitalVerificationCode: `DISP-${ticket.ticketNumber.slice(-5)}`,
        verifiedAt: now,
        ownerId: currentUser.uid,
        createdAt: now,
      };
      await persistMutation('inventoryLogs', invLog.id, 'set', invLog as unknown as Record<string, unknown>);

      await appendAudit(
        'FUEL_DISPENSED_ONCE',
        'tripTicket',
        ticket.id,
        `Dispensed ${outcome.dispensedLiters.toFixed(1)} L ${ticket.fuelType} for ${ticket.ticketNumber} (${ticket.plateNumber}) with pump photo proof (${cleanPhotoName}). Forfeited balance: ${outcome.forfeitedLiters.toFixed(1)} L.`
      );

      return { ok: true, outcome };
    },
    [activeData.depots, activeData.workPlans, currentUser, persistMutation, appendAudit]
  );

  // 4. Depot Delivery & Pre-Fill Dipping Shrinkage/Overage Adjustment
  const recordDepotTransaction = useCallback(
    async (params: {
      depot: FuelDepot;
      fuelType: FuelType;
      transactionType: 'delivery' | 'shrinkage_adjustment' | 'overage_adjustment';
      litersAmount: number;
      physicalDipLiters?: number;
      referenceNumber: string;
      notes: string;
      gsoApproverName?: string;
      digitalVerificationCode?: string;
    }) => {
      const now = new Date().toISOString();
      const { depot, fuelType, transactionType, litersAmount } = params;
      const before =
        fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters;
      const capacity =
        fuelType === 'gasoline' ? depot.gasolineCapacityLiters : depot.dieselCapacityLiters;

      const delta =
        transactionType === 'shrinkage_adjustment'
          ? -Math.abs(litersAmount)
          : Math.abs(litersAmount);
      const after = Math.max(0, Math.min(capacity, Math.round((before + delta) * 10) / 10));

      const isVerifiedNow = Boolean(
        params.digitalVerificationCode && params.digitalVerificationCode.trim().length >= 4
      );

      const log: InventoryLog = {
        id: makeId('inv'),
        depotId: depot.id,
        depotName: depot.name,
        fuelType,
        transactionType,
        litersDelta: delta,
        balanceBefore: before,
        balanceAfter: isVerifiedNow ? after : before,
        physicalDipLiters: params.physicalDipLiters,
        referenceNumber: params.referenceNumber,
        notes: params.notes,
        approvalStatus: isVerifiedNow ? 'verified' : 'pending_gso_approval',
        gsoApproverName: isVerifiedNow ? params.gsoApproverName || currentUser.displayName : undefined,
        digitalVerificationCode: isVerifiedNow ? params.digitalVerificationCode : undefined,
        verifiedAt: isVerifiedNow ? now : undefined,
        ownerId: currentUser.uid,
        createdAt: now,
      };

      await persistMutation('inventoryLogs', log.id, 'set', log as unknown as Record<string, unknown>);

      if (isVerifiedNow) {
        const tankUpdate =
          fuelType === 'gasoline'
            ? {
                gasolineCurrentLiters: after,
                lastDipVerifiedAt: now,
                lastDipVerifiedBy: params.gsoApproverName || currentUser.displayName,
                updatedAt: now,
              }
            : {
                dieselCurrentLiters: after,
                lastDipVerifiedAt: now,
                lastDipVerifiedBy: params.gsoApproverName || currentUser.displayName,
                updatedAt: now,
              };
        await persistMutation('depots', depot.id, 'update', tankUpdate);
      }

      await appendAudit(
        `DEPOT_${transactionType.toUpperCase()}`,
        'inventoryLog',
        log.id,
        `${depot.name} ${fuelType} ${transactionType.replace(/_/g, ' ')}: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} L (${log.approvalStatus}).`
      );
    },
    [currentUser, persistMutation, appendAudit]
  );

  const verifyPendingAdjustment = useCallback(
    async (log: InventoryLog, gsoApproverName: string, digitalVerificationCode: string) => {
      const depot = activeData.depots.find((d) => d.id === log.depotId);
      if (!depot) return;
      const now = new Date().toISOString();
      const before =
        log.fuelType === 'gasoline' ? depot.gasolineCurrentLiters : depot.dieselCurrentLiters;
      const capacity =
        log.fuelType === 'gasoline' ? depot.gasolineCapacityLiters : depot.dieselCapacityLiters;
      const after = Math.max(0, Math.min(capacity, Math.round((before + log.litersDelta) * 10) / 10));

      await persistMutation('inventoryLogs', log.id, 'update', {
        approvalStatus: 'verified',
        balanceAfter: after,
        gsoApproverName,
        digitalVerificationCode,
        verifiedAt: now,
      });

      const tankUpdate =
        log.fuelType === 'gasoline'
          ? {
              gasolineCurrentLiters: after,
              lastDipVerifiedAt: now,
              lastDipVerifiedBy: gsoApproverName,
              updatedAt: now,
            }
          : {
              dieselCurrentLiters: after,
              lastDipVerifiedAt: now,
              lastDipVerifiedBy: gsoApproverName,
              updatedAt: now,
            };
      await persistMutation('depots', depot.id, 'update', tankUpdate);

      await appendAudit(
        'INVENTORY_ADJUSTMENT_VERIFIED',
        'inventoryLog',
        log.id,
        `GSO personnel ${gsoApproverName} digitally verified ${log.referenceNumber} (${log.litersDelta > 0 ? '+' : ''}${log.litersDelta.toFixed(1)} L).`
      );
    },
    [activeData.depots, persistMutation, appendAudit]
  );

  // 5. Fleet CRUD (Permission-gated via Admin-assigned canEdit / canDelete)
  const saveVehicle = useCallback(
    async (
      vehicleData: Omit<FleetVehicle, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
      existingId?: string
    ) => {
      const now = new Date().toISOString();
      if (existingId) {
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
        const id = makeId('veh');
        const newVeh: FleetVehicle = {
          ...vehicleData,
          id,
          ownerId: currentUser.uid,
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
    [currentUser.uid, persistMutation, appendAudit]
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
        `Deleted work plan ${workPlan.controlNumber} and ${linkedTickets.length} embedded trip ticket(s).`
      );
    },
    [activeData.tripTickets, persistMutation, appendAudit]
  );

  const updateWorkPlanAdmin = useCallback(
    async (workPlanId: string, updates: Partial<WorkPlan>) => {
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
    [persistMutation, appendAudit]
  );

  // 6. Admin User Creation, Edit, Delete & RBAC Management
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
    }) => {
      const now = new Date().toISOString();
      const cleanUsername = input.username.trim().toLowerCase();
      const cleanEmail = input.email.trim().toLowerCase() || `${cleanUsername}@baiscity.gov.ph`;
      const uid = normalizeEmailToId(cleanEmail || cleanUsername) || makeId('usr');
      const userDoc: UserAccount = {
        uid,
        username: cleanUsername,
        passwordHash: hashPassword(input.password),
        email: cleanEmail,
        displayName: input.displayName.trim(),
        role: input.role,
        department: input.department.trim(),
        positionTitle: input.positionTitle.trim(),
        canEdit: input.role === 'admin' ? true : input.canEdit,
        canDelete: input.role === 'admin' ? true : input.canDelete,
        active: true,
        createdBy: currentUser.uid,
        createdAt: now,
        updatedAt: now,
      };
      await persistMutation('users', uid, 'set', userDoc as unknown as Record<string, unknown>);

      if (envMode === 'live' && firebaseUser && effectiveOnline) {
        try {
          await setDoc(doc(db, 'invites', uid), {
            id: uid,
            email: userDoc.email,
            displayName: userDoc.displayName,
            role: userDoc.role,
            department: userDoc.department,
            positionTitle: userDoc.positionTitle || 'Staff',
            active: true,
            createdBy: currentUser.uid,
            createdAt: now,
          });
        } catch (err) {
          console.warn('Invite write skipped:', err);
        }
      }

      await appendAudit(
        'USER_CREATED',
        'user',
        uid,
        `Created user ${userDoc.username} (${userDoc.email}) with role ${userDoc.role}, edit=${userDoc.canEdit}, delete=${userDoc.canDelete}, dept=${userDoc.department}.`
      );
    },
    [currentUser.uid, envMode, firebaseUser, effectiveOnline, persistMutation, appendAudit]
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
      }
    ) => {
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        username: updates.username.trim().toLowerCase(),
        email: updates.email.trim().toLowerCase(),
        displayName: updates.displayName.trim(),
        role: updates.role,
        department: updates.department.trim(),
        positionTitle: updates.positionTitle.trim(),
        canEdit: updates.role === 'admin' ? true : updates.canEdit,
        canDelete: updates.role === 'admin' ? true : updates.canDelete,
        updatedAt: now,
      };
      if (updates.password && updates.password.trim().length > 0) {
        payload.passwordHash = hashPassword(updates.password);
      }

      await persistMutation('users', uid, 'update', payload);
      if (authenticatedUser?.uid === uid) {
        setAuthenticatedUser((prev) => (prev ? { ...prev, ...payload } as UserAccount : null));
      }

      await appendAudit(
        'USER_UPDATED',
        'user',
        uid,
        `Admin updated user ${String(payload.username)} (${String(payload.department)}).`
      );
    },
    [authenticatedUser?.uid, persistMutation, appendAudit]
  );

  const deleteUserAccount = useCallback(
    async (user: UserAccount) => {
      await persistMutation('users', user.uid, 'delete');
      await appendAudit(
        'USER_DELETED',
        'user',
        user.uid,
        `Admin deleted user account ${user.username || user.email}.`
      );
    },
    [persistMutation, appendAudit]
  );

  const toggleUserActive = useCallback(
    async (user: UserAccount) => {
      await persistMutation('users', user.uid, 'update', {
        active: !user.active,
        updatedAt: new Date().toISOString(),
      });
      await appendAudit(
        'USER_STATUS_TOGGLED',
        'user',
        user.uid,
        `Set user ${user.username || user.email} active status to ${!user.active}.`
      );
    },
    [persistMutation, appendAudit]
  );

  // 7. Purge Sandbox Records & Re-seed Sandbox
  const purgeSandboxRecords = useCallback(async () => {
    setSandboxState({
      users: [...SEED_USERS],
      depots: [
        {
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
          updatedAt: new Date().toISOString(),
        },
      ],
      vehicles: [],
      workPlans: [],
      tripTickets: [],
      inventoryLogs: [],
      auditLogs: [
        {
          id: makeId('aud'),
          actorUid: currentUser.uid,
          actorEmail: currentUser.email,
          actorRole: currentUser.role,
          department: currentUser.department,
          action: 'SANDBOX_PURGED',
          entityType: 'environment',
          entityId: 'sandbox',
          summary: 'Purged all practice records in Sandbox database.',
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }, [currentUser]);

  const restoreSandboxDemoData = useCallback(() => {
    setSandboxState(getInitialSeedState());
  }, []);

  const seedLiveBaselineData = useCallback(async () => {
    if (!firebaseUser || envMode !== 'live') return;
    const batch = writeBatch(db);
    for (const depot of SEED_DEPOTS) {
      batch.set(doc(db, 'environments/live/depots', depot.id), depot);
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
      'Initialized Bais City GSO Depots and Fleet Registry baseline in Live Firestore.'
    );
  }, [firebaseUser, envMode, appendAudit]);

  return {
    envMode,
    setEnvMode,
    firebaseUser,
    authReady,
    authenticatedUser,
    isAuthenticated: isAuthenticatedSession,
    initialSection: bootAuth.section,
    sessionExpiredNotice,
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
    sandboxActiveDepartment,
    setSandboxActiveDepartment,
    data: activeData,
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
    saveVehicle,
    deleteVehicle,
    deleteWorkPlan,
    updateWorkPlanAdmin,
    createUserAccount,
    updateUserAccount,
    deleteUserAccount,
    toggleUserActive,
    purgeSandboxRecords,
    restoreSandboxDemoData,
    seedLiveBaselineData,
  };
}
