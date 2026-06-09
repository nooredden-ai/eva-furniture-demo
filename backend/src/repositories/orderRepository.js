const BaseRepository = require('./baseRepository');
const { generateNextOrderId } = require('../utils/idUtils');
const productRepository = require('./productRepository');

class OrderRepository extends BaseRepository {
  constructor() {
    super('orders.json');
  }

  findById(id) {
    return this.findAll().find(item => String(item.id) === String(id));
  }

  findByIdOrNumber(identifier) {
    const key = String(identifier || '').trim();
    return this.findAll().find(item =>
      String(item.id || '').trim() === key ||
      String(item.orderNumber || '').trim() === key
    );
  }

  create(data) {
    const orders = this.findAll();
    const newOrder = {
      id: generateNextOrderId(orders),
      ...data,
      status: data.status || 'pending',
      date: data.date || new Date().toISOString().split('T')[0],
      notes: Array.isArray(data.notes) ? data.notes : data.notes ? [data.notes] : [],
      internalComments: Array.isArray(data.internalComments) ? data.internalComments : [],
      statusHistory: Array.isArray(data.statusHistory) ? data.statusHistory : [],
      lastUpdated: data.lastUpdated || new Date().toISOString()
    };
    orders.push(newOrder);
    this.saveAll(orders);
    return newOrder;
  }

  update(id, data) {
    const orders = this.findAll();
    const idx = orders.findIndex(item => String(item.id) === String(id));
    if (idx === -1) return null;
    orders[idx] = { ...orders[idx], ...data, lastUpdated: new Date().toISOString() };
    this.saveAll(orders);
    return orders[idx];
  }

  updateStatus(id, status, changedBy) {
    const orders = this.findAll();
    const order = orders.find(item => String(item.id) === String(id));
    if (!order) return null;

    if (status === 'confirmed' && !order.stockDeducted) {
      const products = productRepository.findAll();
      const prodById = {};
      const prodByName = {};

      products.forEach(p => {
        prodById[String(p.id)] = p;
        const normalized = String(p.name || '').toLowerCase().trim();
        if (normalized) prodByName[normalized] = p;
      });

      const insufficient = [];
      for (const item of order.items || []) {
        let prod = null;
        if (item.productId != null) prod = prodById[String(item.productId)];
        if (!prod) prod = prodByName[String(item.name || '').toLowerCase().trim()];

        const available = prod && typeof prod.stock !== 'undefined' && prod.stock !== null ? Number(prod.stock) : 0;
        const required = Number(item.qty) || 0;

        if (!prod || available < required) {
          insufficient.push({
            name: item.name || (prod && prod.name) || 'Unknown',
            required,
            available
          });
        }
      }

      if (insufficient.length > 0) {
        return { error: `المخزون غير كافٍ للمنتج: ${insufficient[0].name}` };
      }

      for (const item of order.items || []) {
        let prod = null;
        if (item.productId != null) prod = prodById[String(item.productId)];
        if (!prod) prod = prodByName[String(item.name || '').toLowerCase().trim()];
        const required = Number(item.qty) || 0;
        if (prod) {
          prod.stock = Math.max(0, Number(prod.stock) - required);
        }
      }

      productRepository.saveAll(products);
      order.stockDeducted = true;
    }

    order.status = status;
    order.lastUpdated = new Date().toISOString();
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
    order.statusHistory.push({
      status,
      changedBy: changedBy || 'system',
      date: order.lastUpdated
    });
    this.saveAll(orders);
    return order;
  }

  assign(id, userId) {
    const orders = this.findAll();
    const order = orders.find(item => String(item.id) === String(id));
    if (!order) return null;
    order.assignedTo = userId;
    order.lastUpdated = new Date().toISOString();
    this.saveAll(orders);
    return order;
  }

  addNote(id, note, addedBy) {
    const orders = this.findAll();
    const order = orders.find(item => String(item.id) === String(id));
    if (!order) return null;
    if (!Array.isArray(order.internalComments)) order.internalComments = [];
    order.internalComments.push({
      text: note,
      addedBy: addedBy || 'system',
      date: new Date().toISOString()
    });
    order.lastUpdated = new Date().toISOString();
    this.saveAll(orders);
    return order;
  }

  delete(id) {
    const orders = this.findAll();
    const filtered = orders.filter(item => String(item.id) !== String(id));
    this.saveAll(filtered);
    return filtered.length !== orders.length;
  }
}

module.exports = new OrderRepository();
