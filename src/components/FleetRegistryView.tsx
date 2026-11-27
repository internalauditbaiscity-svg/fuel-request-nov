import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Edit3,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  BAIS_DEPARTMENTS,
  EfficiencyUnit,
  EQUIPMENT_CLASS_SPECS,
  EquipmentClass,
  FleetVehicle,
  FuelType,
  UserAccount,
  VehicleStatus,
} from '../types/fuel';
import {
  canRegisterFleetUnit,
  canUserDeleteRecords,
  canUserEditRecords,
  checkDepartmentMnemonicCollision,
  getDepartmentMnemonic,
  getLocalIsoDate,
  validateDepartmentMnemonic,
} from '../utils/fuelEngine';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { RecordsPreviewGate } from './RecordsPreviewGate';

interface FleetRegistryViewProps {
  vehicles: FleetVehicle[];
  currentUser: UserAccount;
  onSaveVehicle: (
    data: Omit<FleetVehicle, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onDeleteVehicle: (vehicle: FleetVehicle) => Promise<void>;
}

export function FleetRegistryView({
  vehicles,
  currentUser,
  onSaveVehicle,
  onDeleteVehicle,
}: FleetRegistryViewProps) {
  const canCreate = canRegisterFleetUnit(currentUser.role);
  const canEdit = canUserEditRecords(currentUser);
  const canDelete = canUserDeleteRecords(currentUser);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  useEscapeClose(modalOpen, () => setModalOpen(false), 3);

  // Form fields (No assigned driver during registration for operational flexibility)
  const [office, setOffice] = useState<string>(BAIS_DEPARTMENTS[0]);
  const [officeMnemonic, setOfficeMnemonic] = useState<string>(() =>
    getDepartmentMnemonic(BAIS_DEPARTMENTS[0], vehicles)
  );
  const [mnemonicError, setMnemonicError] = useState<string | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [chassisNumber, setChassisNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [yearAcquired, setYearAcquired] = useState<number>(2024);
  const [equipmentClass, setEquipmentClass] = useState<EquipmentClass>('service_pickup');
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [efficiencyRate, setEfficiencyRate] = useState<number>(11);
  const [efficiencyUnit, setEfficiencyUnit] = useState<EfficiencyUnit>('km_per_liter');
  const [maxWeeklyLiters, setMaxWeeklyLiters] = useState<number>(180);
  const [status, setStatus] = useState<VehicleStatus>('operational');
  const [nextMaintenanceDate, setNextMaintenanceDate] = useState('2026-12-15');
  const [odometerKm, setOdometerKm] = useState<number>(0);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      const mnemonic = getDepartmentMnemonic(v.office, vehicles).toLowerCase();
      return (
        !q ||
        v.plateNumber.toLowerCase().includes(q) ||
        v.chassisNumber.toLowerCase().includes(q) ||
        v.makeModel.toLowerCase().includes(q) ||
        v.office.toLowerCase().includes(q) ||
        mnemonic.includes(q)
      );
    });
  }, [vehicles, search]);

  const handleOfficeChange = (nextOffice: string) => {
    setOffice(nextOffice);
    const derived = getDepartmentMnemonic(nextOffice, vehicles);
    setOfficeMnemonic(derived);
    setMnemonicError(null);
  };

  const openCreateModal = () => {
    setEditingId(undefined);
    const defaultOffice = BAIS_DEPARTMENTS[0];
    setOffice(defaultOffice);
    setOfficeMnemonic(getDepartmentMnemonic(defaultOffice, vehicles));
    setMnemonicError(null);
    setPlateNumber('');
    setChassisNumber('');
    setMakeModel('');
    setYearAcquired(2024);
    setEquipmentClass('service_pickup');
    setFuelType('diesel');
    setEfficiencyRate(11);
    setEfficiencyUnit('km_per_liter');
    setMaxWeeklyLiters(180);
    setStatus('operational');
    setNextMaintenanceDate('2026-12-15');
    setOdometerKm(0);
    setModalOpen(true);
  };

  const openEditModal = (v: FleetVehicle) => {
    setEditingId(v.id);
    setOffice(v.office);
    setOfficeMnemonic(v.officeMnemonic || getDepartmentMnemonic(v.office, vehicles));
    setMnemonicError(null);
    setPlateNumber(v.plateNumber);
    setChassisNumber(v.chassisNumber);
    setMakeModel(v.makeModel);
    setYearAcquired(v.yearAcquired);
    setEquipmentClass(v.equipmentClass);
    setFuelType(v.fuelType);
    setEfficiencyRate(v.efficiencyRate);
    setEfficiencyUnit(v.efficiencyUnit);
    setMaxWeeklyLiters(v.maxWeeklyLiters);
    setStatus(v.status);
    setNextMaintenanceDate(v.nextMaintenanceDate ?? '2026-12-15');
    setOdometerKm(v.odometerKm ?? 0);
    setModalOpen(true);
  };

  const handleClassChange = (cls: EquipmentClass) => {
    setEquipmentClass(cls);
    const spec = EQUIPMENT_CLASS_SPECS[cls];
    setEfficiencyUnit(spec.defaultUnit);
    setEfficiencyRate(fuelType === 'diesel' ? spec.defaultDieselRate : spec.defaultGasolineRate);
    setMaxWeeklyLiters(spec.defaultMaxWeeklyLiters);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plateNumber.trim() || !chassisNumber.trim() || !makeModel.trim() || !office.trim()) {
      return;
    }
    const validation = validateDepartmentMnemonic(officeMnemonic);
    if (!validation.valid) {
      setMnemonicError(validation.error || 'Mnemonic must be 3–5 uppercase letters.');
      return;
    }
    const collisionOffice = checkDepartmentMnemonicCollision(
      validation.normalized,
      office,
      vehicles
    );
    if (collisionOffice) {
      setMnemonicError(
        `Mnemonic "${validation.normalized}" is already assigned to ${collisionOffice}. Choose a unique 3–5 letter code.`
      );
      return;
    }
    setMnemonicError(null);
    await onSaveVehicle(
      {
        office: office.trim(),
        officeMnemonic: validation.normalized,
        plateNumber: plateNumber.trim().toUpperCase(),
        chassisNumber: chassisNumber.trim().toUpperCase(),
        makeModel: makeModel.trim(),
        yearAcquired,
        equipmentClass,
        fuelType,
        efficiencyRate,
        efficiencyUnit,
        maxWeeklyLiters,
        status,
        nextMaintenanceDate: nextMaintenanceDate || undefined,
        odometerKm,
      },
      editingId
    );
    setModalOpen(false);
  };

  const statusTextClass = (st: VehicleStatus) => {
    if (st === 'operational') return 'text-emerald-800';
    if (st === 'dispatched') return 'text-[#1B3B6F]';
    if (st === 'maintenance') return 'text-amber-800';
    return 'text-red-700';
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#D5DCE6] bg-white p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plate, chassis, make/model, or office..."
            aria-label="Search fleet registry"
            className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] py-1.5 pl-9 pr-3 text-xs sm:text-sm text-[#0B192C]"
          />
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Register Fleet Unit</span>
          </button>
        )}
      </div>

      {/* Preview-Gated Fleet Table */}
      <RecordsPreviewGate
        title="Fleet & Equipment Records"
        description="Registered fleet units and department mnemonics."
        recordCount={filteredVehicles.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Fleet"
      >
        <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] sm:text-xs" data-testid="fleet-preview-table">
              <thead className="border-b border-[#CBD5E1] bg-[#EEF2F8] text-[#1E3A5F]">
                <tr>
                  <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Plate
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Dept
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight">
                    Unit
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight">
                    Class / Cap
                  </th>
                  <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                    Status
                  </th>
                  {(canEdit || canDelete) && (
                    <th className="px-1.5 py-1.5 sm:px-2 sm:py-2 text-center align-middle text-[10px] sm:text-[11px] font-bold tracking-wide leading-tight whitespace-nowrap">
                      Act
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit || canDelete ? 6 : 5} className="px-3 py-4 text-center text-[#5A6F8C]">
                      No fleet units match your filter.
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((v) => {
                    const deptCode = getDepartmentMnemonic(v.office, vehicles);
                    return (
                      <tr key={v.id} className="hover:bg-[#F9FAFC]">
                        <td className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 whitespace-nowrap">
                          <div className="font-mono font-bold text-[#0B192C]">{v.plateNumber}</div>
                          <div className="font-mono text-[10px] text-[#5A6F8C]">{v.chassisNumber}</div>
                        </td>
                        <td
                          className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-center font-mono font-bold text-[#1B3B6F] whitespace-nowrap"
                          title={v.office}
                          data-testid={`fleet-dept-mnemonic-${v.plateNumber}`}
                        >
                          {deptCode}
                        </td>
                        <td className="px-1.5 py-1.5 sm:px-2.5 sm:py-2">
                          <div className="font-semibold text-[#0B192C]">{v.makeModel}</div>
                          <div className="font-mono text-[10px] text-[#5A6F8C]">
                            {v.yearAcquired} · {v.fuelType.toUpperCase()}
                          </div>
                        </td>
                        <td className="px-1.5 py-1.5 sm:px-2.5 sm:py-2">
                          <div className="text-[#0B192C]">
                            {EQUIPMENT_CLASS_SPECS[v.equipmentClass].label}
                          </div>
                          <div className="font-mono text-[10px] text-[#1B3B6F]">
                            {v.efficiencyRate}{' '}
                            {v.efficiencyUnit === 'km_per_liter' ? 'km/L' : 'L/hr'} · {v.maxWeeklyLiters} L/wk
                          </div>
                        </td>
                        <td className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 whitespace-nowrap">
                          <div className={`font-semibold uppercase text-[10px] ${statusTextClass(v.status)}`}>
                            {v.status}
                          </div>
                          <div className="flex items-center gap-1 font-mono text-[10px] text-[#5A6F8C]">
                            <CalendarClock className="h-3 w-3 shrink-0" />
                            <span>{v.nextMaintenanceDate || 'None'}</span>
                          </div>
                        </td>
                        {(canEdit || canDelete) && (
                          <td className="px-1.5 py-1.5 sm:px-2.5 sm:py-2 text-right whitespace-nowrap">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(v)}
                                aria-label={`Edit ${v.plateNumber}`}
                                className="mr-1 rounded border border-[#D5DCE6] p-1 text-[#334E73] hover:bg-[#F3F5F8]"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => onDeleteVehicle(v)}
                                aria-label={`Delete ${v.plateNumber}`}
                                className="rounded border border-[#D5DCE6] p-1 text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </RecordsPreviewGate>

      {/* Register / Edit Fleet Modal (No Driver Assignment Field for Flexibility) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Fleet Vehicle Form"
        >
          <form
            onSubmit={handleSubmit}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#D5DCE6] bg-white"
          >
            <div className="flex items-start justify-between gap-4 bg-[#0B192C] px-5 py-3.5 text-white">
              <div>
                <h2 className="font-display text-base font-bold">
                  {editingId ? 'Edit Fleet Unit' : 'Register New Fleet Unit / Equipment'}
                </h2>
                <p className="text-[11px] text-slate-300">
                  Drivers are assigned per Trip Ticket so fleet units stay flexible across shifts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close fleet unit dialog"
                className="inline-flex items-center justify-center rounded-md bg-[#334E73] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div className="sm:col-span-2">
                <label htmlFor="fleet-prep-date" className="block font-semibold text-[#334E73] mb-1">
                  Preparation Date (Pre-Assigned)
                </label>
                <input
                  id="fleet-prep-date"
                  data-testid="fleet-preparation-date"
                  type="date"
                  readOnly
                  value={getLocalIsoDate()}
                  className="w-full rounded border border-[#D5DCE6] bg-[#F3F5F8] px-2.5 py-2 font-mono font-bold text-[#1B3B6F]"
                />
              </div>
              <div>
                <label htmlFor="fleet-office-input" className="block font-semibold text-[#334E73] mb-1">
                  Office / Department *
                </label>
                <input
                  id="fleet-office-input"
                  data-testid="fleet-office-input"
                  type="text"
                  list="fleet-dept-list"
                  required
                  value={office}
                  onChange={(e) => handleOfficeChange(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
                <datalist id="fleet-dept-list">
                  {BAIS_DEPARTMENTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="fleet-mnemonic-input" className="block font-semibold text-[#334E73] mb-1">
                  Dept Mnemonic (3–5 Letters) *
                </label>
                <input
                  id="fleet-mnemonic-input"
                  data-testid="fleet-office-mnemonic-input"
                  type="text"
                  required
                  minLength={3}
                  maxLength={5}
                  value={officeMnemonic}
                  onChange={(e) => {
                    const cleaned = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
                    setOfficeMnemonic(cleaned);
                    if (cleaned.length >= 3) {
                      const collisionOffice = checkDepartmentMnemonicCollision(cleaned, office, vehicles);
                      if (collisionOffice) {
                        setMnemonicError(
                          `Mnemonic "${cleaned}" is already assigned to ${collisionOffice}. Choose a unique 3–5 letter code.`
                        );
                        return;
                      }
                    }
                    setMnemonicError(null);
                  }}
                  placeholder="e.g. CEO, CAGRO"
                  className="w-full rounded border border-[#D5DCE6] bg-[#F8FAFC] px-2.5 py-2 font-mono font-bold uppercase tracking-wider text-[#1B3B6F]"
                />
                <p className="mt-0.5 text-[10px] text-[#5A6F8C]">
                  Used as the department label across previews &amp; reports.
                </p>
                {mnemonicError && (
                  <p role="alert" data-testid="fleet-mnemonic-error" className="mt-1 text-[11px] font-semibold text-red-700">
                    {mnemonicError}
                  </p>
                )}
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Plate / Asset Number *</label>
                <input
                  type="text"
                  required
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Chassis / Serial Number *</label>
                <input
                  type="text"
                  required
                  value={chassisNumber}
                  onChange={(e) => setChassisNumber(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Make & Model *</label>
                <input
                  type="text"
                  required
                  value={makeModel}
                  onChange={(e) => setMakeModel(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Year Acquired</label>
                <input
                  type="number"
                  min={1980}
                  max={2035}
                  value={yearAcquired}
                  onChange={(e) => setYearAcquired(Number(e.target.value) || 2024)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Equipment Class</label>
                <select
                  value={equipmentClass}
                  onChange={(e) => handleClassChange(e.target.value as EquipmentClass)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                >
                  {(Object.keys(EQUIPMENT_CLASS_SPECS) as EquipmentClass[]).map((k) => (
                    <option key={k} value={k}>
                      {EQUIPMENT_CLASS_SPECS[k].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Fuel Type</label>
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value as FuelType)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                >
                  <option value="diesel">Diesel</option>
                  <option value="gasoline">Gasoline</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">
                  Rate ({efficiencyUnit === 'km_per_liter' ? 'km/L' : 'L/hr'}) & Weekly Cap (L)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.1"
                    min={0.5}
                    value={efficiencyRate}
                    onChange={(e) => setEfficiencyRate(Number(e.target.value) || 1)}
                    className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                  />
                  <input
                    type="number"
                    min={10}
                    value={maxWeeklyLiters}
                    onChange={(e) => setMaxWeeklyLiters(Number(e.target.value) || 60)}
                    className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Operational Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as VehicleStatus)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                >
                  <option value="operational">Operational</option>
                  <option value="dispatched">Dispatched</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="decommissioned">Decommissioned</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Next Maintenance Date</label>
                <input
                  type="date"
                  value={nextMaintenanceDate}
                  onChange={(e) => setNextMaintenanceDate(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#D5DCE6] bg-[#F3F5F8] px-5 py-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded border border-[#D5DCE6] bg-white px-4 py-2 text-xs font-semibold text-[#334E73]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F]"
              >
                Save Fleet Unit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
