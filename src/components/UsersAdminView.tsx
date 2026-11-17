import { useState } from 'react';
import { Edit3, ShieldAlert, Trash2, UserPlus, X } from 'lucide-react';
import {
  BAIS_DEPARTMENTS,
  ROLE_LABELS,
  UserAccount,
  UserRole,
} from '../types/fuel';
import { canManageUsers } from '../utils/fuelEngine';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface UsersAdminViewProps {
  users: UserAccount[];
  currentUser: UserAccount;
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
    }
  ) => Promise<void>;
  onDeleteUser: (user: UserAccount) => Promise<void>;
  onToggleActive: (user: UserAccount) => Promise<void>;
}

export function UsersAdminView({
  users,
  currentUser,
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
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim() || !displayName.trim() || !department.trim()) return;
    setSubmitting(true);
    try {
      await onCreateUser({
        username: username.trim(),
        password: password,
        email: email.trim() || `${username.trim().toLowerCase()}@baiscity.gov.ph`,
        displayName: displayName.trim(),
        role,
        department: department.trim(),
        positionTitle: positionTitle.trim() || ROLE_LABELS[role],
        canEdit: role === 'admin' ? true : canEdit,
        canDelete: role === 'admin' ? true : canDelete,
        canSwitchToLive: role === 'admin' ? true : canSwitchToLive,
      });
      setUsername('');
      setPassword('');
      setEmail('');
      setDisplayName('');
      setDepartment('');
      setPositionTitle('');
      setCanEdit(false);
      setCanDelete(false);
      setCanSwitchToLive(false);
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (u: UserAccount) => {
    setEditingUser(u);
    setEditUsername(u.username || u.email.split('@')[0]);
    setEditPassword('');
    setEditEmail(u.email);
    setEditDisplayName(u.displayName);
    setEditRole(u.role);
    setEditDepartment(u.department);
    setEditPositionTitle(u.positionTitle || '');
    setEditCanEdit(u.role === 'admin' ? true : Boolean(u.canEdit));
    setEditCanDelete(u.role === 'admin' ? true : Boolean(u.canDelete));
    setEditCanSwitchToLive(u.role === 'admin' ? true : Boolean(u.canSwitchToLive));
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setEditUsername('');
    setEditPassword('');
    setEditEmail('');
    setEditDisplayName('');
    setEditDepartment('');
    setEditPositionTitle('');
    setEditCanEdit(false);
    setEditCanDelete(false);
    setEditCanSwitchToLive(false);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !editUsername.trim() || !editDisplayName.trim() || !editDepartment.trim()) {
      return;
    }
    await onUpdateUser(editingUser.uid, {
      username: editUsername.trim(),
      password: editPassword.trim() || undefined,
      email: editEmail.trim(),
      displayName: editDisplayName.trim(),
      role: editRole,
      department: editDepartment.trim(),
      positionTitle: editPositionTitle.trim() || ROLE_LABELS[editRole],
      canEdit: editRole === 'admin' ? true : editCanEdit,
      canDelete: editRole === 'admin' ? true : editCanDelete,
      canSwitchToLive: editRole === 'admin' ? true : editCanSwitchToLive,
    });
    closeEditModal();
  };

  return (
    <div className="space-y-6">
      {/* User Creation Form */}
      <section className="rounded-lg border border-[#D5DCE6] bg-white p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#E6EBF2] pb-3">
          <UserPlus className="h-4 w-4 text-[#1B3B6F]" />
          <h2 className="font-display text-sm font-bold text-[#0B192C]">
            Create Departmental User, Credentials & RBAC Permissions
          </h2>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                Department Concerned (Enter Value) *
              </label>
              <input
                id="usr-dept"
                type="text"
                list="bais-dept-suggestions"
                required
                placeholder="Enter office or department name"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full rounded border border-[#D5DCE6] px-3 py-2 text-xs text-[#0B192C]"
              />
              <datalist id="bais-dept-suggestions">
                {BAIS_DEPARTMENTS.map((d) => (
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
                onChange={(e) => setRole(e.target.value as UserRole)}
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
        title="Authorized Users & RBAC Registry"
        description="Provisioned user accounts, assigned departments, and Edit/Delete permission grants remain hidden until Preview is pressed."
        recordCount={users.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview User Accounts"
      >
        <section className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
          <div className="border-b border-[#D5DCE6] px-5 py-3.5">
            <h3 className="font-display text-sm font-bold text-[#0B192C]">
              Authorized Users & Departmental Scope ({users.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">User & Account Name</th>
                  <th className="px-4 py-2.5 font-semibold">Role</th>
                  <th className="px-4 py-2.5 font-semibold">Department Concerned</th>
                  <th className="px-4 py-2.5 font-semibold">Edit / Delete / Live Perms</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {users.map((u) => (
                  <tr key={u.uid} className="hover:bg-[#F9FAFC]">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-[#0B192C]">{u.displayName}</div>
                      <div className="font-mono text-[11px] text-[#1B3B6F]">
                        @{u.username || u.email.split('@')[0]}
                      </div>
                      <div className="font-mono text-[10px] text-[#5A6F8C]">{u.email}</div>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[#1B3B6F]">
                      {ROLE_LABELS[u.role]}
                    </td>
                    <td className="px-4 py-2.5 text-[#334E73]">{u.department}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[#334E73]">
                      {u.role === 'admin' || u.canEdit ? 'Edit: Yes' : 'Edit: No'} ·{' '}
                      {u.role === 'admin' || u.canDelete ? 'Delete: Yes' : 'Delete: No'} ·{' '}
                      {u.role === 'admin' || u.canSwitchToLive ? 'Live: Yes' : 'Live: No'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`font-semibold ${
                          u.active ? 'text-emerald-800' : 'text-red-700'
                        }`}
                      >
                        {u.active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        aria-label={`Edit user ${u.username || u.displayName}`}
                        className="mr-1 rounded border border-[#D5DCE6] bg-white p-1.5 text-[#334E73] hover:bg-[#F3F5F8]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleActive(u)}
                        className="mr-1 rounded border border-[#D5DCE6] bg-white px-2.5 py-1 text-xs font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
                      >
                        {u.active ? 'Suspend' : 'Activate'}
                      </button>
                      {u.uid !== currentUser.uid && (
                        <button
                          type="button"
                          onClick={() => onDeleteUser(u)}
                          aria-label={`Delete user ${u.username || u.displayName}`}
                          className="rounded border border-[#D5DCE6] bg-white p-1.5 text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
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
            <div className="flex items-center justify-between bg-[#0B192C] px-5 py-3.5 text-white">
              <h2 className="font-display text-base font-bold">
                Edit User Account ({editingUser.username || editingUser.displayName})
              </h2>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded p-1 text-slate-300 hover:bg-[#13294B]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
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
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">System Role *</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
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
                className="rounded bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
              >
                Save User Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
