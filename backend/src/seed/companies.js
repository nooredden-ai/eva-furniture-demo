const prisma = require('./prismaClient');

async function seedCompany() {
  const companyName = 'EVA Furniture';

  const existingCompany = await prisma.company.findFirst({
    where: { name: companyName },
  });

  if (existingCompany) {
    return prisma.company.update({
      where: { id: existingCompany.id },
      data: {
        currencyCode: 'ILS',
        timezone: 'Asia/Jerusalem',
        locale: 'ar-IL',
        isActive: true,
      },
    });
  }

  return prisma.company.create({
    data: {
      name: companyName,
      currencyCode: 'ILS',
      timezone: 'Asia/Jerusalem',
      locale: 'ar-IL',
      isActive: true,
    },
  });
}

module.exports = {
  seedCompany,
};
