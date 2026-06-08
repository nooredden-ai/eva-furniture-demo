const bcrypt = require('bcryptjs');
const prisma = require('./prismaClient');

async function seedAdminUser(companyId, roleId) {
  const username = 'NoorEdden';
  const email = 'nooredden@eva-furniture.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'TempPass123!';
  const passwordHash = bcrypt.hashSync(password, 10);

  const user = await prisma.user.upsert({
    where: {
      companyId_username: {
        companyId,
        username,
      },
    },
    update: {
      roleId,
      email,
      passwordHash,
      status: 'ACTIVE',
      active: true,
    },
    create: {
      companyId,
      roleId,
      username,
      email,
      passwordHash,
      fullName: 'NoorEdden',
      status: 'ACTIVE',
      active: true,
    },
  });

  return user;
}

module.exports = {
  seedAdminUser,
};
