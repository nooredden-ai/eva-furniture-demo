function generateNextOrderId(existingOrders = []) {
  const maxNum = existingOrders.reduce((max, order) => {
    const match = String(order.id || '').match(/ORD-(\d+)/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `ORD-${String(maxNum + 1).padStart(3, '0')}`;
}

function createEntityId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  generateNextOrderId,
  createEntityId
};
