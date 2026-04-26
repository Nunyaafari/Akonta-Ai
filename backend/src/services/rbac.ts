import type { MembershipRole } from '@prisma/client';

export type Permission =
  | 'workspace:view'
  | 'workspace:members:manage'
  | 'transaction:view'
  | 'transaction:create'
  | 'transaction:edit_same_day'
  | 'transaction:edit_historical'
  | 'transaction:delete_same_day'
  | 'transaction:delete_historical'
  | 'approval:review'
  | 'summary:view'
  | 'budget:view'
  | 'budget:manage'
  | 'insight:view'
  | 'chat:use'
  | 'audit:view';

const permissionMap: Record<MembershipRole, Set<Permission>> = {
  owner: new Set<Permission>([
    'workspace:view',
    'workspace:members:manage',
    'transaction:view',
    'transaction:create',
    'transaction:edit_same_day',
    'transaction:edit_historical',
    'transaction:delete_same_day',
    'transaction:delete_historical',
    'approval:review',
    'summary:view',
    'budget:view',
    'budget:manage',
    'insight:view',
    'chat:use',
    'audit:view'
  ]),
  manager: new Set<Permission>([
    'workspace:view',
    'transaction:view',
    'transaction:create',
    'transaction:edit_same_day',
    'transaction:edit_historical',
    'transaction:delete_same_day',
    'approval:review',
    'summary:view',
    'budget:view',
    'budget:manage',
    'insight:view',
    'chat:use'
  ]),
  bookkeeper: new Set<Permission>([
    'workspace:view',
    'transaction:view',
    'transaction:create',
    'transaction:edit_same_day',
    'transaction:edit_historical',
    'transaction:delete_same_day',
    'approval:review',
    'summary:view',
    'budget:view',
    'budget:manage',
    'insight:view',
    'chat:use',
    'audit:view'
  ]),
  cashier: new Set<Permission>([
    'workspace:view',
    'transaction:view',
    'transaction:create',
    'transaction:edit_same_day',
    'summary:view',
    'budget:view',
    'insight:view',
    'chat:use'
  ]),
  viewer: new Set<Permission>([
    'workspace:view',
    'transaction:view',
    'summary:view',
    'budget:view',
    'insight:view'
  ]),
  accountant: new Set<Permission>([
    'workspace:view',
    'transaction:view',
    'transaction:create',
    'transaction:edit_same_day',
    'transaction:edit_historical',
    'transaction:delete_same_day',
    'approval:review',
    'summary:view',
    'budget:view',
    'budget:manage',
    'insight:view',
    'chat:use',
    'audit:view'
  ])
};

export const hasPermission = (role: MembershipRole, permission: Permission): boolean => {
  return permissionMap[role].has(permission);
};
