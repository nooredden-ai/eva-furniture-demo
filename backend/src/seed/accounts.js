const prisma = require('./prismaClient');

const chartOfAccounts = [
  { accountCode: '1000', name: 'Cash', accountType: 'ASSET' },
  { accountCode: '1010', name: 'Bank', accountType: 'ASSET' },
  { accountCode: '2000', name: 'Liabilities', accountType: 'LIABILITY' },
  { accountCode: '3000', name: 'Equity', accountType: 'EQUITY' },
  { accountCode: '4000', name: 'Revenue', accountType: 'INCOME' },
  { accountCode: '5000', name: 'Expenses', accountType: 'EXPENSE' },
];

async function seedChartOfAccounts(companyId) {
  const accounts = [];

  for (const account of chartOfAccounts) {
    const record = await prisma.accountingAccount.upsert({
      where: {
        companyId_accountCode: {
          companyId,
          accountCode: account.accountCode,
        },
      },
      update: {
        name: account.name,
        accountType: account.accountType,
        currencyCode: 'ILS',
        isActive: true,
      },
      create: {
        companyId,
        accountCode: account.accountCode,
        name: account.name,
        accountType: account.accountType,
        currencyCode: 'ILS',
        isActive: true,
      },
    });

    accounts.push(record);
  }

  return accounts;
}

module.exports = {
  seedChartOfAccounts,
};
