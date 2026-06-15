const BaseRepository = require('./baseRepository');

class ExpenseRepository extends BaseRepository {
  constructor() {
    super('expenses.json');
  }

  findById(id) {
    return this.findAll().find(e => String(e.id) === String(id));
  }

  create(data) {
    const items = this.findAll();
    items.push(data);
    this.saveAll(items);
    return data;
  }

  update(id, data) {
    const items = this.findAll();
    const idx = items.findIndex(e => String(e.id) === String(id));
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...data };
    this.saveAll(items);
    return items[idx];
  }

  delete(id) {
    const items = this.findAll();
    const filtered = items.filter(e => String(e.id) !== String(id));
    if (filtered.length === items.length) return false;
    this.saveAll(filtered);
    return true;
  }
}

module.exports = new ExpenseRepository();
