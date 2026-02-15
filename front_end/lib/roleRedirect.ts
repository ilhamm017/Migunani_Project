export function getDashboardPathByRole(role?: string | null): string {
  switch (role) {
    case 'super_admin':
      return '/admin';
    case 'admin_gudang':
      return '/admin';
    case 'admin_finance':
      return '/admin/finance';
    case 'kasir':
      return '/admin/sales';
    case 'driver':
      return '/driver';
    default:
      return '/';
  }
}
