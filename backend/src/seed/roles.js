const prisma = require('./prismaClient');

const roleDefinitions = [
  {
    name: 'Super Admin',
    description: 'Full access to the store and administrative platform.',
    permissions: [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'orders.view',
      'orders.edit',
      'customers.view',
      'customers.manage',
      'suppliers.view',
      'suppliers.manage',
      'accounting.view',
      'accounting.manage',
      'reports.view',
      'reports.export',
      'users.view',
      'users.manage',
      'settings.manage',
    ],
  },
  {
    name: 'Owner',
    description: 'Business owner with broad access to operations and settings.',
    permissions: [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'orders.view',
      'orders.edit',
      'customers.view',
      'customers.manage',
      'suppliers.view',
      'suppliers.manage',
      'accounting.view',
      'reports.view',
      'reports.export',
      'users.view',
      'settings.manage',
    ],
  },
  {
    name: 'Manager',
    description: 'Operational manager for sales, customers and suppliers.',
    permissions: [
      'products.view',
      'products.create',
      'products.edit',
      'orders.view',
      'orders.edit',
      'customers.view',
      'customers.manage',
      'suppliers.view',
      'reports.view',
      'reports.export',
    ],
  },
  {
    name: 'Accountant',
    description: 'Handles accounting, invoices, payments and financial reports.',
    permissions: [
      'accounting.view',
      'accounting.manage',
      'reports.view',
      'reports.export',
    ],
  },
  {
    name: 'Sales',
    description: 'Sales representative with access to orders and customer data.',
    permissions: [
      'products.view',
      'orders.view',
      'orders.edit',
      'customers.view',
      'reports.view',
    ],
  },
  {
    name: 'Inventory',
    description: 'Inventory staff focused on product and supplier flows.',
    permissions: [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'suppliers.view',
      'suppliers.manage',
      'reports.view',
    ],
  },
];

async function seedRoles(permissions) {
  const roles = [];

  for (const roleDef of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { description: roleDef.description },
      create: {
        name: roleDef.name,
        description: roleDef.description,
      },
    });

    const permissionRecords = permissions.filter((permission) =>
      roleDef.permissions.includes(permission.slug),
    );

    for (const permissionRecord of permissionRecords) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permissionRecord.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permissionRecord.id,
        },
      });
    }

    roles.push(role);
  }

  return roles;
}

module.exports = {
  seedRoles,
};
