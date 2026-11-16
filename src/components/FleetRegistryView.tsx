import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Edit3,
  Plus,
  Search,
  Trash2,
  X,
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
  canManageUsers,
  canUserDeleteRecords,
  canUserEditRecords,
} from '../utils/fuelEngine';
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
  const canCreate = canManageUsers(currentUser.role) || canUserEditRecords(currentUser);
  const canEdit = canUserEditRecords(currentUser);
  const canDelete = canUserDeleteRecords(currentUser);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  // Form fields (No assigned driver during registration for operational flexibility)
  const [office, setOffice] = useState<string>(BAIS_DEPARTMENTS[0]);
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
    return vehicles.filter(
      (v) =>
        !q ||
        v.plateNumber.toLowerCase().includes(q) ||
        v.chassisNumber.toLowerCase().includes(q) ||
        v.makeModel.toLowerCase().includes(q) ||
        v.office.toLowerCase().includes(q)
    );
  }, [vehicles, search]);

  const openCreateModal = () => {
    setEditingId(undefined);
    setOffice(BAIS_DEPARTMENTS[0]);
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
    await onSaveVehicle(
      {
        office: office.trim(),
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[#D5DCE6] bg-white p-4">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5A6F8C]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plate, chassis, make/model, or office..."
            aria-label="Search fleet registry"
            className="w-full rounded-md border border-[#D5DCE6] bg-[#F3F5F8] py-2 pl-9 pr-3 text-sm text-[#0B192C]"
          />
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Register Fleet Unit</span>
          </button>
        )}
      </div>

      {/* Preview-Gated Fleet Table */}
      <RecordsPreviewGate
        title="Registered Fleet & Equipment Records"
        description="Registered fleet units remain hidden until Preview is pressed. Drivers are assigned flexibly per Trip Ticket during Department Request creation."
        recordCount={filteredVehicles.length}
        previewOpen={previewOpen}
        onTogglePreview={setPreviewOpen}
        buttonLabel="Preview Fleet Records"
      >
        <div className="rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#D5DCE6] bg-[#F3F5F8] text-[#334E73]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Plate & Chassis</th>
                  <th className="px-4 py-2.5 font-semibold">Make, Model & Year</th>
                  <th className="px-4 py-2.5 font-semibold">Assigned Office</th>
                  <th className="px-4 py-2.5 font-semibold">Class & Consumption Limit</th>
                  <th className="px-4 py-2.5 font-semibold">Status & Maintenance</th>
                  {(canEdit || canDelete) && (
                    <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF2]">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit || canDelete ? 6 : 5} className="px-4 py-8 text-center text-[#5A6F8C]">
                      No fleet units match your filter.
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((v) => (
                    <tr key={v.id} className="hover:bg-[#F9FAFC]">
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-[#0B192C]">{v.plateNumber}</div>
                        <div className="font-mono text-[11px] text-[#5A6F8C]">{v.chassisNumber}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#0B192C]">{v.makeModel}</div>
                        <div className="font-mono text-[11px] text-[#5A6F8C]">
                          Acquired {v.yearAcquired} · {v.fuelType.toUpperCase()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#334E73]">{v.office}</td>
                      <td className="px-4 py-3">
                        <div className="text-[#0B192C]">
                          {EQUIPMENT_CLASS_SPECS[v.equipmentClass].label}
                        </div>
                        <div className="font-mono text-[11px] text-[#1B3B6F]">
                          {v.efficiencyRate}{' '}
                          {v.efficiencyUnit === 'km_per_liter' ? 'km/L' : 'L/hr'} · Cap{' '}
                          {v.maxWeeklyLiters} L/wk
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className={`font-semibold uppercase text-[11px] ${statusTextClass(v.status)}`}>
                          {v.status}
                        </div>
                        <div className="flex items-center gap-1 font-mono text-[11px] text-[#5A6F8C]">
                          <CalendarClock className="h-3 w-3" />
                          <span>Maint: {v.nextMaintenanceDate || 'Unscheduled'}</span>
                        </div>
                      </td>
                      {(canEdit || canDelete) && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(v)}
                              aria-label={`Edit ${v.plateNumber}`}
                              className="mr-1 rounded border border-[#D5DCE6] p-1.5 text-[#334E73] hover:bg-[#F3F5F8]"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => onDeleteVehicle(v)}
                              aria-label={`Delete ${v.plateNumber}`}
                              className="rounded border border-[#D5DCE6] p-1.5 text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
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
            className="w-full max-w-2xl rounded-lg border border-[#D5DCE6] bg-white overflow-hidden"
          >
            <div className="flex items-center justify-between bg-[#0B192C] px-5 py-3.5 text-white">
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
                className="rounded p-1 text-slate-300 hover:bg-[#13294B]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block font-semibold text-[#334E73] mb-1">Office / Department *</label>
                <input
                  type="text"
                  list="fleet-dept-list"
                  required
                  value={office}
                  onChange={(e) => setOffice(e.target.value)}
                  className="w-full rounded border border-[#D5DCE6] px-2.5 py-2"
                />
                <datalist id="fleet-dept-list">
                  {BAIS_DEPARTMENTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
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
