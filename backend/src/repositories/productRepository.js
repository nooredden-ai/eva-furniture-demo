const BaseRepository = require('./baseRepository');

class ProductRepository extends BaseRepository {
  constructor() {
    super('products.json');
  }

  findById(id) {
    return this.findAll().find(item => String(item.id) === String(id));
  }

  create(data) {
    const products = this.findAll();
    const maxId = products.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0);
    const newProduct = {
      id: maxId + 1,
      ...data,
      active: data.active !== false
    };
    products.push(newProduct);
    this.saveAll(products);
    return newProduct;
  }

  update(id, data) {
    const products = this.findAll();
    const idx = products.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return null;
    products[idx] = { ...products[idx], ...data };
    this.saveAll(products);
    return products[idx];
  }

  delete(id) {
    const products = this.findAll();
    const filtered = products.filter(item => String(item.id) !== String(id));
    this.saveAll(filtered);
    return filtered.length !== products.length;
  }
}

module.exports = new ProductRepository();
