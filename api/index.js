const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// 加载环境变量（本地开发用，Vercel 会自动读取环境变量）
dotenv.config({ path: '.env.local' });

// 初始化 Express 应用
const app = express();

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('请在 Vercel 配置 SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY 环境变量');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false // 服务器环境禁用会话持久化
  }
});

// 工具函数：日志记录
const log = (message, data = {}) => {
  console.log(`[${new Date().toISOString()}] ${message}`, Object.keys(data).length ? data : '');
};

// 工具函数：错误日志记录
const logError = (message, error) => {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error.stack || error.message);
};

// 测试 Supabase 连接
async function testSupabaseConnection() {
  try {
    // 测试查询（允许表不存在的情况，首次初始化会自动创建）
    const { error } = await supabase.from('stocks').select('id', { count: 'exact', head: true });
    if (error && error.code !== '42P01') throw error; // 忽略"表不存在"错误
    log('Supabase 连接成功');
    return true;
  } catch (error) {
    logError('Supabase 连接失败', error);
    return false;
  }
}

// 初始化数据库表结构
async function initDatabase() {
  try {
    // 1. 创建表结构（使用 Supabase SQL 接口，需服务角色密钥）
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
      // 使用服务角色密钥创建表（权限更高）
      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
      
      const { error: createError } = await adminSupabase.rpc('exec_sql', {
        sql: `
          -- 股票表
          CREATE TABLE IF NOT EXISTS stocks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0.01,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          -- 用户表
          CREATE TABLE IF NOT EXISTS "user" (
            id INTEGER PRIMARY KEY DEFAULT 1,
            balance REAL NOT NULL DEFAULT 100000.00,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(id)
          );

          -- 持仓表
          CREATE TABLE IF NOT EXISTS portfolio (
            id SERIAL PRIMARY KEY,
            stockId TEXT NOT NULL,
            stockName TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
            averagePrice REAL NOT NULL DEFAULT 0.01 CHECK (averagePrice > 0),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stockId) REFERENCES stocks(id),
            UNIQUE(stockId)
          );

          -- 交易记录表
          CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
            stockId TEXT NOT NULL,
            stockName TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            price REAL NOT NULL CHECK (price > 0),
            total REAL NOT NULL CHECK (total > 0),
            profitLoss REAL,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stockId) REFERENCES stocks(id)
          );
        `
      });

      if (createError) {
        logError('创建表结构时警告（可能已存在）', createError);
      }
    } else {
      log('警告：未配置 SUPABASE_SERVICE_ROLE_KEY，将使用匿名密钥初始化（可能权限不足）');
    }

    // 2. 初始化默认股票数据（如果表为空）
    const { data: stockCount } = await supabase.from('stocks').select('*', { count: 'exact', head: true });
    if (stockCount === 0) {
      const stocks = [
        { id: '600036', name: '招商银行', price: 32.65 },
        { id: '601318', name: '中国平安', price: 42.80 },
        { id: '600519', name: '贵州茅台', price: 1725.00 },
        { id: '000858', name: '五粮液', price: 168.50 },
        { id: '000333', name: '美的集团', price: 56.30 },
        { id: '600028', name: '中国石化', price: 4.38 },
        { id: '601899', name: '紫金矿业', price: 9.82 },
        { id: '002594', name: '比亚迪', price: 258.60 },
        { id: '601012', name: '隆基绿能', price: 38.45 },
        { id: '600900', name: '长江电力', price: 22.76 }
      ];

      const { error } = await supabase.from('stocks').insert(stocks);
      if (error) throw error;
      log('初始化默认股票数据成功', { count: stocks.length });
    }

    // 3. 初始化用户数据
    const { data: userData } = await supabase.from('user').select('*');
    if (!userData || userData.length === 0) {
      const { error } = await supabase.from('user').insert([
        { id: 1, balance: 100000.00 }
      ]);
      if (error) throw error;
      log('初始化用户数据成功');
    }

    log('数据库初始化完成');
    return true;
  } catch (error) {
    logError('数据库初始化失败', error);
    return false;
  }
}

// 中间件配置
app.use(bodyParser.json());

// CORS 配置
const allowedOrigins = [
  'https://stockgroups.github.io',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
      callback(null, origin || '*');
    } else {
      callback(new Error(`CORS 禁止访问：不允许的源 ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

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
      message: '请提供有效的股票数量（100的整数倍）'
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
      message: '请提供有效的正价格'
    };
  }
  return { valid: true, parsed };
};

// 1. 获取所有股票
app.get('/api/stocks', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stocks')
      .select('*')
      .order('id');

    if (error) throw error;
    log('获取股票列表成功', { count: data.length });
    res.json(data);
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
    const { data: stockData, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('id', stockId)
      .single();
    
    if (stockError) {
      // 获取所有可用股票ID
      const { data: allStocks } = await supabase.from('stocks').select('id');
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStocks ? allStocks.map(row => row.id) : []
      });
    }

    // 执行更新
    const { data: updatedStock, error: updateError } = await supabase
      .from('stocks')
      .update({ 
        price: priceValidation.parsed,
        updated_at: new Date()
      })
      .eq('id', stockId)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    log('股票价格更新成功', { stockId, newPrice: priceValidation.parsed });
    res.json({ 
      success: true, 
      message: '股票价格更新成功',
      stock: updatedStock 
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
    const { data: userData, error: userError } = await supabase
      .from('user')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (userError) {
      log('用户数据不存在，使用默认值');
      userData = { balance: 100000 };
    }
    const user = userData;

    // 获取持仓
    const { data: portfolioData } = await supabase
      .from('portfolio')
      .select('*');
    const portfolio = portfolioData || [];

    // 获取当前股票价格
    const { data: stocksData } = await supabase
      .from('stocks')
      .select('id, price');
    const stockPriceMap = Object.fromEntries(
      stocksData ? stocksData.map(s => [s.id, s.price]) : []
    );

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

    // 获取股票信息
    const { data: stockData, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('id', stockId)
      .single();
    
    if (stockError) {
      // 获取所有可用股票ID
      const { data: allStocks } = await supabase.from('stocks').select('id');
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStocks ? allStocks.map(row => row.id) : []
      });
    }
    const stock = stockData;

    // 计算成本
    const tradePrice = parsedPrice || stock.price;
    const totalCost = tradePrice * parsedQuantity;

    // 获取用户余额并检查
    let { data: userData, error: userError } = await supabase
      .from('user')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (userError) {
      // 创建默认用户
      await supabase
        .from('user')
        .insert([{ id: 1, balance: 100000.00 }]);
      
      userData = { id: 1, balance: 100000.00 };
    }

    if (userData.balance < totalCost) {
      return res.status(400).json({ 
        error: '余额不足',
        required: parseFloat(totalCost.toFixed(2)),
        available: parseFloat(userData.balance.toFixed(2))
      });
    }

    // 检查是否已有持仓
    const { data: holdingData } = await supabase
      .from('portfolio')
      .select('*')
      .eq('stockId', stockId)
      .single();

    if (holdingData) {
      // 更新现有持仓
      const newQuantity = holdingData.quantity + parsedQuantity;
      const newTotalCost = (holdingData.averagePrice * holdingData.quantity) + totalCost;
      const newAveragePrice = newTotalCost / newQuantity;
      
      await supabase
        .from('portfolio')
        .update({ 
          quantity: newQuantity, 
          averagePrice: newAveragePrice, 
          updated_at: new Date()
        })
        .eq('id', holdingData.id);
    } else {
      // 创建新持仓
      await supabase
        .from('portfolio')
        .insert([{
          stockId, 
          stockName: stock.name, 
          quantity: parsedQuantity, 
          averagePrice: tradePrice
        }]);
    }

    // 更新用户余额
    const newBalance = userData.balance - totalCost;
    await supabase
      .from('user')
      .update({ 
        balance: newBalance, 
        updated_at: new Date()
      })
      .eq('id', 1);

    // 记录交易
    const txId = uuidv4();
    const timestamp = new Date();
    await supabase
      .from('transactions')
      .insert([{
        id: txId, 
        type: 'buy', 
        stockId, 
        stockName: stock.name, 
        quantity: parsedQuantity, 
        price: tradePrice, 
        total: totalCost, 
        timestamp
      }]);
    
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
    logError('买入股票错误', error);
    res.status(500).json({ error: `买入股票失败: ${error.message}` });
  }
});

// 5. 卖出股票
app.post('/api/sell', async (req, res) => {
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

    // 获取股票信息
    const { data: stockData, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('id', stockId)
      .single();
    
    if (stockError) {
      // 获取所有可用股票ID
      const { data: allStocks } = await supabase.from('stocks').select('id');
      return res.status(404).json({ 
        error: `股票不存在 (代码: ${stockId})`,
        availableStocks: allStocks ? allStocks.map(row => row.id) : []
      });
    }
    const stock = stockData;

    // 检查持仓
    const { data: holdingData, error: holdingError } = await supabase
      .from('portfolio')
      .select('*')
      .eq('stockId', stockId)
      .single();
    
    if (holdingError || !holdingData) {
      return res.status(400).json({ error: `没有持仓的股票: ${stockId}` });
    }
    
    if (holdingData.quantity < parsedQuantity) {
      return res.status(400).json({ 
        error: '持仓数量不足',
        available: holdingData.quantity,
        requested: parsedQuantity
      });
    }

    // 计算收入
    const tradePrice = parsedPrice || stock.price;
    const totalRevenue = tradePrice * parsedQuantity;
    const profitLoss = parseFloat(((tradePrice - holdingData.averagePrice) * parsedQuantity).toFixed(2));

    // 获取用户余额
    const { data: userData, error: userError } = await supabase
      .from('user')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (userError || !userData) {
      return res.status(500).json({ error: '用户数据不存在' });
    }

    // 更新用户余额
    const newBalance = userData.balance + totalRevenue;
    await supabase
      .from('user')
      .update({ 
        balance: newBalance, 
        updated_at: new Date()
      })
      .eq('id', 1);

    // 更新持仓
    if (holdingData.quantity === parsedQuantity) {
      // 全部卖出，删除持仓
      await supabase
        .from('portfolio')
        .delete()
        .eq('id', holdingData.id);
    } else {
      // 部分卖出，更新数量
      await supabase
        .from('portfolio')
        .update({ 
          quantity: holdingData.quantity - parsedQuantity, 
          updated_at: new Date()
        })
        .eq('id', holdingData.id);
    }

    // 记录交易
    const txId = uuidv4();
    const timestamp = new Date();
    await supabase
      .from('transactions')
      .insert([{
        id: txId, 
        type: 'sell', 
        stockId, 
        stockName: stock.name, 
        quantity: parsedQuantity, 
        price: tradePrice, 
        total: totalRevenue, 
        profitLoss,
        timestamp
      }]);
    
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
    logError('卖出股票错误', error);
    res.status(500).json({ error: `卖出股票失败: ${error.message}` });
  }
});

// 6. 获取交易记录（支持分页）
app.get('/api/transactions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // 获取总记录数
    const { count: total } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true });
    
    // 获取当前页记录
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    
    log('获取交易记录成功', { 
      page, 
      limit, 
      total,
      currentCount: data ? data.length : 0 
    });
    
    res.json({
      transactions: data || [],
      pagination: {
        page,
        limit,
        total: total || 0,
        pages: total ? Math.ceil(total / limit) : 0
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
  
  try {
    // 使用服务角色密钥执行删除操作（需要更高权限）
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return res.status(403).json({ error: '未配置 SUPABASE_SERVICE_ROLE_KEY，无法执行重置' });
    }
    
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
    
    // 清空数据但保留表结构
    await adminSupabase.from('transactions').delete().neq('id', '');
    await adminSupabase.from('portfolio').delete().neq('id', '');
    await adminSupabase
      .from('user')
      .update({ balance: 100000.00, updated_at: new Date() })
      .eq('id', 1);
    
    log('数据库已重置');
    res.json({ success: true, message: '数据库已重置' });
  } catch (error) {
    logError('重置数据库错误', error);
    res.status(500).json({ error: `重置数据库失败: ${error.message}` });
  }
});

// 根路由测试
app.get('/', (req, res) => {
  res.json({ 
    message: '股票交易API服务运行中',
    database: 'Supabase',
    environment: process.env.NODE_ENV || 'development',
    allowedOrigins: allowedOrigins,
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

// 启动服务（本地开发用，Vercel 会自动处理）
async function startServer() {
  try {
    // 测试 Supabase 连接
    const isConnected = await testSupabaseConnection();
    if (!isConnected) {
      log('Supabase 连接失败，5秒后重试...');
      setTimeout(startServer, 5000);
      return;
    }
    
    // 初始化数据库
    await initDatabase();
    
    // 本地开发才需要监听端口
    if (process.env.NODE_ENV !== 'production') {
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        log(`服务运行在 http://localhost:${PORT}`);
      });
    }
  } catch (error) {
    logError('启动服务失败', error);
    process.exit(1);
  }
}

// 启动服务器（本地开发时执行）
if (process.env.NODE_ENV !== 'production') {
  startServer();
}

// 导出 app 供 Vercel Serverless 函数使用
module.exports = app;
