import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';
import { v4: uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: '.env.local' });

// 初始化 Express 应用
const app = express();

// 初始化 Supabase 客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('请配置 SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY 环境变量');
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
    const { data, error } = await supabase.from('stocks').select('count', { count: 'exact', head: true });
    if (error) throw error;
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
    // 检查表是否存在，不存在则创建（Supabase 支持直接执行 SQL）
    const { error: sqlError } = await supabase.rpc('init_tables');
    if (sqlError) {
      // 如果没有初始化函数，手动执行创建表逻辑
      await createTablesIfNotExists();
    }

    // 初始化默认股票数据
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

    // 初始化用户数据
    const { data: userData } = await supabase.from('user').select('*');
    if (userData.length === 0) {
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

// 创建表结构（如果不存在）
async function createTablesIfNotExists() {
  // 在 Supabase 中创建表结构，使用 SQL 执行
  const { error } = await supabase.rpc('exec_sql', {
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

  if (error) throw error;
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
        availableStocks: allStocks.map(row => row.id)
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
    const { data: userData } = await supabase
      .from('user')
      .select('*')
      .eq('id', 1)
      .single();
    const user = userData || { balance: 100000 };

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
      stocksData.map(s => [s.id, s.price])
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

// 启动服务
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
    
    // 对于 Vercel Serverless 函数，不需要监听端口
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

// 启动服务器
startServer();

// 导出 app 供 Vercel Serverless 函数使用
export default app;
