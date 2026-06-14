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
    const parentId = data.parentId && String(data.parentId).trim() ? String(data.parentId).trim() : null;
    const newCategory = {
      id: String(data.name || 'category').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now().toString(36),
      name: data.name,
      emoji: data.emoji || '🛍️',
      image: data.image || '',
      parentId: parentId,
      sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : undefined
    };
    categories.push(newCategory);
    this.saveAll(categories);
    return newCategory;
  }

  update(id, data) {
    const categories = this.findAll();
    const idx = categories.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return null;
    const safeData = { ...data };
    if ('parentId' in data) {
      safeData.parentId = data.parentId && String(data.parentId).trim() ? String(data.parentId).trim() : null;
    }
    categories[idx] = { ...categories[idx], ...safeData };
    this.saveAll(categories);
    return categories[idx];
  }

  delete(id) {
    const categories = this.findAll();
    const filtered = categories.filter(item => String(item.id) !== String(id));
    this.saveAll(filtered);
    return filtered.length !== categories.length;
  }

  findChildren(id) {
    return this.findAll().filter(item => String(item.parentId) === String(id));
  }

  reassignChildrenToRoot(id) {
    const categories = this.findAll();
    let changed = false;
    categories.forEach(cat => {
      if (String(cat.parentId) === String(id)) {
        cat.parentId = null;
        changed = true;
      }
    });
    if (changed) this.saveAll(categories);
    return changed;
  }
}

module.exports = new CategoryRepository();
