const { seedCompany } = require('./companies');
const { seedPermissions } = require('./permissions');
const { seedRoles } = require('./roles');
const { seedAdminUser } = require('./users');
const { seedChartOfAccounts } = require('./accounts');
const prisma = require('./prismaClient');

async function main() {
  console.log('Starting seed process for EVA Furniture...');

  const company = await seedCompany();
  const permissions = await seedPermissions();
  const roles = await seedRoles(permissions);
  const superAdminRole = roles.find((role) => role.name === 'Super Admin');

  if (!superAdminRole) {
    throw new Error('Super Admin role was not created successfully.');
  }

  const adminUser = await seedAdminUser(company.id, superAdminRole.id);
  const accounts = await seedChartOfAccounts(company.id);

  console.log('Seed completed successfully.');
  console.log('Company:', company.name);
  console.log('Admin user:', adminUser.username);
  console.log('Roles created:', roles.map((role) => role.name).join(', '));
  console.log('Chart of accounts created:', accounts.map((account) => `${account.accountCode} ${account.name}`).join(', '));
  console.log('If you used the default password, update it after first login.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
