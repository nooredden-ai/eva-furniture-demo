const BaseRepository = require('./baseRepository');
const { createEntityId } = require('../utils/idUtils');

class CategoryRepository extends BaseRepository {
  constructor() {
    super('categories.json');
  }

  findById(id) {
    return this.findAll().find(item => String(item.id) === String(id));
  }

  create(data) {
    const categories = this.findAll();
    const newCategory = {
      id: String(data.name || 'category').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now().toString(36),
      name: data.name,
      emoji: data.emoji || '🛍️',
      image: data.image || ''
    };
    categories.push(newCategory);
    this.saveAll(categories);
    return newCategory;
  }

  update(id, data) {
    const categories = this.findAll();
    const idx = categories.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return null;
    categories[idx] = { ...categories[idx], ...data };
    this.saveAll(categories);
    return categories[idx];
  }

  delete(id) {
    const categories = this.findAll();
    const filtered = categories.filter(item => String(item.id) !== String(id));
    this.saveAll(filtered);
    return filtered.length !== categories.length;
  }
}

module.exports = new CategoryRepository();
