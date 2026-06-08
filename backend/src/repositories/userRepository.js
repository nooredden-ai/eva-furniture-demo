const BaseRepository = require('./baseRepository');

class UserRepository extends BaseRepository {
  constructor() {
    super('users.json');
  }

  findById(id) {
    return this.findAll().find(item => String(item.id) === String(id));
  }

  findByUsername(identifier) {
    const normalized = String(identifier || '').trim().toLowerCase();
    return this.findAll().find(user =>
      String(user.username || '').toLowerCase() === normalized ||
      String(user.email || '').toLowerCase() === normalized
    );
  }

  create(data) {
    const users = this.findAll();
    const newUser = {
      id: 'u' + Date.now().toString(36),
      ...data,
      active: data.active !== false,
      createdAt: new Date().toISOString().split('T')[0]
    };
    users.push(newUser);
    this.saveAll(users);
    return newUser;
  }

  update(id, data) {
    const users = this.findAll();
    const idx = users.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return null;
    users[idx] = { ...users[idx], ...data };
    this.saveAll(users);
    return users[idx];
  }

  delete(id) {
    const users = this.findAll();
    const filtered = users.filter(item => String(item.id) !== String(id));
    this.saveAll(filtered);
    return filtered.length !== users.length;
  }
}

module.exports = new UserRepository();
