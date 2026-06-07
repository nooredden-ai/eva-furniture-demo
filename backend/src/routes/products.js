const express = require('express');
const router = express.Router();

// Simple read‑only endpoint returning a static product list for testing
router.get('/', (req, res) => {
  const products = [
    { id: 1, name: 'كريم مضيء للوجه - سيروم ذهبي', price: 89, emoji: '✨' },
    { id: 2, name: 'عطر الورد الفاخر', price: 175, emoji: '🌸' },
    { id: 3, name: 'أحمر شفاه مطفي', price: 45, emoji: '💄' }
  ];
  res.json(products);
});

module.exports = router;
