import { useEffect, useMemo, useState } from 'react';
import { Building2, FolderKanban, Truck } from 'lucide-react';
import {
  FleetVehicle,
  FuelDepot,
  InventoryLog,
  PmcProject,
  RegistrySubTab,
  StorageTank,
  TripTicket,
  UserAccount,
  WorkPlan,
} from '../types/fuel';
import {
  canAccessDepotRegistry,
  canAccessFleetRegistry,
  canAccessPmcProjectRegistry,
  canViewDepotTankRunningBalances,
  getAllowedRegistrySubTabs,
} from '../utils/fuelEngine';
import { DepotTankRegistryView } from './DepotTankRegistryView';
import { FleetRegistryView } from './FleetRegistryView';
import { PmcProjectRegistryView } from './PmcProjectRegistryView';

interface MasterRegistriesViewProps {
  currentUser: UserAccount;
  // Fleet Registry props
  visibleVehicles: FleetVehicle[];
  onSaveVehicle: (
    vehicle: Omit<FleetVehicle, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onDeleteVehicle: (vehicle: FleetVehicle) => Promise<void>;
  // PMC Project Registry props
  pmcProjects: PmcProject[];
  allTickets: TripTicket[];
  allWorkPlans: WorkPlan[];
  allVehicles: FleetVehicle[];
  inventoryLogs: InventoryLog[];
  depots: FuelDepot[];
  onSavePmcProject: (
    project: Omit<PmcProject, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onDeletePmcProject: (project: PmcProject) => Promise<void>;
  // Depot Registry props
  storageTanks: StorageTank[];
  onSaveDepotInfo: (
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
  ) => Promise<void>;
  onSaveStorageTank: (
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
  ) => Promise<StorageTank>;
  onDeleteStorageTank: (tank: StorageTank) => Promise<void>;
}

const SUBTAB_META: Record<
  RegistrySubTab,
  { label: string; shortLabel: string; icon: typeof Truck }
> = {
  fleet: {
    label: 'Fleet Registry',
    shortLabel: 'Fleet',
    icon: Truck,
  },
  pmc_projects: {
    label: 'PMC Project Registry',
    shortLabel: 'PMC Projects',
    icon: FolderKanban,
  },
  depot: {
    label: 'Depot Registry',
    shortLabel: 'Depot',
    icon: Building2,
  },
};

export function MasterRegistriesView({
  currentUser,
  visibleVehicles,
  onSaveVehicle,
  onDeleteVehicle,
  pmcProjects,
  allTickets,
  allWorkPlans,
  allVehicles,
  inventoryLogs,
  depots,
  onSavePmcProject,
  onDeletePmcProject,
  storageTanks,
  onSaveDepotInfo,
  onSaveStorageTank,
  onDeleteStorageTank,
}: MasterRegistriesViewProps) {
  const allowedSubTabs = useMemo(
    () => getAllowedRegistrySubTabs(currentUser.role),
    [currentUser.role]
  );

  const [activeSubTab, setActiveSubTab] = useState<RegistrySubTab>(
    () => allowedSubTabs[0] ?? 'fleet'
  );

  useEffect(() => {
    if (allowedSubTabs.length > 0 && !allowedSubTabs.includes(activeSubTab)) {
      setActiveSubTab(allowedSubTabs[0]);
    }
  }, [allowedSubTabs, activeSubTab]);

  if (allowedSubTabs.length === 0) {
    return null;
  }

  const resolvedSubTab: RegistrySubTab = allowedSubTabs.includes(activeSubTab)
    ? activeSubTab
    : allowedSubTabs[0];

  const canViewTankBalances = canViewDepotTankRunningBalances(currentUser.role);

  return (
    <div data-testid="master-registries-view" className="space-y-4">
      {/* Unified Master Registries Sub-Tab Navigation */}
      <div className="rounded-lg border border-[#D5DCE6] bg-white p-2">
        <div
          role="tablist"
          aria-label="Master Registries"
          className="flex flex-wrap items-center gap-1.5 sm:gap-2"
        >
          {allowedSubTabs.map((tabId) => {
            const meta = SUBTAB_META[tabId];
            const Icon = meta.icon;
            const active = resolvedSubTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`registry-subtab-${tabId}`}
                onClick={() => setActiveSubTab(tabId)}
                className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition-colors min-h-[38px] ${
                  active
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-[#F3F5F8] text-[#334E73] hover:bg-[#E6EBF2]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{meta.label}</span>
                <span className="sm:hidden">{meta.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Strictly RBAC-Gated Registry Content */}
      {resolvedSubTab === 'fleet' && canAccessFleetRegistry(currentUser.role) && (
        <FleetRegistryView
          vehicles={visibleVehicles}
          currentUser={currentUser}
          onSaveVehicle={onSaveVehicle}
          onDeleteVehicle={onDeleteVehicle}
        />
      )}

      {resolvedSubTab === 'pmc_projects' && canAccessPmcProjectRegistry(currentUser.role) && (
        <PmcProjectRegistryView
          projects={pmcProjects}
          tickets={allTickets}
          workPlans={allWorkPlans}
          vehicles={allVehicles}
          inventoryLogs={inventoryLogs}
          depots={depots}
          currentUser={currentUser}
          onSaveProject={onSavePmcProject}
          onDeleteProject={onDeletePmcProject}
        />
      )}

      {resolvedSubTab === 'depot' && canAccessDepotRegistry(currentUser.role) && (
        <DepotTankRegistryView
          depots={depots}
          storageTanks={storageTanks}
          inventoryLogs={inventoryLogs}
          currentUser={currentUser}
          canViewTankBalances={canViewTankBalances}
          onSaveDepotInfo={onSaveDepotInfo}
          onSaveStorageTank={onSaveStorageTank}
          onDeleteStorageTank={onDeleteStorageTank}
        />
      )}
    </div>
  );
}
