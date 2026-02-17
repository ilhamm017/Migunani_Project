export type StaffRole = 'admin_gudang' | 'admin_finance' | 'driver' | 'kasir';
export type StaffStatus = 'active' | 'banned';

export interface StaffRecord {
  id: string;
  name: string;
  email: string | null;
  whatsapp_number: string;
  role: StaffRole;
  status: StaffStatus;
  createdAt?: string;
  updatedAt?: string;
}

export const roleOptions: Array<{ value: StaffRole; label: string }> = [
  { value: 'admin_gudang', label: 'Admin Gudang' },
  { value: 'admin_finance', label: 'Admin Finance' },
  { value: 'driver', label: 'Driver' },
  { value: 'kasir', label: 'Kasir / Sales Admin' },
];

export const roleLabelMap: Record<StaffRole, string> = {
  admin_gudang: 'Admin Gudang',
  admin_finance: 'Admin Finance',
  driver: 'Driver',
  kasir: 'Kasir / Sales Admin',
};

export const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID');
};
