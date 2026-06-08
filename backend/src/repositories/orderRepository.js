const BaseRepository = require('./baseRepository');
const { generateNextOrderId } = require('../utils/idUtils');

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
