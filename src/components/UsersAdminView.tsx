import { useState } from 'react';
import { Edit3, KeyRound, RefreshCw, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import {
  BAIS_DEPARTMENTS,
  FleetVehicle,
  ROLE_LABELS,
  UserAccount,
  UserRole,
} from '../types/fuel';
import { useEscapeClose } from '../hooks/useEscapeClose';
import {
  canManageUsers,
  generateDistinctGsoVerificationCode,
  getDepartmentMnemonic,
  getLocalIsoDate,
  GSO_OFFICE_DEPARTMENT,
  normalizeGsoVerificationCode,
  PMC_OFFICE_DEPARTMENT,
  TABLETOP_APPROVER_DEPARTMENT,
  USER_OFFICE_DEPARTMENT,
} from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface UsersAdminViewProps {
  users: UserAccount[];
  vehicles?: FleetVehicle[];
  currentUser: UserAccount;
  firebaseUser?: { email?: string | null } | null;
  onCreateUser: (input: {
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
  }) => Promise<void>;
  onUpdateUser: (
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
  ) => Promise<void>;
  onDeleteUser: (user: UserAccount) => Promise<void>;
  onToggleActive: (user: UserAccount) => Promise<void>;
}

export function UsersAdminView({
  users,
  vehicles = [],
  currentUser,
  firebaseUser,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onToggleActive,
}: UsersAdminViewProps) {
  const isAdmin = canManageUsers(currentUser.role);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Create form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('requester');
  const [department, setDepartment] = useState<string>('');
  const [positionTitle, setPositionTitle] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canSwitchToLive, setCanSwitchToLive] = useState(false);
  const [canRequestSingleTrip, setCanRequestSingleTrip] = useState(false);
  const [gsoVerificationCode, setGsoVerificationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Edit modal state
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('requester');
  const [editDepartment, setEditDepartment] = useState('');
  const [editPositionTitle, setEditPositionTitle] = useState('');
  const [editCanEdit, setEditCanEdit] = useState(false);
  const [editCanDelete, setEditCanDelete] = useState(false);
  const [editCanSwitchToLive, setEditCanSwitchToLive] = useState(false);
  const [editCanRequestSingleTrip, setEditCanRequestSingleTrip] = useState(false);
  const [editGsoVerificationCode, setEditGsoVerificationCode] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEscapeClose(
    Boolean(editingUser),
    () => {
      setEditingUser(null);
      setEditPassword('');
      setEditError(null);
    },
    3
  );

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-6 flex items-center gap-3 text-xs text-red-900">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <span>
          Access Denied: User Creation & RBAC administration are strictly restricted to administrators.
        </span>
      </div>
    );
  }

  const getLockedDepartmentForRole = (targetRole: UserRole): string | null => {
    if (targetRole === 'admin' || targetRole === 'auditor') return USER_OFFICE_DEPARTMENT;
    if (targetRole === 'approver') return TABLETOP_APPROVER_DEPARTMENT;
    return null;
  };

  const handleCreateRoleChange = (nextRole: UserRole) => {
    setRole(nextRole);
    if (nextRole === 'gso_head') {
      if (!gsoVerificationCode.trim()) {
        setGsoVerificationCode(generateDistinctGsoVerificationCode(users));
      }
    } else {
      setGsoVerificationCode('');
    }
    const locked = getLockedDepartmentForRole(nextRole);
    if (locked) {
      setDepartment(locked);
      return;
    }
    if (nextRole === 'gso_head' || nextRole === 'gso_dispenser') {
      if (
        !department.trim() ||
        department.trim().toLowerCase() === USER_OFFICE_DEPARTMENT.toLowerCase() ||
        department.trim().toLowerCase() === TABLETOP_APPROVER_DEPARTMENT.toLowerCase() ||
        department.trim().toLowerCase() === PMC_OFFICE_DEPARTMENT.toLowerCase()
      ) {
        setDepartment(GSO_OFFICE_DEPARTMENT);
      }
      return;
    }
    if (nextRole === 'pmc_staff') {
      if (
        !department.trim() ||
        department.trim().toLowerCase() === USER_OFFICE_DEPARTMENT.toLowerCase() ||
        department.trim().toLowerCase() === TABLETOP_APPROVER_DEPARTMENT.toLowerCase() ||
        department.trim().toLowerCase() === GSO_OFFICE_DEPARTMENT.toLowerCase()
      ) {
        setDepartment(PMC_OFFICE_DEPARTMENT);
      }
      return;
    }
    if (department.trim().toLowerCase() === USER_OFFICE_DEPARTMENT.toLowerCase()) {
      setDepartment('');
    }
  };

  const handleEditRoleChange = (nextRole: UserRole) => {
    setEditRole(nextRole);
    if (nextRole === 'gso_head') {
      if (!editGsoVerificationCode.trim()) {
        setEditGsoVerificationCode(
          editingUser?.gsoVerificationCode || generateDistinctGsoVerificationCode(users)
        );
      }
    } else {
      setEditGsoVerificationCode('');
    }
    const locked = getLockedDepartmentForRole(nextRole);
    if (locked) {
      setEditDepartment(locked);
      return;
    }
    if (nextRole === 'gso_head' || nextRole === 'gso_dispenser') {
      if (
        !editDepartment.trim() ||
        editDepartment.trim().toLowerCase() === USER_OFFICE_DEPARTMENT.toLowerCase() ||
        editDepartment.trim().toLowerCase() === TABLETOP_APPROVER_DEPARTMENT.toLowerCase() ||
        editDepartment.trim().toLowerCase() === PMC_OFFICE_DEPARTMENT.toLowerCase()
      ) {
        setEditDepartment(GSO_OFFICE_DEPARTMENT);
      }
      return;
    }
    if (nextRole === 'pmc_staff') {
      if (
        !editDepartment.trim() ||
        editDepartment.trim().toLowerCase() === USER_OFFICE_DEPARTMENT.toLowerCase() ||
        editDepartment.trim().toLowerCase() === TABLETOP_APPROVER_DEPARTMENT.toLowerCase() ||
        editDepartment.trim().toLowerCase() === GSO_OFFICE_DEPARTMENT.toLowerCase()
      ) {
        setEditDepartment(PMC_OFFICE_DEPARTMENT);
      }
      return;
    }
    if (editDepartment.trim().toLowerCase() === USER_OFFICE_DEPARTMENT.toLowerCase()) {
      setEditDepartment('');
    }
  };

  const departmentSuggestions = Array.from(
    new Set([
      ...BAIS_DEPARTMENTS,
      ...users.map((u) => u.department.trim()).filter(Boolean),
      ...vehicles.map((v) => v.office.trim()).filter(Boolean),
    ])
  ).filter((dept) => dept.trim().toLowerCase() !== USER_OFFICE_DEPARTMENT.toLowerCase());

  const createLockedDepartment = getLockedDepartmentForRole(role);
  const editLockedDepartment = getLockedDepartmentForRole(editRole);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setActionNotice(null);
    const cleanUsername = username.trim().replace(/^@+/, '');
    const resolvedDepartment = (createLockedDepartment ?? department).trim();
    if (!cleanUsername || !password.trim() || !displayName.trim() || !resolvedDepartment) return;
    setSubmitting(true);
    try {
      await onCreateUser({
        username: cleanUsername,
        password: password,
        email: email.trim() || `${cleanUsername.toLowerCase()}@baiscity.gov.ph`,
        displayName: displayName.trim(),
        role,
        department: resolvedDepartment,
        positionTitle: positionTitle.trim() || ROLE_LABELS[role],
        canEdit: role === 'admin' ? true : canEdit,
        canDelete: role === 'admin' ? true : canDelete,
        canSwitchToLive: role === 'admin' ? true : canSwitchToLive,
        canRequestSingleTrip: role === 'admin' ? true : canRequestSingleTrip,
        gsoVerificationCode:
          role === 'gso_head' ? normalizeGsoVerificationCode(gsoVerificationCode) : undefined,
      });
      setActionNotice(
        firebaseUser
          ? `User account "${cleanUsername.toLowerCase()}" provisioned and synced to Cloud.`
          : `User account "${cleanUsername.toLowerCase()}" created.`
      );
      setUsername('');
      setPassword('');
      setEmail('');
      setDisplayName('');
      setDepartment(createLockedDepartment ?? '');
      setPositionTitle('');
      setCanEdit(false);
      setCanDelete(false);
      setCanSwitchToLive(false);
      setCanRequestSingleTrip(false);
      setGsoVerificationCode(role === 'gso_head' ? generateDistinctGsoVerificationCode(users) : '');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create user account.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (u: UserAccount) => {
    setEditError(null);
    setEditingUser(u);
    setEditUsername(u.username || u.email.split('@')[0]);
    setEditPassword('');
    setEditEmail(u.email);
    setEditDisplayName(u.displayName);
    setEditRole(u.role);
    setEditDepartment(getLockedDepartmentForRole(u.role) ?? u.department);
    setEditPositionTitle(u.positionTitle || '');
    setEditCanEdit(u.role === 'admin' ? true : Boolean(u.canEdit));
    setEditCanDelete(u.role === 'admin' ? true : Boolean(u.canDelete));
    setEditCanSwitchToLive(u.role === 'admin' ? true : Boolean(u.canSwitchToLive));
    setEditCanRequestSingleTrip(u.role === 'admin' ? true : Boolean(u.canRequestSingleTrip));
    setEditGsoVerificationCode(u.role === 'gso_head' ? u.gsoVerificationCode || '' : '');
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditError(null);
    setEditUsername('');
    setEditPassword('');
    setEditEmail('');
    setEditDisplayName('');
    setEditDepartment('');
    setEditPositionTitle('');
    setEditCanEdit(false);
    setEditCanDelete(false);
    setEditCanSwitchToLive(false);
    setEditCanRequestSingleTrip(false);
    setEditGsoVerificationCode('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedEditDept = (editLockedDepartment ?? editDepartment).trim();
    if (!editingUser || !editUsername.trim() || !editDisplayName.trim() || !resolvedEditDept) {
      return;
    }
    setEditError(null);
    setEditSubmitting(true);
    try {
      const cleanEditUsername = editUsername.trim().replace(/^@+/, '');
      await onUpdateUser(editingUser.uid, {
        username: cleanEditUsername,
        password: editPassword.trim() || undefined,
        email: editEmail.trim(),
        displayName: editDisplayName.trim(),
        role: editRole,
        department: resolvedEditDept,
        positionTitle: editPositionTitle.trim() || ROLE_LABELS[editRole],
        canEdit: editRole === 'admin' ? true : editCanEdit,
        canDelete: editRole === 'admin' ? true : editCanDelete,
        canSwitchToLive: editRole === 'admin' ? true : editCanSwitchToLive,
        canRequestSingleTrip: editRole === 'admin' ? true : editCanRequestSingleTrip,
        gsoVerificationCode:
          editRole === 'gso_head'
            ? normalizeGsoVerificationCode(editGsoVerificationCode)
            : undefined,
      });
      setActionNotice(
        firebaseUser
          ? `Updated "${cleanEditUsername.toLowerCase()}" and synced credentials to Cloud.`
          : `Updated "${cleanEditUsername.toLowerCase()}".`
      );
      closeEditModal();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to save user changes.');
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* User Creation Form */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E6EBF2] pb-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#1B3B6F]" />
            <h2 className="font-display text-sm font-bold text-[#0B192C]">
              Create Departmental User, Credentials & RBAC Permissions
            </h2>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-900"
          >
            {formError}
          </div>
        )}

        {actionNotice && !formError && (
          <div
            role="status"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900"
          >
            {actionNotice}
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="usr-prep-date" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                Preparation Date (Pre-Assigned)
              </label>
              <input
                id="usr-prep-date"
                data-testid="users-preparation-date"
                type="date"
                readOnly
                value={getLocalIsoDate()}
                className="w-full rounded border border-[#D5DCE6] bg-[#F3F5F8] px-3 py-2 font-mono text-xs font-bold text-[#1B3B6F]"
              />
            </div>

            <div>
              <label htmlFor="usr-name" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                Full Name *
              </label>
              <input
                id="usr-name"
                type="text"
                required
                placeholder="e.g. Engr. Juan Dela Cruz"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
              />
            </div>

            <div>
              <label htmlFor="usr-account" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                User Account Name *
              </label>
              <input
                id="usr-account"
                type="text"
                required
                autoComplete="off"
                placeholder="e.g. jdelacruz"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 font-mono text-xs text-[#0B192C]"
              />
            </div>

            <div>
              <label htmlFor="usr-pass" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                Assigned Password *
              </label>
              <input
                id="usr-pass"
                type="password"
                required
                autoComplete="new-password"
                minLength={6}
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
              />
            </div>

            <div>
              <label htmlFor="usr-dept" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                Department Concerned *
              </label>
              <input
                id="usr-dept"
                type="text"
                list="bais-dept-suggestions"
                required
                readOnly={Boolean(createLockedDepartment)}
                placeholder="Enter office or department name"
                value={createLockedDepartment ?? department}
                onChange={(e) => setDepartment(e.target.value)}
                className={`w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C] ${
                  createLockedDepartment ? 'bg-[#F3F5F8] font-semibold text-[#1B3B6F]' : ''
                }`}
              />
              <datalist id="bais-dept-suggestions">
                {departmentSuggestions.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="usr-email" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                Official Email (Optional for Google SSO)
              </label>
              <input
                id="usr-email"
                type="email"
                placeholder="user@baiscity.gov.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
              />
            </div>

            <div>
              <label htmlFor="usr-role" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                System Role *
              </label>
              <select
                id="usr-role"
                value={role}
                onChange={(e) => handleCreateRoleChange(e.target.value as UserRole)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="usr-pos" className="block text-[11px] font-semibold text-[#334E73] mb-1">
                Designation / Position Title
              </label>
              <input
                id="usr-pos"
                type="text"
                placeholder="e.g. Administrative Officer II"
                value={positionTitle}
                onChange={(e) => setPositionTitle(e.target.value)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
              />
            </div>

            {role === 'gso_head' && (
              <div
                data-testid="create-gso-code-section"
                className="sm:col-span-2 lg:col-span-2 rounded border border-[#93C5FD] bg-[#EFF6FF] p-2.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="usr-gso-code"
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#1E3A5F]"
                  >
                    <KeyRound className="h-3.5 w-3.5 text-[#1B3B6F]" />
                    <span>GSO Head Distinct Verification Code *</span>
                  </label>
                  <button
                    type="button"
                    data-testid="generate-create-gso-code-btn"
                    onClick={() => setGsoVerificationCode(generateDistinctGsoVerificationCode(users))}
                    className="inline-flex items-center gap-1 rounded border border-[#93C5FD] bg-white px-2 py-0.5 text-[10px] font-bold text-[#1B3B6F] hover:bg-[#DBEAFE]"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Generate</span>
                  </button>
                </div>
                <input
                  id="usr-gso-code"
                  data-testid="create-gso-verification-code"
                  type="text"
                  required
                  autoComplete="off"
                  minLength={4}
                  maxLength={32}
                  placeholder="e.g. GSO-HD-9045"
                  value={gsoVerificationCode}
                  onChange={(e) => setGsoVerificationCode(e.target.value.toUpperCase())}
                  className="w-full rounded border border-[#93C5FD] bg-white px-3 py-2 font-mono text-xs font-bold uppercase text-[#0B192C]"
                />
                <p className="text-[10px] text-[#334E73]">
                  Unique to this GSO Head RBAC account (4–32 letters, numbers, or hyphens). Required for GSO Ledger verifications.
                </p>
              </div>
            )}

            <div className="flex flex-col justify-center gap-1.5 rounded border border-[#E6EBF2] bg-[#F9FAFC] px-3 py-2">
              <span className="text-[11px] font-semibold text-[#334E73]">Record & Environment Permissions</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={role === 'admin' ? true : canEdit}
                    disabled={role === 'admin'}
                    onChange={(e) => setCanEdit(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Can Edit</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={role === 'admin' ? true : canDelete}
                    disabled={role === 'admin'}
                    onChange={(e) => setCanDelete(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Can Delete</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="create-user-can-switch-live"
                    checked={role === 'admin' ? true : canSwitchToLive}
                    disabled={role === 'admin'}
                    onChange={(e) => setCanSwitchToLive(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Switch to Live</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="create-user-can-single-trip"
                    checked={role === 'admin' ? true : canRequestSingleTrip}
                    disabled={role === 'admin'}
                    onChange={(e) => setCanRequestSingleTrip(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Single Trip Ticket</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[#0B192C] px-5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50"
            >
              {submitting ? 'Provisioning...' : 'Create User Account'}
            </button>
          </div>
        </form>
      </section>

      {/* Preview-Gated Registered Users Table */}
      <RecordsPreviewGate
        title="Authorized Users & RBAC"
        description="Provisioned accounts, department scope, and RBAC permission flags."
        recordCount={users.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Users"
      >
        <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] sm:text-xs">
              <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                <tr>
                  <th className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    User
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Role
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Dept
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Perms
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Act
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {users.map((u) => {
                  const grantedFlags = [
                    (u.role === 'admin' || u.canEdit) && 'Edit',
                    (u.role === 'admin' || u.canDelete) && 'Del',
                    (u.role === 'admin' || u.canRequestSingleTrip) && 'Single',
                    (u.role === 'admin' || u.canSwitchToLive) && 'Live',
                  ].filter(Boolean) as string[];
                  return (
                    <tr key={u.uid} className="hover:bg-[#F9FAFC]">
                      <td className="px-1.5 py-1.5 sm:px-2.5">
                        <div className="font-semibold text-[#0B192C] leading-tight">{u.displayName}</div>
                        <div className="font-mono text-[10px] text-[#1B3B6F]">
                          @{u.username || u.email.split('@')[0]}
                        </div>
                      </td>
                      <td className="px-1.5 py-1.5 sm:px-2.5 font-medium text-[#1B3B6F] whitespace-nowrap">
                        <div>{ROLE_LABELS[u.role]}</div>
                        {u.role === 'gso_head' && u.gsoVerificationCode && (
                          <div
                            data-testid={`user-gso-code-${u.uid}`}
                            className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#0F172A]"
                          >
                            <KeyRound className="h-2.5 w-2.5 text-[#1B3B6F] shrink-0" />
                            <span>{u.gsoVerificationCode}</span>
                          </div>
                        )}
                      </td>
                      <td
                        className="px-1.5 py-1.5 sm:px-2.5 text-center font-mono font-bold text-[#0B192C] whitespace-nowrap"
                        title={u.department}
                      >
                        {getDepartmentMnemonic(u.department, vehicles)}
                      </td>
                      <td className="px-1.5 py-1.5 sm:px-2.5 font-mono text-[10px] text-[#334E73] whitespace-nowrap">
                        {grantedFlags.length > 0 ? grantedFlags.join(' · ') : 'Read-Only'}
                      </td>
                      <td className="px-1.5 py-1.5 sm:px-2.5 whitespace-nowrap">
                        <span
                          className={`font-semibold text-[11px] ${
                            u.active ? 'text-emerald-800' : 'text-red-700'
                          }`}
                        >
                          {u.active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5 sm:px-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          aria-label={`Edit user ${u.username || u.displayName}`}
                          className="mr-1 rounded border border-[#D5DCE6] bg-white p-1 text-[#334E73] hover:bg-[#F3F5F8]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleActive(u)}
                          className="mr-1 rounded border border-[#D5DCE6] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
                        >
                          {u.active ? 'Suspend' : 'Activate'}
                        </button>
                        {u.uid !== currentUser.uid && (
                          <button
                            type="button"
                            onClick={() => onDeleteUser(u)}
                            aria-label={`Delete user ${u.username || u.displayName}`}
                            className="rounded border border-[#D5DCE6] bg-white p-1 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </RecordsPreviewGate>

      {/* Admin Edit User Modal */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit User Account"
        >
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
          >
            <div className="flex items-start justify-between gap-4 bg-[#0B192C] px-5 py-3.5 text-white">
              <h2 className="font-display text-base font-bold">
                Edit User Account ({editingUser.username || editingUser.displayName})
              </h2>
              <button
                type="button"
                onClick={closeEditModal}
                aria-label="Close edit user dialog"
                className="inline-flex items-center justify-center rounded-md bg-[#334E73] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              {editError && (
                <div
                  role="alert"
                  className="sm:col-span-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900"
                >
                  {editError}
                </div>
              )}
              <div className="sm:col-span-2">
                <label htmlFor="edit-usr-prep-date" className="block font-semibold text-[#334E73] mb-1">
                  Preparation Date (Pre-Assigned)
                </label>
                <input
                  id="edit-usr-prep-date"
                  type="date"
                  readOnly
                  value={getLocalIsoDate()}
                  className="w-full rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-2 font-mono font-bold text-[#1B3B6F]"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">User Account Name *</label>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">
                  Reset Password (Optional)
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leave blank to keep existing"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Official Email</label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">
                  Department Concerned *
                </label>
                <input
                  type="text"
                  list="bais-dept-suggestions"
                  required
                  readOnly={Boolean(editLockedDepartment)}
                  value={editLockedDepartment ?? editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className={`w-full rounded border border-[#D5DCE6] px-2.5 py-2 ${
                    editLockedDepartment ? 'bg-[#F3F5F8] font-semibold text-[#1B3B6F]' : ''
                  }`}
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">System Role *</label>
                <select
                  value={editRole}
                  onChange={(e) => handleEditRoleChange(e.target.value as UserRole)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#334E73] mb-1">Designation / Title</label>
                <input
                  type="text"
                  value={editPositionTitle}
                  onChange={(e) => setEditPositionTitle(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
              </div>
              {editRole === 'gso_head' && (
                <div
                  data-testid="edit-gso-code-section"
                  className="sm:col-span-2 rounded border border-[#93C5FD] bg-[#EFF6FF] p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="edit-usr-gso-code"
                      className="inline-flex items-center gap-1.5 font-bold text-[#1E3A5F]"
                    >
                      <KeyRound className="h-3.5 w-3.5 text-[#1B3B6F]" />
                      <span>GSO Head Distinct Verification Code *</span>
                    </label>
                    <button
                      type="button"
                      data-testid="generate-edit-gso-code-btn"
                      onClick={() =>
                        setEditGsoVerificationCode(generateDistinctGsoVerificationCode(users))
                      }
                      className="inline-flex items-center gap-1 rounded border border-[#93C5FD] bg-white px-2 py-0.5 text-[11px] font-bold text-[#1B3B6F] hover:bg-[#DBEAFE]"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Generate Distinct</span>
                    </button>
                  </div>
                  <input
                    id="edit-usr-gso-code"
                    data-testid="edit-gso-verification-code"
                    type="text"
                    required
                    autoComplete="off"
                    minLength={4}
                    maxLength={32}
                    placeholder="e.g. GSO-HD-9012"
                    value={editGsoVerificationCode}
                    onChange={(e) => setEditGsoVerificationCode(e.target.value.toUpperCase())}
                    className="w-full rounded border border-[#93C5FD] bg-white px-2.5 py-2 font-mono font-bold uppercase text-[#0B192C]"
                  />
                  <p className="text-[11px] text-[#334E73]">
                    Unique to GSO Head RBAC only. Changing the role away from GSO Head automatically revokes this verification code.
                  </p>
                </div>
              )}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded border border-[#E6EBF2] bg-[#F9FAFC] px-3 py-2.5">
                <span className="font-semibold text-[#334E73]">Access Permissions:</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editRole === 'admin' ? true : editCanEdit}
                    disabled={editRole === 'admin'}
                    onChange={(e) => setEditCanEdit(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Can Edit Records</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editRole === 'admin' ? true : editCanDelete}
                    disabled={editRole === 'admin'}
                    onChange={(e) => setEditCanDelete(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Can Delete Records</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="edit-user-can-switch-live"
                    checked={editRole === 'admin' ? true : editCanSwitchToLive}
                    disabled={editRole === 'admin'}
                    onChange={(e) => setEditCanSwitchToLive(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Can Switch to Live Data</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="edit-user-can-single-trip"
                    checked={editRole === 'admin' ? true : editCanRequestSingleTrip}
                    disabled={editRole === 'admin'}
                    onChange={(e) => setEditCanRequestSingleTrip(e.target.checked)}
                    className="accent-[#0B192C]"
                  />
                  <span>Single Trip Ticket</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded border border-[#D5DCE6] bg-white px-4 py-2 text-xs font-semibold text-[#334E73]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSubmitting}
                className="rounded bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] disabled:opacity-50"
              >
                {editSubmitting ? 'Saving...' : 'Save User Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
