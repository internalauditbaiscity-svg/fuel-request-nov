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
  authenticateLocalUserCredentials,
  buildInvitePayloadFromUser,
  canAccessDepartmentRecord,
  computeSingleDispenseOutcome,
  deduplicateUsersByEmail,
  evaluateTabletopApproval,
  generateNextTripTicketNumbers,
  generateNextWorkPlanNumber,
  getDefaultNavSection,
  getRemainingInactivityMs,
  hasCityWideAccess,
  hashPassword,
  hasValidPumpReadingProof,
  INACTIVITY_TIMEOUT_MS,
  isSessionExpired,
  MAX_TICKETS_PER_WORKPLAN,
  mergeClaimedUserProfile,
  parsePersistedSession,
  PersistedSessionState,
  prepareFirestoreRecordPayload,
  reconcileCollectionRecords,
  resolveEffectiveEnvironmentAfterGoogleAuth,
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

const SEED_DEPOT_TS = new Map(SEED_DEPOTS.map((d) => [d.id, d.updatedAt]));
const SEED_VEHICLE_TS = new Map(SEED_VEHICLES.map((v) => [v.id, v.updatedAt]));
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
  const [sandboxActiveRole, setSandboxActiveRole] = useState<UserRole>(bootAuth.role);
  const [sandboxActiveDepartment, setSandboxActiveDepartment] = useState<string>(bootAuth.dept);
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
      if (user) {
        const freshGoogleAttempt = googleSignInInitiatedRef.current;
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

  const syncUserAndInviteDoc = useCallback(
    async (user: UserAccount, actorUid: string, isCreate: boolean) => {
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
    },
    []
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
        if (item.operation === 'set' && item.payload) {
          const payload = prepareFirestoreRecordPayload(item.payload, firebaseUser.uid, {
            isCreate: true,
            collection: item.collection,
          });
          await setDoc(docRef, payload);
          if (item.collection === 'users') {
            const invitePayload = buildInvitePayloadFromUser(
              item.payload as unknown as UserAccount,
              firebaseUser.uid
            );
            if (invitePayload && typeof invitePayload.id === 'string') {
              await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
            }
          }
        } else if (item.operation === 'update' && item.payload) {
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
            const mergedUser = liveStateRef.current.users.find((u) => u.uid === item.docId) ??
              sandboxStateRef.current.users.find((u) => u.uid === item.docId);
            if (mergedUser) {
              const invitePayload = buildInvitePayloadFromUser(mergedUser, firebaseUser.uid);
              if (invitePayload && typeof invitePayload.id === 'string') {
                await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
              }
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
  }, [effectiveOnline, firebaseUser]);

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
        vehiclesSnap,
        plansSnap,
        ticketsSnap,
        invSnap,
        auditSnap,
        usersSnap,
      ] = await Promise.all([
        getDocs(collection(db, `${envPrefix}/depots`)),
        getDocs(collection(db, `${envPrefix}/vehicles`)),
        getDocs(collection(db, `${envPrefix}/workPlans`)),
        getDocs(collection(db, `${envPrefix}/tripTickets`)),
        getDocs(collection(db, `${envPrefix}/inventoryLogs`)),
        getDocs(collection(db, `${envPrefix}/auditLogs`)),
        getDocs(collection(db, 'users')),
      ]);

      const cloudDepots = depotsSnap.docs.map((d) => d.data() as FuelDepot);
      const cloudVehicles = vehiclesSnap.docs.map((d) => d.data() as FleetVehicle);
      const cloudPlans = plansSnap.docs.map((d) => d.data() as WorkPlan);
      const cloudTickets = ticketsSnap.docs.map((d) => d.data() as TripTicket);
      const cloudInv = invSnap.docs.map((d) => d.data() as InventoryLog);
      const cloudAudit = auditSnap.docs.map((d) => d.data() as AuditLog);
      const cloudUsers = usersSnap.docs.map((d) => d.data() as UserAccount);

      const sandboxEmpty =
        targetEnv === 'sandbox' &&
        cloudDepots.length === 0 &&
        cloudVehicles.length === 0 &&
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
      const vehiclesRec = reconcileCollectionRecords({
        localItems: localSnapshot.vehicles,
        cloudItems: cloudVehicles,
        keyField: 'id',
        cloudPurgeAt,
        seedUpdatedAtByKey: useSeedFilter ? SEED_VEHICLE_TS : undefined,
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

      // 1. Sync Users & Invites first
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
          await syncUserAndInviteDoc(mergedUsr, fbUser.uid, false);
          pushedCount += 1;
        } catch (err) {
          console.warn('User update sync skipped:', usr.uid, err);
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
      await pushEnvItems('vehicles', vehiclesRec.toCreate, true);
      await pushEnvItems('vehicles', vehiclesRec.toUpdate, false);
      await pushEnvItems('workPlans', plansRec.toCreate, true);
      await pushEnvItems('workPlans', plansRec.toUpdate, false);
      await pushEnvItems('tripTickets', ticketsRec.toCreate, true);
      await pushEnvItems('tripTickets', ticketsRec.toUpdate, false);
      await pushEnvItems('inventoryLogs', invRec.toCreate, true);
      await pushEnvItems('inventoryLogs', invRec.toUpdate, false);
      await pushEnvItems('auditLogs', auditRec.toCreate, true);

      const mergedUsers = deduplicateUsersByEmail(usersRec.merged);
      const nextState: LocalSnapshotState = {
        users: mergedUsers,
        depots: depotsRec.merged,
        vehicles: vehiclesRec.merged,
        workPlans: plansRec.merged,
        tripTickets: ticketsRec.merged,
        inventoryLogs: invRec.merged,
        auditLogs: auditRec.merged,
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
            setTargetEnvState((prev) => ({ ...prev, [colName]: rows }));
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, firestoreColPath);
          }
        );
        unsubs.push(unsub);
      };

      attach<FuelDepot>('depots', `${envPrefix}/depots`);
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
      if (cityWide) {
        attach<InventoryLog>('inventoryLogs', `${envPrefix}/inventoryLogs`);
      }

      if (isAdminUser) {
        attach<AuditLog>('auditLogs', `${envPrefix}/auditLogs`);
        attach<UserAccount>('users', 'users');
      }
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
          canSwitchToLive: false,
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

  // Unified Persistence Helper (Synchronizes BOTH Sandbox & Live + shared Users to Firestore)
  const persistMutation = useCallback(
    async (
      col: SyncQueueItem['collection'],
      docId: string,
      operation: SyncQueueItem['operation'],
      payload?: Record<string, unknown>
    ) => {
      const targetEnv: EnvironmentMode = envMode;
      const normalizedPayload =
        payload && firebaseUser && operation === 'set'
          ? prepareFirestoreRecordPayload(payload, firebaseUser.uid, {
              isCreate: true,
              collection: col,
            })
          : payload;

      const applyLocalListMutation = (prev: LocalSnapshotState): LocalSnapshotState => {
        const list = [...(prev[col] as Array<{ id?: string; uid?: string }>)];
        const matchKey = col === 'users' ? 'uid' : 'id';
        const idx = list.findIndex((item) => item[matchKey] === docId);

        if (operation === 'delete') {
          if (idx >= 0) list.splice(idx, 1);
        } else if (operation === 'set' && normalizedPayload) {
          if (idx >= 0) list[idx] = normalizedPayload as { id?: string; uid?: string };
          else list.unshift(normalizedPayload as { id?: string; uid?: string });
        } else if (operation === 'update' && normalizedPayload && idx >= 0) {
          list[idx] = { ...list[idx], ...normalizedPayload };
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
        setSyncNotice(
          !firebaseUser
            ? `Saved locally in ${targetEnv === 'sandbox' ? 'Sandbox' : 'Live'}. Sign in with Google to push changes to the deployed web app.`
            : 'Offline entry saved locally. Will auto-sync to Firebase when online.'
        );
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
    async (action: string, entityType: string, entityId: string, summary: string) => {
      const log: AuditLog = {
        id: makeId('aud'),
        actorUid: firebaseUser?.uid ?? currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        department: currentUser.department,
        action,
        entityType,
        entityId,
        summary: summary.slice(0, 400),
        createdAt: new Date().toISOString(),
      };
      await persistMutation('auditLogs', log.id, 'set', log as unknown as Record<string, unknown>);
    },
    [firebaseUser?.uid, currentUser, persistMutation]
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

  const connectGoogleForSync = useCallback(async () => {
    setGoogleAuthError(null);
    setSessionExpiredNotice(null);
    preserveEnvOnAuthRef.current = envMode;
    googleSignInInitiatedRef.current = true;
    try {
      return await firebaseSignInWithGoogle();
    } catch (err) {
      preserveEnvOnAuthRef.current = null;
      googleSignInInitiatedRef.current = false;
      throw err;
    }
  }, [envMode]);

  const triggerManualReconcile = useCallback(async () => {
    if (!firebaseUser || !liveUserProfile) return;
    await flushSyncQueue();
    const count = await reconcileEnvironmentToCloud(envMode, firebaseUser, liveUserProfile);
    if (count === 0) {
      setSyncNotice(`Cloud (${envMode.toUpperCase()} & User Credentials) is already up to date.`);
      setTimeout(() => setSyncNotice(null), 4000);
    }
  }, [envMode, firebaseUser, liveUserProfile, flushSyncQueue, reconcileEnvironmentToCloud]);

  // Credential Authentication (Username/Email & Password assigned by Administrator)
  const loginWithCredentials = useCallback(
    (username: string, password: string): { ok: boolean; user?: UserAccount; error?: string } => {
      setGoogleAuthError(null);
      const result = authenticateLocalUserCredentials({
        liveUsers: liveState.users,
        sandboxUsers: sandboxState.users,
        seedUsers: SEED_USERS,
        identifier: username,
        password,
      });

      if (!result.ok || !result.user) {
        return result;
      }

      const matched = result.user;
      const nowMs = Date.now();
      const defaultSection = getDefaultNavSection(matched.role);
      lastActivityAtRef.current = nowMs;
      lastActivityWriteRef.current = nowMs;
      activeSectionRef.current = defaultSection;
      setSessionExpiredNotice(null);
      setEnvMode('sandbox');
      setAuthenticatedUser(matched);
      setSandboxActiveRole(matched.role);
      setSandboxActiveDepartment(matched.department);
      writeCachedAuthProfile(matched);
      writePersistedSession({
        uid: matched.uid,
        envMode: 'sandbox',
        sandboxActiveRole: matched.role,
        sandboxActiveDepartment: matched.department,
        activeSection: defaultSection,
        lastActivityAt: nowMs,
      });
      return { ok: true, user: matched };
    },
    [sandboxState.users, liveState.users]
  );

  const logout = useCallback(async () => {
    clearPersistedSessionStorage();
    setGoogleAuthError(null);
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
      const explicitYearMatch = planInput.controlNumber?.match(/^WP-(\d{4})-/);
      const weekStartYearMatch = planInput.weekStart?.match(/^(\d{4})-/);
      const targetYear = explicitYearMatch
        ? Number(explicitYearMatch[1])
        : weekStartYearMatch
          ? Number(weekStartYearMatch[1])
          : new Date().getFullYear();
      const sequentialControlNo = generateNextWorkPlanNumber(activeData.workPlans, targetYear);
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

      await appendAudit(
        'WORKPLAN_CREATED',
        'workPlan',
        wpId,
        `Submitted Weekly Work Plan ${newPlan.controlNumber} (${newPlan.department}) with ${ticketDrafts.length} trip ticket(s) totaling ${newPlan.totalRequestedLiters.toFixed(1)} L.`
      );
      return { workPlan: newPlan, tickets: createdTickets };
    },
    [
      activeData.workPlans,
      activeData.tripTickets,
      firebaseUser?.uid,
      currentUser.uid,
      currentUser.role,
      currentUser.department,
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
        ownerId: firebaseUser?.uid ?? currentUser.uid,
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
    [activeData.depots, activeData.workPlans, firebaseUser?.uid, currentUser, persistMutation, appendAudit]
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
        ownerId: firebaseUser?.uid ?? currentUser.uid,
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
    [firebaseUser?.uid, currentUser.uid, persistMutation, appendAudit]
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

  // 6. Admin User Creation, Edit, Delete & RBAC Management (Always synced to /users + /invites regardless of Sandbox/Live)
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
    }) => {
      const now = new Date().toISOString();
      const cleanUsername = input.username.trim().toLowerCase();
      const cleanEmail = input.email.trim().toLowerCase() || `${cleanUsername}@baiscity.gov.ph`;
      const emailKey = normalizeEmailToId(cleanEmail || cleanUsername) || makeId('usr');
      const existingByEmail = deduplicateUsersByEmail([
        ...liveStateRef.current.users,
        ...sandboxStateRef.current.users,
      ]).find((u) => u.email.trim().toLowerCase() === cleanEmail);

      const targetUid = existingByEmail ? existingByEmail.uid : emailKey;
      const userDoc: UserAccount = {
        uid: targetUid,
        username: cleanUsername,
        passwordHash: hashPassword(input.password),
        email: cleanEmail,
        displayName: input.displayName.trim(),
        role: input.role,
        department: input.department.trim(),
        positionTitle: input.positionTitle.trim() || 'Staff',
        canEdit: input.role === 'admin' ? true : input.canEdit,
        canDelete: input.role === 'admin' ? true : input.canDelete,
        canSwitchToLive: input.role === 'admin' ? true : input.canSwitchToLive,
        active: true,
        createdBy: existingByEmail?.createdBy || firebaseUser?.uid || currentUser.uid,
        createdAt: existingByEmail?.createdAt || now,
        updatedAt: now,
      };
      await persistMutation('users', targetUid, 'set', userDoc as unknown as Record<string, unknown>);

      if (firebaseUser && effectiveOnline) {
        const invitePayload = buildInvitePayloadFromUser(userDoc, firebaseUser.uid);
        if (invitePayload && typeof invitePayload.id === 'string') {
          try {
            await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
          } catch (err) {
            console.warn('Invite write skipped:', err);
          }
        }
      }

      await appendAudit(
        'USER_CREATED',
        'user',
        targetUid,
        `Created user ${userDoc.username} (${userDoc.email}) with role ${userDoc.role}, edit=${userDoc.canEdit}, delete=${userDoc.canDelete}, liveSwitch=${userDoc.canSwitchToLive}, dept=${userDoc.department}.`
      );
    },
    [currentUser.uid, firebaseUser, effectiveOnline, persistMutation, appendAudit]
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
      }
    ) => {
      const now = new Date().toISOString();
      const cleanEmail = updates.email.trim().toLowerCase();
      const cleanUsername = updates.username.trim().toLowerCase();
      const payload: Record<string, unknown> = {
        username: cleanUsername,
        email: cleanEmail,
        displayName: updates.displayName.trim(),
        role: updates.role,
        department: updates.department.trim(),
        positionTitle: updates.positionTitle.trim() || 'Staff',
        canEdit: updates.role === 'admin' ? true : updates.canEdit,
        canDelete: updates.role === 'admin' ? true : updates.canDelete,
        canSwitchToLive: updates.role === 'admin' ? true : updates.canSwitchToLive,
        updatedAt: now,
      };
      if (updates.password && updates.password.trim().length > 0) {
        payload.passwordHash = hashPassword(updates.password);
      }

      await persistMutation('users', uid, 'update', payload);

      if (firebaseUser && effectiveOnline && cleanEmail) {
        const existingUser =
          liveStateRef.current.users.find((u) => u.uid === uid) ??
          sandboxStateRef.current.users.find((u) => u.uid === uid);
        const mergedUser: UserAccount = {
          uid,
          email: cleanEmail,
          username: cleanUsername,
          passwordHash:
            typeof payload.passwordHash === 'string'
              ? payload.passwordHash
              : existingUser?.passwordHash,
          displayName: String(payload.displayName),
          role: updates.role,
          department: String(payload.department),
          positionTitle: String(payload.positionTitle),
          canEdit: Boolean(payload.canEdit),
          canDelete: Boolean(payload.canDelete),
          canSwitchToLive: Boolean(payload.canSwitchToLive),
          active: existingUser?.active ?? true,
          createdBy: existingUser?.createdBy || firebaseUser.uid,
          createdAt: existingUser?.createdAt || now,
          updatedAt: now,
        };
        const invitePayload = buildInvitePayloadFromUser(mergedUser, firebaseUser.uid);
        if (invitePayload && typeof invitePayload.id === 'string') {
          try {
            await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true });
          } catch (err) {
            console.warn('Invite sync on user update skipped:', err);
          }
        }
      }

      if (authenticatedUser?.uid === uid) {
        setAuthenticatedUser((prev) => (prev ? ({ ...prev, ...payload } as UserAccount) : null));
      }

      await appendAudit(
        'USER_UPDATED',
        'user',
        uid,
        `Admin updated user ${String(payload.username)} (${String(payload.department)}).`
      );
    },
    [authenticatedUser?.uid, firebaseUser, effectiveOnline, persistMutation, appendAudit]
  );

  const deleteUserAccount = useCallback(
    async (user: UserAccount) => {
      await persistMutation('users', user.uid, 'delete');
      if (firebaseUser && effectiveOnline) {
        const emailId = normalizeEmailToId(user.email);
        if (emailId) {
          if (emailId !== user.uid) {
            await deleteDoc(doc(db, 'users', emailId)).catch(() => {});
          }
          await deleteDoc(doc(db, 'invites', emailId)).catch(() => {});
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
      await persistMutation('users', user.uid, 'update', {
        active: nextActive,
        updatedAt: now,
      });
      if (firebaseUser && effectiveOnline) {
        const invitePayload = buildInvitePayloadFromUser(
          { ...user, active: nextActive, updatedAt: now },
          firebaseUser.uid
        );
        if (invitePayload && typeof invitePayload.id === 'string') {
          await setDoc(doc(db, 'invites', invitePayload.id), invitePayload, { merge: true }).catch(
            () => {}
          );
        }
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
    [firebaseUser, effectiveOnline, persistMutation, appendAudit]
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
      vehicles: [],
      workPlans: [],
      tripTickets: [],
      inventoryLogs: [],
      auditLogs: [purgeLog],
    }));

    setSyncQueue((prev) => prev.filter((q) => (q.envMode ?? 'live') !== 'sandbox'));

    if (firebaseUser && effectiveOnline) {
      const cols = ['tripTickets', 'workPlans', 'vehicles', 'inventoryLogs', 'depots', 'auditLogs'] as const;
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
    setSandboxState({ ...restored, users: unifiedUsers });

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
      await writeSeeds('vehicles', restored.vehicles);
      await writeSeeds('workPlans', restored.workPlans);
      await writeSeeds('tripTickets', restored.tripTickets);
      await writeSeeds('inventoryLogs', restored.inventoryLogs);
      await writeSeeds('auditLogs', restored.auditLogs);
      setSyncNotice('Restored Sandbox baseline records and synchronized to Cloud.');
      setTimeout(() => setSyncNotice(null), 4000);
    }
  }, [firebaseUser, effectiveOnline]);

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

  const deduplicatedUsers = useMemo(
    () => deduplicateUsersByEmail(activeData.users),
    [activeData.users]
  );

  const normalizedData = useMemo(
    () => ({
      ...activeData,
      users: deduplicatedUsers,
    }),
    [activeData, deduplicatedUsers]
  );

  return {
    envMode,
    setEnvMode,
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
    connectGoogleForSync,
    reconcileNow: triggerManualReconcile,
    currentUser,
    sandboxActiveRole,
    setSandboxActiveRole,
    sandboxActiveDepartment,
    setSandboxActiveDepartment,
    data: normalizedData,
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
