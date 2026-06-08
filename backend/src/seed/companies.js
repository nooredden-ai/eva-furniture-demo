const prisma = require('./prismaClient');

async function seedCompany() {
  const companyName = 'EVA Furniture';

  const company = await prisma.company.upsert({
    where: { name: companyName },
    update: {
      currencyCode: 'ILS',
      timezone: 'Asia/Jerusalem',
      locale: 'ar-IL',
      isActive: true,
    },
    create: {
      name: companyName,
      currencyCode: 'ILS',
      timezone: 'Asia/Jerusalem',
      locale: 'ar-IL',
      isActive: true,
    },
  });

  return company;
}

module.exports = {
  seedCompany,
};
