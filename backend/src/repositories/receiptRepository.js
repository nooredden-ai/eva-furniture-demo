const BaseRepository = require('./baseRepository');

class ReceiptRepository extends BaseRepository {
  constructor() {
    super('receipts.json');
  }

  findById(id) {
    return this.findAll().find(r => String(r.id) === String(id));
  }

  create(data) {
    const items = this.findAll();
    items.push(data);
    this.saveAll(items);
    return data;
  }

  update(id, data) {
    const items = this.findAll();
    const idx = items.findIndex(r => String(r.id) === String(id));
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...data };
    this.saveAll(items);
    return items[idx];
  }
}

module.exports = new ReceiptRepository();
