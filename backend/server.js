const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Arabic Store API is running' });
});

// Import Routes (To be created)
// const authRoutes = require('./src/routes/authRoutes');
// const storeRoutes = require('./src/routes/storeRoutes');
// const productRoutes = require('./src/routes/productRoutes');
// const orderRoutes = require('./src/routes/orderRoutes');

// app.use('/api/v1/auth', authRoutes);
// app.use('/api/v1/stores', storeRoutes);
// app.use('/api/v1/products', productRoutes);
// app.use('/api/v1/orders', orderRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
