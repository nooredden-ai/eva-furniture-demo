const prisma = require('./prismaClient');

const permissions = [
  { slug: 'products.view', name: 'View Products' },
  { slug: 'products.create', name: 'Create Products' },
  { slug: 'products.edit', name: 'Edit Products' },
  { slug: 'products.delete', name: 'Delete Products' },
  { slug: 'orders.view', name: 'View Orders' },
  { slug: 'orders.edit', name: 'Edit Orders' },
  { slug: 'customers.view', name: 'View Customers' },
  { slug: 'customers.manage', name: 'Manage Customers' },
  { slug: 'suppliers.view', name: 'View Suppliers' },
  { slug: 'suppliers.manage', name: 'Manage Suppliers' },
  { slug: 'accounting.view', name: 'View Accounting' },
  { slug: 'accounting.manage', name: 'Manage Accounting' },
  { slug: 'reports.view', name: 'View Reports' },
  { slug: 'reports.export', name: 'Export Reports' },
  { slug: 'users.view', name: 'View Users' },
  { slug: 'users.manage', name: 'Manage Users' },
  { slug: 'settings.manage', name: 'Manage Settings' },
];

async function seedPermissions() {
  const createdPermissions = [];

  for (const permission of permissions) {
    const record = await prisma.permission.upsert({
      where: { slug: permission.slug },
      update: { name: permission.name },
      create: {
        slug: permission.slug,
        name: permission.name,
        description: permission.name,
      },
    });

    createdPermissions.push(record);
  }

  return createdPermissions;
}

module.exports = {
  seedPermissions,
};
