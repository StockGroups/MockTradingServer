const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: '.env.local' });

// 初始化Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 配置PostgreSQL连接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // 连接池最大连接数
  idleTimeoutMillis: 30000, // 连接空闲超时时间
  connectionTimeoutMillis: 5000 // 连接超时时间
});

// 工具函数：日志记录
const log = (message, data = {}) => {
  console.log(`[${new Date().toISOString()}] ${message}`, Object.keys(data).length ? data : '');
};

// 工具函数：错误日志记录
const logError = (message, error) => {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error.stack || error.message);
};

// 测试数据库连接
async function testDbConnection() {
  try {
    console.log('NODE_ENV:', process.env.NODE_ENV);
    const client = await pool.connect();
    log('PostgreSQL连接成功');
    client.release();
    return true;
  } catch (err) {
    logError('PostgreSQL连接失败', err);
    return false;
  }
}

// 初始化数据库表结构
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. 股票表
    await client.query(`
      CREATE TABLE IF NOT EXISTS stocks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0.01,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. 用户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id INTEGER PRIMARY KEY DEFAULT 1,
        balance REAL NOT NULL DEFAULT 100000.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(id)
      );
    `);

    // 3. 持仓表
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id SERIAL PRIMARY KEY,
        stockId TEXT NOT NULL,
        stockName TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        averagePrice REAL NOT REAL NOT NULL DEFAULT 0.01 CHECK (averagePrice > 0),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stockId) REFERENCES stocks(id),
        UNIQUE(stockId)
      );
    `);

    // 4. 交易记录表
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
        stockId TEXT NOT NULL,
        stockName TEXT NOT NULL,
        quantity INTEGER INTEGER INTEGER NOT NULL CHECK (quantity > 0),
        price REAL NOT NULL CHECK (price > 0),
        total REAL NOT NULL CHECK (total > 0),
        profitLoss REAL,
        timestamp TIMESTAMP WITH TIME ZONE NOT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stockId) REFERENCES stocks(id)
      );
    `);

    // 添加更新时间的触发器函数
    await client.query(`
      CREATE OR REPLACE FUNCTION update_modified_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 为各表添加更新时间触发器
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_stocks_updated_at') THEN
          CREATE TRIGGER update_stocks_updated_at
          BEFORE UPDATE ON stocks
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_updated_at') THEN
          CREATE TRIGGER update_user_updated_at
          BEFORE UPDATE ON "user"
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_portfolio_updated_at') THEN
          CREATE TRIGGER update_portfolio_updated_at
          BEFORE UPDATE ON portfolio
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
        END IF;
      END $$;
    `);

    // 初始化默认股票数据（如果表为空）
    const stockCount = await client.query('SELECT COUNT(*) FROM stocks');
    if (parseInt(stockCount.rows[0].count) === 0) {
      const stocks = [
        ['600036', '招商银行', 32.65],
        ['601318', '中国平安', 42.80],
        ['600519', '贵州茅台', 1725.00],
        ['000858', '五粮液', 168.50],
        ['000333', '美的集团', 56.30],
        ['600028', '中国石化', 4.38],
        ['601899', '紫金矿业', 9.82],
        ['002594', '比亚迪', 258.60],
        ['601012', '隆基绿能', 38.45],
        ['600900', '长江电力', 22.76]
      ];
      
      // 使用批量插入提高效率
      const values = stocks.map((_, index) => 
        `($${index*3+1}, $${index*3+2}, $${index*3+3})`
      ).join(',');
      
      const params = stocks.flatMap(stock => [stock[0], stock[1], stock[2]]);
      
      await client.query(
        `INSERT INTO stocks (id, name, price) VALUES ${values}`,
        params
      );
      
      log('初始化默认股票数据成功', { count: stocks.length });
    }

    // 初始化用户数据（如果表为空）
    const userCount = await client.query('SELECT COUNT(*) FROM "user"');
    if (parseInt(userCount.rows[0].count) === 0) {
      await client.query(
        'INSERT INTO "user" (id, balance) VALUES (1, 100000.00)'
      );
      log('初始化用户数据成功');
    }

    await client.query('COMMIT');
    log('数据库初始化完成');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    logError('数据库初始化失败', e);
    return false;
  } finally {
    client.release();
  }
}

// 中间件：请求日志
app.use((req, res, next) => {
  log(`收到请求: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    body: req.method !== 'GET' ? req.body : undefined
  });
  next();
});

// ===================== 核心修复：CORS 配置 =====================
// 跨域配置（解决原动态校验逻辑问题）
const baseAllowedOrigins = [
  'https://stockgroups.github.io', // 线上前端域名（必须准确）
  'http://localhost:5173',         // 本地调试端口
  'http://localhost:8080',         // Uniapp常见调试端口
  'http://127.0.0.1:5173'          // 兼容IP形式的本地请求
];

// 合并环境变量中的域名
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? [...new Set([...baseAllowedOrigins, ...process.env.ALLOWED_ORIGINS.split(',')])]
  : baseAllowedOrigins;

const corsOptions = {
  origin: (origin, callback) => {
    // 允许规则：无origin、在允许列表内、本地localhost开头
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
      callback(null, origin || '*'); // 关键修复：返回具体origin而非true
    } else {
      callback(new Error(`CORS 禁止访问：不允许的源 ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
  maxAge: 86400
};

// 应用CORS中间件
app.use(cors(corsOptions));

// 处理OPTIONS预检请求
app.options('*', cors(corsOptions));

// 解析请求体
app.use(bodyParser.json());

// 输入验证工具函数
const validateStockId = (stockId) => {
  if (!stockId || typeof stockId !== 'string' || stockId.trim() === '') {
    return { valid: false, message: '请提供有效的股票代码' };
  }
  return { valid: true };
};

const validateQuantity = (quantity) => {
  if (typeof quantity !== 'number' && (typeof quantity !== 'string' || isNaN(quantity))) {
    return { valid: false, message: '股票数量必须是有效数字' };
  }
  const parsed = parseInt(quantity, 10);
  if (isNaN(parsed) || parsed <= 0 || parsed % 100 !== 0) {
    return { 
      valid: false, 
      message: '请提供有效的股票数量（100的整数倍）',
      parsed
    };
  }
  return { valid: true, parsed };
};

const validatePrice = (price) => {
  if (typeof price !== 'number' && (typeof price !== 'string' || isNaN(price))) {
    return { valid: false, message: '价格必须是有效数字' };
  }
  const parsed = parseFloat(price);
  if (isNaN(parsed) || parsed <= 0) {
    return { 
      valid: false, 
      message: '请提供有效的正价格',
      parsed
    };
  }
  return { valid: true, parsed };
};

// 1. 获取所有股票
app.get('/api/stocks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stocks ORDER BY id');
    log('获取股票列表成功', { count: result.rows.length });
    res.json(result.rows);
  } catch (error) {
    logError('获取股票列表错误', error);
    res.status(500).json({ error: `获取股票列表失败: ${error.message}` });
  }
});

// 2. 更新股票价格
app.post('/api/stocks/update-price', async (req, res) => {
  try {
    const { stockId, price } = req.body;
    
    // 验证输入参数
    const stockIdValidation = validateStockId(stockId);
    if (!stockIdValidation.valid) {
      return res.status(400).json({ error: stockIdValidation.message });
    }
    
    const priceValidation = validatePrice(price);
    if (!priceValidation.valid) {
      return res.status(400).json({ error: priceValidation.message });
    }

    // 检查股票是否存在
    const stockResult = await pool.query(
      'SELECT * FROM stocks WHERE id = $1',
      [stockId]
    );
    
    if (stockResult.rows.length === 0) {
      // 获取所有可用股票ID
      const allStocksResult = await pool.query('SELECT id FROM stocks');
      const allStockIds = allStocksResult.rows.map(row => row.id);
      
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStockIds
      });
    }

    // 执行更新
    const updateResult = await pool.query(
      'UPDATE stocks SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [priceValidation.parsed, stockId]
    );
    
    log('股票价格更新成功', { stockId, newPrice: priceValidation.parsed });
    res.json({ 
      success: true, 
      message: `股票价格更新成功`,
      stock: updateResult.rows[0] 
    });
  } catch (error) {
    logError('更新股票价格错误', error);
    res.status(500).json({ error: `服务器错误: ${error.message}` });
  }
});

// 3. 获取用户投资组合和资产
app.get('/api/portfolio', async (req, res) => {
  try {
    // 获取用户余额
    const userResult = await pool.query('SELECT * FROM "user" WHERE id = 1');
    const user = userResult.rows[0] || { balance: 100000 };

    // 获取持仓
    const portfolioResult = await pool.query('SELECT * FROM portfolio');
    const portfolio = portfolioResult.rows;

    // 获取当前股票价格
    const stocksResult = await pool.query('SELECT id, price FROM stocks');
    const stockPriceMap = Object.fromEntries(
      stocksResult.rows.map(s => [s.id, s.price])
    );

    // 计算持仓统计
    let totalValue = 0;
    let totalCost = 0;
    let totalProfitLoss = 0;
    const portfolioStats = { stocks: [] };

    portfolio.forEach(holding => {
      const currentPrice = stockPriceMap[holding.stockid] || 0;
      const value = currentPrice * holding.quantity;
      const cost = holding.averageprice * holding.quantity;
      const profitLoss = value - cost;

      totalValue += value;
      totalCost += cost;
      totalProfitLoss += profitLoss;

      portfolioStats.stocks.push({
        stockId: holding.stockid,
        stockName: holding.stockname,
        quantity: holding.quantity,
        averagePrice: holding.averageprice,
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

    log('获取投资组合成功', { totalAssets, stockCount: portfolioStats.stocks.length });
    res.json({
      balance: parseFloat(user.balance.toFixed(2)),
      portfolioValue: portfolioStats.totalValue,
      totalAssets,
      portfolioStats
    });
  } catch (error) {
    logError('获取投资组合错误', error);
    res.status(500).json({ error: `获取投资组合失败: ${error.message}` });
  }
});

// 4. 买入股票
app.post('/api/buy', async (req, res) => {
  const client = await pool.connect();
  try {
    const { stockId, quantity, price } = req.body;
    
    // 验证输入
    const stockIdValidation = validateStockId(stockId);
    if (!stockIdValidation.valid) {
      return res.status(400).json({ error: stockIdValidation.message });
    }
    
    const quantityValidation = validateQuantity(quantity);
    if (!quantityValidation.valid) {
      return res.status(400).json({ error: quantityValidation.message });
    }
    const parsedQuantity = quantityValidation.parsed;
    
    // 价格可选，会在后续使用股票当前价格
    let parsedPrice = null;
    if (price !== undefined) {
      const priceValidation = validatePrice(price);
      if (!priceValidation.valid) {
        return res.status(400).json({ error: priceValidation.message });
      }
      parsedPrice = priceValidation.parsed;
    }

    await client.query('BEGIN');
    
    // 获取股票信息
    const stockResult = await client.query(
      'SELECT * FROM stocks WHERE id = $1',
      [stockId]
    );
    
    if (stockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const allStocksResult = await pool.query('SELECT id FROM stocks');
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStocksResult.rows.map(row => row.id)
      });
    }
    const stock = stockResult.rows[0];

    // 计算成本
    const tradePrice = parsedPrice || stock.price;
    const totalCost = tradePrice * parsedQuantity;

    // 获取用户余额并检查
    let userResult = await client.query('SELECT * FROM "user" WHERE id = 1');
    let user = userResult.rows[0];
    
    if (!user) {
      // 创建默认用户
      await client.query(
        'INSERT INTO "user" (id, balance) VALUES (1, 100000.00)'
      );
      userResult = await client.query('SELECT * FROM "user" WHERE id = 1');
      user = userResult.rows[0];
    }

    if (user.balance < totalCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: '余额不足',
        required: parseFloat(totalCost.toFixed(2)),
        available: parseFloat(user.balance.toFixed(2))
      });
    }

    // 检查是否已有持仓
    const holdingResult = await client.query(
      'SELECT * FROM portfolio WHERE stockId = $1',
      [stockId]
    );
    const holding = holdingResult.rows[0];

    if (holding) {
      // 更新现有持仓
      const newQuantity = holding.quantity + parsedQuantity;
      const newTotalCost = (holding.averageprice * holding.quantity) + totalCost;
      const newAveragePrice = newTotalCost / newQuantity;
      
      await client.query(
        'UPDATE portfolio SET quantity = $1, averageprice = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newQuantity, newAveragePrice, holding.id]
      );
    } else {
      // 创建新持仓
      await client.query(
        'INSERT INTO portfolio (stockId, stockName, quantity, averageprice) VALUES ($1, $2, $3, $4)',
        [stockId, stock.name, parsedQuantity, tradePrice]
      );
    }

    // 更新用户余额
    const newBalance = user.balance - totalCost;
    await client.query(
      'UPDATE "user" SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [newBalance]
    );

    // 记录交易
    const txId = uuidv4();
    const timestamp = new Date().toISOString();
    await client.query(`
      INSERT INTO transactions 
        (id, type, stockId, stockName, quantity, price, total, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      txId, 'buy', stockId, stock.name, parsedQuantity, 
      tradePrice, totalCost, timestamp
    ]);

    await client.query('COMMIT');
    
    log('股票买入成功', { 
      stockId, 
      quantity: parsedQuantity,
      totalCost,
      transactionId: txId
    });
    
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
      newBalance: parseFloat(newBalance.toFixed(2))
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logError('买入股票错误', error);
    res.status(500).json({ error: `买入股票失败: ${error.message}` });
  } finally {
    client.release();
  }
});

// 5. 卖出股票
app.post('/api/sell', async (req, res) => {
  const client = await pool.connect();
  try {
    const { stockId, quantity, price } = req.body;
    
    // 验证输入
    const stockIdValidation = validateStockId(stockId);
    if (!stockIdValidation.valid) {
      return res.status(400).json({ error: stockIdValidation.message });
    }
    
    const quantityValidation = validateQuantity(quantity);
    if (!quantityValidation.valid) {
      return res.status(400).json({ error: quantityValidation.message });
    }
    const parsedQuantity = quantityValidation.parsed;
    
    // 价格可选，会在后续使用股票当前价格
    let parsedPrice = null;
    if (price !== undefined) {
      const priceValidation = validatePrice(price);
      if (!priceValidation.valid) {
        return res.status(400).json({ error: priceValidation.message });
      }
      parsedPrice = priceValidation.parsed;
    }

    await client.query('BEGIN');
    
    // 获取股票信息
    const stockResult = await client.query(
      'SELECT * FROM stocks WHERE id = $1',
      [stockId]
    );
    
    if (stockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const allStocksResult = await pool.query('SELECT id FROM stocks');
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStocksResult.rows.map(row => row.id)
      });
    }
    const stock = stockResult.rows[0];

    // 检查持仓
    const holdingResult = await client.query(
      'SELECT * FROM portfolio WHERE stockId = $1',
      [stockId]
    );
    
    if (holdingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `没有持仓的股票: ${stockId}` });
    }
    
    const holding = holdingResult.rows[0];
    if (holding.quantity < parsedQuantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: '持仓数量不足',
        available: holding.quantity,
        requested: parsedQuantity
      });
    }

    // 计算收入
    const tradePrice = parsedPrice || stock.price;
    const totalRevenue = tradePrice * parsedQuantity;
    const profitLoss = parseFloat(((tradePrice - holding.averageprice) * parsedQuantity).toFixed(2));

    // 获取用户余额
    const userResult = await client.query('SELECT * FROM "user" WHERE id = 1');
    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: '用户数据不存在' });
    }

    // 更新用户余额
    const newBalance = user.balance + totalRevenue;
    await client.query(
      'UPDATE "user" SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [newBalance]
    );

    // 更新持仓
    if (holding.quantity === parsedQuantity) {
      // 全部卖出，删除持仓
      await client.query(
        'DELETE FROM portfolio WHERE id = $1',
        [holding.id]
      );
    } else {
      // 部分卖出，更新数量
      await client.query(
        'UPDATE portfolio SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [holding.quantity - parsedQuantity, holding.id]
      );
    }

    // 记录交易
    const txId = uuidv4();
    const timestamp = new Date().toISOString();
    await client.query(`
      INSERT INTO transactions 
        (id, type, stockId, stockName, quantity, price, total, profitLoss, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      txId, 'sell', stockId, stock.name, parsedQuantity, 
      tradePrice, totalRevenue, profitLoss, timestamp
    ]);

    await client.query('COMMIT');
    
    log('股票卖出成功', { 
      stockId, 
      quantity: parsedQuantity,
      totalRevenue,
      profitLoss,
      transactionId: txId
    });
    
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
      newBalance: parseFloat(newBalance.toFixed(2))
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logError('卖出股票错误', error);
    res.status(500).json({ error: `卖出股票失败: ${error.message}` });
  } finally {
    client.release();
  }
});

// 6. 获取交易记录（支持分页）
app.get('/api/transactions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // 获取总记录数
    const countResult = await pool.query('SELECT COUNT(*) FROM transactions');
    const total = parseInt(countResult.rows[0].count);
    
    // 获取当前页记录
    const result = await pool.query(
      'SELECT * FROM transactions ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    
    log('获取交易记录成功', { 
      page, 
      limit, 
      total,
      currentCount: result.rows.length 
    });
    
    res.json({
      transactions: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logError('获取交易记录错误', error);
    res.status(500).json({ error: `获取交易记录失败: ${error.message}` });
  }
});

// 7. 重置数据库（开发环境用）
app.post('/api/reset', async (req, res) => {
  // 只允许在开发环境使用
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: '仅开发环境支持重置操作' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 清空数据但保留表结构
    await client.query('DELETE FROM transactions');
    await client.query('DELETE FROM portfolio');
    await client.query('UPDATE "user" SET balance = 100000.00, updated_at = CURRENT_TIMESTAMP WHERE id = 1');
    
    await client.query('COMMIT');
    log('数据库已重置');
    res.json({ success: true, message: '数据库已重置' });
  } catch (error) {
    await client.query('ROLLBACK');
    logError('重置数据库错误', error);
    res.status(500).json({ error: `重置数据库失败: ${error.message}` });
  } finally {
    client.release();
  }
});

// 根路由测试
app.get('/', (req, res) => {
  res.json({ 
    message: '股票交易API服务运行中',
    database: 'PostgreSQL',
    environment: process.env.NODE_ENV || 'development',
    allowedOrigins: allowedOrigins, // 便于调试的配置信息
    endpoints: {
      stocks: '/api/stocks',
      updatePrice: '/api/stocks/update-price',
      portfolio: '/api/portfolio',
      buy: '/api/buy',
      sell: '/api/sell',
      transactions: '/api/transactions',
      reset: '/api/reset (仅开发环境)'
    }
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  logError('未捕获的异常', err);
  res.status(500).json({
    error: '服务器发生未知错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 启动服务
async function startServer() {
  try {
    // 先测试数据库连接
    const dbConnected = await testDbConnection();
    if (!dbConnected) {
      log('数据库连接失败，5秒后重试...');
      setTimeout(startServer, 5000);
      return;
    }
    
    // 初始化数据库
    await initDatabase();
    
    // 启动HTTP服务
    app.listen(PORT, () => {
      log(`服务运行在 http://localhost:${PORT}`);
      log(`环境: ${process.env.NODE_ENV || 'development'}`);
      log(`允许跨域地址: ${allowedOrigins.join(', ')}`);
    });
  } catch (error) {
    logError('启动服务失败', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();

module.exports = app;
