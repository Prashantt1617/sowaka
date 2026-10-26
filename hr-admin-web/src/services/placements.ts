// Placements, for a company that is a placement agency: its clients (the
// companies hiring), customers (the candidates) and placements. Only a company
// whose signed-in profile says features.placements has them; the server
// refuses everyone else. See backend/docs/placements-api.md.
import { api } from './http';

export type PlacementStatus = 'shortlisted' | 'interviewing' | 'offered' | 'joined' | 'dropped';
export const PLACEMENT_STATUSES: PlacementStatus[] = ['shortlisted', 'interviewing', 'offered', 'joined', 'dropped'];

/** Who added it, and how many placements use it, as the dashboard's lists carry them. */
type AdminExtras = { createdByUserId: string; createdByName: string; createdAt: string; updatedAt: string };

export type PlacementClient = AdminExtras & {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  industry: string;
  city: string;
  notes: string;
  placements: number;
};

export type PlacementCustomer = AdminExtras & {
  id: string;
  name: string;
  phone: string;
  email: string;
  currentRole: string;
  experienceYears: number | null;
  skills: string[];
  city: string;
  notes: string;
  placements: number;
};

export type PlacementStatusChange = { status: PlacementStatus; at: string; byUserId: string };

export type Placement = AdminExtras & {
  id: string;
  customerId: string;
  clientId: string;
  position: string;
  status: PlacementStatus;
  /** YYYY-MM-DD */
  interviewDate: string | null;
  joiningDate: string | null;
  ctcRupees: number | null;
  feeRupees: number | null;
  notes: string;
  history: PlacementStatusChange[];
  clientName: string;
  customerName: string;
};

export type PlacementsSummary = {
  clients: number;
  customers: number;
  placements: { total: number; byStatus: Record<PlacementStatus, number> };
};

export type ClientInput = Pick<PlacementClient, 'name' | 'contactName' | 'phone' | 'email' | 'industry' | 'city' | 'notes'>;
export type CustomerInput = Pick<PlacementCustomer, 'name' | 'phone' | 'email' | 'currentRole' | 'city' | 'notes'> & {
  experienceYears: number | null;
  skills: string[];
};
export type PlacementInput = Pick<Placement, 'customerId' | 'clientId' | 'position' | 'status' | 'interviewDate' | 'joiningDate' | 'ctcRupees' | 'feeRupees' | 'notes'>;

/** Filters the dashboard's lists take; empty ones are left off. */
export type PlacementFilters = { q?: string; status?: string; clientId?: string; customerId?: string; createdBy?: string; from?: string; to?: string };

function qs(filters: PlacementFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value && value !== 'all') params.set(key, value);
  const s = params.toString();
  return s ? `?${s}` : '';
}

const BASE = '/admin/placements';

export const getPlacementsSummary = () => api<PlacementsSummary>(`${BASE}/summary`);

export const listPlacements = (filters: PlacementFilters = {}) =>
  api<{ placements: Placement[] }>(`${BASE}${qs(filters)}`).then((r) => r.placements);
export const createPlacement = (input: PlacementInput) =>
  api<{ placement: Placement }>(BASE, { method: 'POST', body: input }).then((r) => r.placement);
export const updatePlacement = (id: string, input: Partial<PlacementInput>) =>
  api<{ placement: Placement }>(`${BASE}/${id}`, { method: 'PATCH', body: input }).then((r) => r.placement);
export const deletePlacement = (id: string) => api(`${BASE}/${id}`, { method: 'DELETE' });

export const listPlacementClients = (filters: PlacementFilters = {}) =>
  api<{ clients: PlacementClient[] }>(`${BASE}/clients${qs(filters)}`).then((r) => r.clients);
export const createPlacementClient = (input: ClientInput) =>
  api<{ client: PlacementClient }>(`${BASE}/clients`, { method: 'POST', body: input }).then((r) => r.client);
export const updatePlacementClient = (id: string, input: Partial<ClientInput>) =>
  api<{ client: PlacementClient }>(`${BASE}/clients/${id}`, { method: 'PATCH', body: input }).then((r) => r.client);
export const deletePlacementClient = (id: string) => api(`${BASE}/clients/${id}`, { method: 'DELETE' });

export const listPlacementCustomers = (filters: PlacementFilters = {}) =>
  api<{ customers: PlacementCustomer[] }>(`${BASE}/customers${qs(filters)}`).then((r) => r.customers);
export const createPlacementCustomer = (input: CustomerInput) =>
  api<{ customer: PlacementCustomer }>(`${BASE}/customers`, { method: 'POST', body: input }).then((r) => r.customer);
export const updatePlacementCustomer = (id: string, input: Partial<CustomerInput>) =>
  api<{ customer: PlacementCustomer }>(`${BASE}/customers/${id}`, { method: 'PATCH', body: input }).then((r) => r.customer);
export const deletePlacementCustomer = (id: string) => api(`${BASE}/customers/${id}`, { method: 'DELETE' });
