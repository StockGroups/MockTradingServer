const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');

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

// 数据库配置
const isVercel = process.env.VERCEL === '1';
const dbPath = isVercel 
  ? path.join('/tmp', 'stock.db') 
  : path.join(process.cwd(), 'db', 'stock.db');

// 确保本地开发环境的数据库目录存在
if (!isVercel) {
  const dbDir = path.join(process.cwd(), 'db');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// 数据库实例和SQL模块
let SQL;
let db;

// 初始化数据库连接
async function initDatabase() {
  try {
    if (!SQL) {
      SQL = await initSqlJs({
        locateFile: file => `./node_modules/sql.js/dist/${file}`
      });
    }

    // 读取现有数据库或创建新数据库
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
    
    console.log('数据库初始化成功');
    return db;
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw new Error('数据库连接错误');
  }
}

// 保存数据库更改到文件
function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
      console.log('数据库已保存');
    } catch (error) {
      console.error('保存数据库失败:', error);
    }
  }
}

// 工具函数：执行查询并返回单个值
function getScalar(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const result = stmt.step() ? stmt.get()[0] : null;
  stmt.free();
  return result;
}

// 工具函数：执行查询并返回结果数组
function getResults(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 1. 获取所有股票
app.get('/api/stocks', async (req, res) => {
  try {
    await initDatabase();
    const stocks = getResults('SELECT * FROM stocks ORDER BY id');
    console.log(`返回 ${stocks.length} 只股票数据`);
    res.json(stocks);
  } catch (error) {
    console.error('获取股票列表错误:', error);
    res.status(500).json({ error: `获取股票列表失败: ${error.message}` });
  }
});

// 2. 更新股票价格
app.post('/api/stocks/update-price', async (req, res) => {
  try {
    const { stockId, price } = req.body;
    
    // 验证输入参数
    console.log('收到价格更新请求:', { stockId, price });
    
    if (!stockId || stockId.trim() === '') {
      return res.status(400).json({ error: '请提供有效的股票代码' });
    }
    
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ error: '请提供有效的正价格' });
    }

    await initDatabase();
    
    // 检查股票是否存在
    const stock = getResults('SELECT * FROM stocks WHERE id = ?', [stockId])[0];
    if (!stock) {
      // 获取所有可用股票ID用于调试
      const allStockIds = getResults('SELECT id FROM stocks').map(s => s.id);
      console.log(`股票 ${stockId} 不存在，可用股票:`, allStockIds);
      
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStockIds
      });
    }

    // 执行更新
    const updateStmt = db.prepare('UPDATE stocks SET price = ? WHERE id = ?');
    updateStmt.bind([parsedPrice, stockId]);
    updateStmt.step();
    updateStmt.free();
    
    // 保存更改
    saveDatabase();
    
    // 返回更新后的股票信息
    const updatedStock = getResults('SELECT * FROM stocks WHERE id = ?', [stockId])[0];
    console.log(`股票 ${stockId} 价格已更新为 ${parsedPrice}`);
    
    res.json({ 
      success: true, 
      message: `股票价格更新成功`,
      stock: updatedStock 
    });
  } catch (error) {
    console.error('更新股票价格错误:', error);
    res.status(500).json({ error: `服务器错误: ${error.message}` });
  }
});

// 3. 获取用户投资组合和资产
app.get('/api/portfolio', async (req, res) => {
  try {
    await initDatabase();
    
    // 获取用户余额
    const user = getResults('SELECT * FROM user WHERE id = 1')[0] || { balance: 100000 };

    // 获取持仓
    const portfolio = getResults('SELECT * FROM portfolio');

    // 获取当前股票价格
    const stocks = getResults('SELECT id, price FROM stocks');
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
        value: parseFloat(value.toFixed(2)),
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
      balance: parseFloat(user.balance.toFixed(2)),
      portfolioValue: portfolioStats.totalValue,
      totalAssets,
      portfolioStats
    });
  } catch (error) {
    console.error('获取投资组合错误:', error);
    res.status(500).json({ error: `获取投资组合失败: ${error.message}` });
  }
});

// 4. 买入股票
app.post('/api/buy', async (req, res) => {
  try {
    const { stockId, quantity, price } = req.body;
    
    // 验证输入
    if (!stockId || stockId.trim() === '') {
      return res.status(400).json({ error: '请提供有效的股票代码' });
    }
    
    const parsedQuantity = parseInt(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0 || parsedQuantity % 100 !== 0) {
      return res.status(400).json({ error: '请提供有效的股票数量（100的整数倍）' });
    }

    await initDatabase();
    
    // 获取股票信息
    const stock = getResults('SELECT * FROM stocks WHERE id = ?', [stockId])[0];
    if (!stock) {
      const allStockIds = getResults('SELECT id FROM stocks').map(s => s.id);
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStockIds
      });
    }

    // 计算成本
    const tradePrice = price ? parseFloat(price) : stock.price;
    const totalCost = tradePrice * parsedQuantity;

    // 获取用户余额并检查
    let user = getResults('SELECT * FROM user WHERE id = 1')[0];
    if (!user) {
      // 创建默认用户
      db.run('INSERT INTO user (id, balance) VALUES (1, 100000.00)');
      user = { id: 1, balance: 100000 };
    }

    if (user.balance < totalCost) {
      return res.status(400).json({ 
        error: '余额不足',
        required: totalCost,
        available: user.balance
      });
    }

    // 执行交易（使用事务确保数据一致性）
    try {
      // 更新用户余额
      const newBalance = user.balance - totalCost;
      db.run('UPDATE user SET balance = ? WHERE id = 1', [newBalance]);

      // 检查是否已有持仓
      const holding = getResults('SELECT * FROM portfolio WHERE stockId = ?', [stockId])[0];

      if (holding) {
        // 更新现有持仓
        const newQuantity = holding.quantity + parsedQuantity;
        const newTotalCost = (holding.averagePrice * holding.quantity) + totalCost;
        const newAveragePrice = newTotalCost / newQuantity;
        
        db.run(
          'UPDATE portfolio SET quantity = ?, averagePrice = ? WHERE id = ?',
          [newQuantity, newAveragePrice, holding.id]
        );
      } else {
        // 创建新持仓
        db.run(
          'INSERT INTO portfolio (stockId, stockName, quantity, averagePrice) VALUES (?, ?, ?, ?)',
          [stockId, stock.name, parsedQuantity, tradePrice]
        );
      }

      // 记录交易
      const txId = uuidv4();
      const timestamp = new Date().toISOString();
      db.run(`
        INSERT INTO transactions 
          (id, type, stockId, stockName, quantity, price, total, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        txId, 'buy', stockId, stock.name, parsedQuantity, 
        tradePrice, totalCost, timestamp
      ]);

      // 保存更改
      saveDatabase();

      // 返回结果
      res.json({
        success: true,
        transaction: {
          id: txId,
          type: 'buy',
          stockId,
          stockName: stock.name,
          quantity: parsedQuantity,
          price: tradePrice,
          total: totalCost,
          timestamp
        },
        newBalance: newBalance
      });

      console.log(`买入成功: ${stockId} ${parsedQuantity}股，总价${totalCost}`);
    } catch (error) {
      console.error('买入交易失败:', error);
      res.status(500).json({ error: `交易执行失败: ${error.message}` });
    }
  } catch (error) {
    console.error('买入股票接口错误:', error);
    res.status(500).json({ error: `买入股票失败: ${error.message}` });
  }
});

// 5. 卖出股票
app.post('/api/sell', async (req, res) => {
  try {
    const { stockId, quantity, price } = req.body;
    
    // 验证输入
    if (!stockId || stockId.trim() === '') {
      return res.status(400).json({ error: '请提供有效的股票代码' });
    }
    
    const parsedQuantity = parseInt(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0 || parsedQuantity % 100 !== 0) {
      return res.status(400).json({ error: '请提供有效的股票数量（100的整数倍）' });
    }

    await initDatabase();
    
    // 获取股票信息
    const stock = getResults('SELECT * FROM stocks WHERE id = ?', [stockId])[0];
    if (!stock) {
      const allStockIds = getResults('SELECT id FROM stocks').map(s => s.id);
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStockIds
      });
    }

    // 检查持仓
    const holding = getResults('SELECT * FROM portfolio WHERE stockId = ?', [stockId])[0];
    if (!holding) {
      return res.status(400).json({ error: `没有持仓的股票: ${stockId}` });
    }
    
    if (holding.quantity < parsedQuantity) {
      return res.status(400).json({ 
        error: '持仓数量不足',
        available: holding.quantity,
        requested: parsedQuantity
      });
    }

    // 计算收入
    const tradePrice = price ? parseFloat(price) : stock.price;
    const totalRevenue = tradePrice * parsedQuantity;
    const profitLoss = parseFloat(((tradePrice - holding.averagePrice) * parsedQuantity).toFixed(2));

    // 获取用户余额
    const user = getResults('SELECT * FROM user WHERE id = 1')[0];
    if (!user) {
      return res.status(500).json({ error: '用户数据不存在' });
    }

    // 执行交易
    try {
      // 更新用户余额
      const newBalance = user.balance + totalRevenue;
      db.run('UPDATE user SET balance = ? WHERE id = 1', [newBalance]);

      // 更新持仓
      if (holding.quantity === parsedQuantity) {
        // 全部卖出，删除持仓
        db.run('DELETE FROM portfolio WHERE id = ?', [holding.id]);
      } else {
        // 部分卖出，更新数量
        db.run(
          'UPDATE portfolio SET quantity = ? WHERE id = ?',
          [holding.quantity - parsedQuantity, holding.id]
        );
      }

      // 记录交易
      const txId = uuidv4();
      const timestamp = new Date().toISOString();
      db.run(`
        INSERT INTO transactions 
          (id, type, stockId, stockName, quantity, price, total, profitLoss, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        txId, 'sell', stockId, stock.name, parsedQuantity, 
        tradePrice, totalRevenue, profitLoss, timestamp
      ]);

      // 保存更改
      saveDatabase();

      // 返回结果
      res.json({
        success: true,
        transaction: {
          id: txId,
          type: 'sell',
          stockId,
          stockName: stock.name,
          quantity: parsedQuantity,
          price: tradePrice,
          total: totalRevenue,
          profitLoss,
          timestamp
        },
        newBalance: newBalance
      });

      console.log(`卖出成功: ${stockId} ${parsedQuantity}股，总价${totalRevenue}`);
    } catch (error) {
      console.error('卖出交易失败:', error);
      res.status(500).json({ error: `交易执行失败: ${error.message}` });
    }
  } catch (error) {
    console.error('卖出股票接口错误:', error);
    res.status(500).json({ error: `卖出股票失败: ${error.message}` });
  }
});

// 6. 获取交易记录
app.get('/api/transactions', async (req, res) => {
  try {
    await initDatabase();
    const transactions = getResults('SELECT * FROM transactions ORDER BY timestamp DESC');
    console.log(`返回 ${transactions.length} 条交易记录`);
    res.json(transactions);
  } catch (error) {
    console.error('获取交易记录错误:', error);
    res.status(500).json({ error: `获取交易记录失败: ${error.message}` });
  }
});

// 根路由测试
app.get('/', (req, res) => {
  res.json({ 
    message: '股票交易API服务运行中',
    endpoints: {
      stocks: '/api/stocks',
      updatePrice: '/api/stocks/update-price',
      portfolio: '/api/portfolio',
      buy: '/api/buy',
      sell: '/api/sell',
      transactions: '/api/transactions'
    }
  });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`服务运行在 http://localhost:${PORT}`);
  // 初始化数据库
  initDatabase().catch(err => console.error('启动时初始化数据库失败:', err));
});

module.exports = app;
