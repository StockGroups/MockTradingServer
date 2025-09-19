const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// 跨域配置
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(bodyParser.json());

// 数据库连接（Vercel 允许 /tmp 临时存储，本地开发用项目内 db 目录）
const isVercel = process.env.VERCEL === '1';
const dbPath = isVercel 
  ? path.join('/tmp', 'stock.db') 
  : path.join(process.cwd(), 'db', 'stock.db');

// 确保数据库目录存在（Vercel 无需创建 /tmp，本地需确保 db 目录存在）
if (!isVercel) {
  const fs = require('fs');
  const dbDir = path.join(process.cwd(), 'db');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// 初始化数据库（首次运行时创建表和默认数据）
require('../db/init');
const db = new Database(dbPath);

// -------------------------- 路由定义 --------------------------
// 1. 获取所有股票
app.get('/api/stocks', (req, res) => {
  try {
    const getStocks = db.prepare('SELECT * FROM stocks');
    const stocks = getStocks.all();
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 更新股票价格
app.post('/api/stocks/update-price', (req, res) => {
  try {
    const { stockId, price } = req.body;
    if (!stockId || price === undefined || price <= 0) {
      return res.status(400).json({ error: '请提供有效的股票代码和正的价格' });
    }

    const updatePrice = db.prepare('UPDATE stocks SET price = ? WHERE id = ?');
    const result = updatePrice.run(price, stockId);

    if (result.changes === 0) {
      return res.status(404).json({ error: '股票不存在' });
    }

    const getStock = db.prepare('SELECT * FROM stocks WHERE id = ?');
    const stock = getStock.get(stockId);
    res.json({ success: true, stock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. 获取用户投资组合和资产
app.get('/api/portfolio', (req, res) => {
  try {
    // 获取用户余额
    const getUser = db.prepare('SELECT * FROM user WHERE id = 1');
    const user = getUser.get() || { balance: 100000 };

    // 获取持仓
    const getPortfolio = db.prepare('SELECT * FROM portfolio');
    const portfolio = getPortfolio.all();

    // 获取当前股票价格
    const getStocks = db.prepare('SELECT id, price FROM stocks');
    const stocks = getStocks.all();
    const stockPriceMap = Object.fromEntries(stocks.map(s => [s.id, s.price]));

    // 计算持仓统计
    let totalValue = 0;
    let totalCost = 0;
    let totalProfitLoss = 0;
    const portfolioStats = { stocks: [] };

    portfolio.forEach(holding => {
      const currentPrice = stockPriceMap[holding.stockId] || 0;
      const value = currentPrice * holding.quantity;
      const cost = holding.averagePrice * holding.quantity;
      const profitLoss = value - cost;

      totalValue += value;
      totalCost += cost;
      totalProfitLoss += profitLoss;

      portfolioStats.stocks.push({
        stockId: holding.stockId,
        stockName: holding.stockName,
        quantity: holding.quantity,
        averagePrice: holding.averagePrice,
        currentPrice,
        value,
        profitLoss: parseFloat(profitLoss.toFixed(2)),
        profitLossPercent: parseFloat(((profitLoss / cost) * 100).toFixed(2))
      });
    });

    // 计算总资产
    const totalAssets = parseFloat((user.balance + totalValue).toFixed(2));
    portfolioStats.totalValue = parseFloat(totalValue.toFixed(2));
    portfolioStats.totalCost = parseFloat(totalCost.toFixed(2));
    portfolioStats.totalProfitLoss = parseFloat(totalProfitLoss.toFixed(2));
    portfolioStats.totalProfitLossPercent = totalCost > 0 
      ? parseFloat(((totalProfitLoss / totalCost) * 100).toFixed(2)) 
      : 0;

    res.json({
      balance: user.balance,
      portfolioValue: portfolioStats.totalValue,
      totalAssets,
      portfolioStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. 买入股票
app.post('/api/buy', (req, res) => {
  try {
    const { stockId, quantity, price } = req.body;
    if (!stockId || !quantity || quantity <= 0 || quantity % 100 !== 0) {
      return res.status(400).json({ error: '请提供有效的股票代码和100股的整数倍数量' });
    }

    // 获取股票信息
    const getStock = db.prepare('SELECT * FROM stocks WHERE id = ?');
    const stock = getStock.get(stockId);
    if (!stock) {
      return res.status(404).json({ error: '股票不存在' });
    }

    // 计算成本（优先用前端传递的价格，否则用当前市场价格）
    const tradePrice = price || stock.price;
    const totalCost = tradePrice * quantity;

    // 获取用户余额并检查
    const getUser = db.prepare('SELECT * FROM user WHERE id = 1');
    const user = getUser.get();
    if (user.balance < totalCost) {
      return res.status(400).json({ error: '余额不足' });
    }

    // 检查是否已有持仓
    const getHolding = db.prepare('SELECT * FROM portfolio WHERE stockId = ?');
    const holding = getHolding.get(stockId);

    const transaction = db.transaction(() => {
      // 更新用户余额
      const updateUser = db.prepare('UPDATE user SET balance = ? WHERE id = 1');
      updateUser.run(parseFloat((user.balance - totalCost).toFixed(2)));

      if (holding) {
        // 已有持仓：更新平均成本和数量
        const newQuantity = holding.quantity + quantity;
        const newTotalCost = (holding.averagePrice * holding.quantity) + totalCost;
        const newAveragePrice = parseFloat((newTotalCost / newQuantity).toFixed(2));

        const updateHolding = db.prepare('UPDATE portfolio SET quantity = ?, averagePrice = ? WHERE id = ?');
        updateHolding.run(newQuantity, newAveragePrice, holding.id);
      } else {
        // 新增持仓
        const insertHolding = db.prepare('INSERT INTO portfolio (stockId, stockName, quantity, averagePrice) VALUES (?, ?, ?, ?)');
        insertHolding.run(stockId, stock.name, quantity, tradePrice);
      }

      // 记录交易
      const txId = uuidv4();
      const insertTx = db.prepare(`
        INSERT INTO transactions (id, type, stockId, stockName, quantity, price, total, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertTx.run(
        txId,
        'buy',
        stockId,
        stock.name,
        quantity,
        tradePrice,
        totalCost,
        new Date().toISOString()
      );

      return { txId };
    });

    const { txId } = transaction();

    // 返回更新后的数据
    const updatedUser = getUser.get();
    const getUpdatedPortfolio = db.prepare('SELECT * FROM portfolio');
    const updatedPortfolio = getUpdatedPortfolio.all();

    res.json({
      success: true,
      transaction: { id: txId, type: 'buy', stockId, stockName: stock.name, quantity, price: tradePrice, total: totalCost },
      balance: updatedUser.balance
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. 卖出股票
app.post('/api/sell', (req, res) => {
  try {
    const { stockId, quantity, price } = req.body;
    if (!stockId || !quantity || quantity <= 0 || quantity % 100 !== 0) {
      return res.status(400).json({ error: '请提供有效的股票代码和100股的整数倍数量' });
    }

    // 获取股票信息
    const getStock = db.prepare('SELECT * FROM stocks WHERE id = ?');
    const stock = getStock.get(stockId);
    if (!stock) {
      return res.status(404).json({ error: '股票不存在' });
    }

    // 获取持仓并检查
    const getHolding = db.prepare('SELECT * FROM portfolio WHERE stockId = ?');
    const holding = getHolding.get(stockId);
    if (!holding || holding.quantity < quantity) {
      return res.status(400).json({ error: '持仓数量不足' });
    }

    // 计算收入（优先用前端传递的价格，否则用当前市场价格）
    const tradePrice = price || stock.price;
    const totalRevenue = tradePrice * quantity;
    const profitLoss = parseFloat(((tradePrice - holding.averagePrice) * quantity).toFixed(2));

    // 获取用户余额
    const getUser = db.prepare('SELECT * FROM user WHERE id = 1');
    const user = getUser.get();

    const transaction = db.transaction(() => {
      // 更新用户余额
      const updateUser = db.prepare('UPDATE user SET balance = ? WHERE id = 1');
      updateUser.run(parseFloat((user.balance + totalRevenue).toFixed(2)));

      // 更新持仓
      if (holding.quantity === quantity) {
        // 全部卖出：删除持仓
        const deleteHolding = db.prepare('DELETE FROM portfolio WHERE id = ?');
        deleteHolding.run(holding.id);
      } else {
        // 部分卖出：减少数量
        const updateHolding = db.prepare('UPDATE portfolio SET quantity = ? WHERE id = ?');
        updateHolding.run(holding.quantity - quantity, holding.id);
      }

      // 记录交易
      const txId = uuidv4();
      const insertTx = db.prepare(`
        INSERT INTO transactions (id, type, stockId, stockName, quantity, price, total, profitLoss, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertTx.run(
        txId,
        'sell',
        stockId,
        stock.name,
        quantity,
        tradePrice,
        totalRevenue,
        profitLoss,
        new Date().toISOString()
      );

      return { txId };
    });

    const { txId } = transaction();

    // 返回更新后的数据
    const updatedUser = getUser.get();

    res.json({
      success: true,
      transaction: { id: txId, type: 'sell', stockId, stockName: stock.name, quantity, price: tradePrice, total: totalRevenue, profitLoss },
      balance: updatedUser.balance
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. 获取交易记录
app.get('/api/transactions', (req, res) => {
  try {
    const getTx = db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC');
    const transactions = getTx.all();
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`服务运行在 http://localhost:${PORT}`);
});

module.exports = app;