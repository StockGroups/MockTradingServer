const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { promises: fs } = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// 初始化Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 配置跨域（必须在所有中间件和路由之前）
app.use(cors({
  origin: 'http://localhost:5173', // 允许Uniapp前端地址
  methods: ['GET', 'POST', 'OPTIONS'], // 支持的HTTP方法
  allowedHeaders: ['Content-Type'], // 允许的请求头
  credentials: true, // 允许携带凭证
  maxAge: 86400 // 预检请求缓存时间（24小时）
}));

// 解析JSON请求体
app.use(bodyParser.json());

// 数据文件路径配置
const DATA_DIR = path.join(__dirname, '../data');
const USER_FILE = path.join(DATA_DIR, 'user.json');
const STOCKS_FILE = path.join(DATA_DIR, 'stocks.json');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');

/**
 * 初始化数据目录和文件
 */
async function initializeData() {
  try {
    // 确保数据目录存在
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('创建数据目录成功:', DATA_DIR);
  }

  // 初始化用户数据
  await initializeUserFile();
  
  // 初始化股票数据
  await initializeStocksFile();
  
  // 初始化交易记录
  await initializeTransactionsFile();
}

/**
 * 初始化用户数据文件
 */
async function initializeUserFile() {
  try {
    await fs.access(USER_FILE);
  } catch {
    const initialUser = {
      balance: 100000, // 初始资金10万元
      portfolio: [] // 持仓列表
    };
    await fs.writeFile(USER_FILE, JSON.stringify(initialUser, null, 2));
    console.log('初始化用户数据成功');
  }
}

/**
 * 初始化股票数据文件
 */
async function initializeStocksFile() {
  try {
    await fs.access(STOCKS_FILE);
  } catch {
    const initialStocks = [
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
    await fs.writeFile(STOCKS_FILE, JSON.stringify(initialStocks, null, 2));
    console.log('初始化股票数据成功');
  }
}

/**
 * 初始化交易记录文件
 */
async function initializeTransactionsFile() {
  try {
    await fs.access(TRANSACTIONS_FILE);
  } catch {
    await fs.writeFile(TRANSACTIONS_FILE, JSON.stringify([], null, 2));
    console.log('初始化交易记录成功');
  }
}

/**
 * 读取数据文件
 * @param {string} filePath - 文件路径
 * @returns {Promise<object>} - 文件内容（JSON解析后）
 */
async function readData(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`读取文件失败 [${filePath}]:`, error.message);
    throw new Error(`数据读取失败: ${error.message}`);
  }
}

/**
 * 写入数据文件
 * @param {string} filePath - 文件路径
 * @param {object} data - 要写入的数据
 * @returns {Promise<boolean>} - 是否写入成功
 */
async function writeData(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`写入文件失败 [${filePath}]:`, error.message);
    throw new Error(`数据写入失败: ${error.message}`);
  }
}

/**
 * 获取单只股票信息
 * @param {string} stockId - 股票代码
 * @returns {Promise<object|null>} - 股票信息或null
 */
async function getStock(stockId) {
  const stocks = await readData(STOCKS_FILE);
  return stocks.find(stock => stock.id === stockId) || null;
}

/**
 * 获取所有股票信息
 * @returns {Promise<array>} - 股票列表
 */
async function getAllStocks() {
  return await readData(STOCKS_FILE);
}

/**
 * 计算投资组合统计数据
 * @param {array} portfolio - 持仓列表
 * @returns {Promise<object>} - 统计结果
 */
async function calculatePortfolioStats(portfolio) {
  const stats = {
    totalValue: 0,
    totalCost: 0,
    totalProfitLoss: 0,
    stocks: []
  };

  const stocks = await getAllStocks();
  
  for (const holding of portfolio) {
    const stock = stocks.find(s => s.id === holding.stockId);
    if (!stock) continue;

    const currentPrice = stock.price;
    const stockValue = currentPrice * holding.quantity;
    const cost = holding.averagePrice * holding.quantity;
    const profitLoss = stockValue - cost;

    stats.totalValue += stockValue;
    stats.totalCost += cost;
    stats.totalProfitLoss += profitLoss;

    stats.stocks.push({
      stockId: holding.stockId,
      stockName: holding.stockName,
      quantity: holding.quantity,
      averagePrice: holding.averagePrice,
      currentPrice,
      value: stockValue,
      profitLoss: parseFloat(profitLoss.toFixed(2)),
      profitLossPercent: parseFloat(((profitLoss / cost) * 100).toFixed(2))
    });
  }

  // 保留两位小数
  stats.totalValue = parseFloat(stats.totalValue.toFixed(2));
  stats.totalCost = parseFloat(stats.totalCost.toFixed(2));
  stats.totalProfitLoss = parseFloat(stats.totalProfitLoss.toFixed(2));
  stats.totalProfitLossPercent = stats.totalCost > 0 
    ? parseFloat(((stats.totalProfitLoss / stats.totalCost) * 100).toFixed(2))
    : 0;

  return stats;
}

// API路由定义

/**
 * 获取所有股票列表
 * GET /api/stocks
 */
app.get('/api/stocks', async (req, res) => {
  try {
    const stocks = await getAllStocks();
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新股票价格
 * POST /api/stocks/update-price
 */
app.post('/api/stocks/update-price', async (req, res) => {
  try {
    const { stockId, price } = req.body;
    
    if (!stockId || price === undefined || price <= 0) {
      return res.status(400).json({ error: '请提供有效的股票代码和正的价格' });
    }
    
    const stocks = await readData(STOCKS_FILE);
    const stockIndex = stocks.findIndex(s => s.id === stockId);
    
    if (stockIndex === -1) {
      return res.status(404).json({ error: '股票不存在' });
    }
    
    stocks[stockIndex].price = parseFloat(price.toFixed(2));
    await writeData(STOCKS_FILE, stocks);
    
    res.json({
      success: true,
      stock: stocks[stockIndex]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取用户投资组合和资产
 * GET /api/portfolio
 */
app.get('/api/portfolio', async (req, res) => {
  try {
    const user = await readData(USER_FILE);
    const portfolioStats = await calculatePortfolioStats(user.portfolio);
    
    res.json({
      balance: user.balance,
      portfolioValue: portfolioStats.totalValue,
      totalAssets: parseFloat((user.balance + portfolioStats.totalValue).toFixed(2)),
      portfolioStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 买入股票
 * POST /api/buy
 */
app.post('/api/buy', async (req, res) => {
  try {
    const { stockId, quantity } = req.body;
    
    // 验证输入
    if (!stockId || !quantity || quantity <= 0 || quantity % 100 !== 0) {
      return res.status(400).json({ 
        error: '请提供有效的股票代码和100股的整数倍数量' 
      });
    }
    
    // 获取数据
    const user = await readData(USER_FILE);
    const stock = await getStock(stockId);
    const transactions = await readData(TRANSACTIONS_FILE);
    
    if (!stock) {
      return res.status(404).json({ error: '找不到该股票' });
    }
    
    // 计算成本
    const price = req.body.price || stock.price; // 优先使用前端传递的价格
    const totalCost = price * quantity;
    
    // 检查余额
    if (user.balance < totalCost) {
      return res.status(400).json({ error: '余额不足' });
    }
    
    // 更新用户余额
    user.balance = parseFloat((user.balance - totalCost).toFixed(2));
    
    // 更新持仓
    const holdingIndex = user.portfolio.findIndex(h => h.stockId === stockId);
    
    if (holdingIndex >= 0) {
      // 已有持仓，更新平均成本
      const existingHolding = user.portfolio[holdingIndex];
      const newQuantity = existingHolding.quantity + quantity;
      const totalInvestment = (existingHolding.averagePrice * existingHolding.quantity) + totalCost;
      const newAveragePrice = parseFloat((totalInvestment / newQuantity).toFixed(2));
      
      user.portfolio[holdingIndex] = {
        ...existingHolding,
        quantity: newQuantity,
        averagePrice: newAveragePrice
      };
    } else {
      // 新增持仓
      user.portfolio.push({
        stockId: stock.id,
        stockName: stock.name,
        quantity,
        averagePrice: price
      });
    }
    
    // 保存用户数据
    await writeData(USER_FILE, user);
    
    // 记录交易
    const transaction = {
      id: uuidv4(),
      type: 'buy',
      stockId: stock.id,
      stockName: stock.name,
      quantity,
      price,
      total: totalCost,
      timestamp: new Date().toISOString()
    };
    
    transactions.push(transaction);
    await writeData(TRANSACTIONS_FILE, transactions);
    
    // 返回更新后的持仓统计
    const portfolioStats = await calculatePortfolioStats(user.portfolio);
    
    res.json({
      success: true,
      transaction,
      balance: user.balance,
      portfolioStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 卖出股票
 * POST /api/sell
 */
app.post('/api/sell', async (req, res) => {
  try {
    const { stockId, quantity } = req.body;
    
    // 验证输入
    if (!stockId || !quantity || quantity <= 0 || quantity % 100 !== 0) {
      return res.status(400).json({ 
        error: '请提供有效的股票代码和100股的整数倍数量' 
      });
    }
    
    // 获取数据
    const user = await readData(USER_FILE);
    const stock = await getStock(stockId);
    const transactions = await readData(TRANSACTIONS_FILE);
    
    if (!stock) {
      return res.status(404).json({ error: '找不到该股票' });
    }
    
    // 检查持仓
    const holdingIndex = user.portfolio.findIndex(h => h.stockId === stockId);
    
    if (holdingIndex === -1) {
      return res.status(400).json({ error: '未持有该股票' });
    }
    
    const holding = user.portfolio[holdingIndex];
    if (holding.quantity < quantity) {
      return res.status(400).json({ error: '持有数量不足' });
    }
    
    // 计算收入
    const price = req.body.price || stock.price; // 优先使用前端传递的价格
    const totalRevenue = price * quantity;
    
    // 更新余额
    user.balance = parseFloat((user.balance + totalRevenue).toFixed(2));
    
    // 更新持仓
    if (holding.quantity === quantity) {
      // 全部卖出，移除持仓
      user.portfolio.splice(holdingIndex, 1);
    } else {
      // 部分卖出，减少数量
      user.portfolio[holdingIndex].quantity -= quantity;
    }
    
    // 保存用户数据
    await writeData(USER_FILE, user);
    
    // 记录交易
    const transaction = {
      id: uuidv4(),
      type: 'sell',
      stockId: stock.id,
      stockName: stock.name,
      quantity,
      price,
      total: totalRevenue,
      profitLoss: parseFloat(((price - holding.averagePrice) * quantity).toFixed(2)),
      timestamp: new Date().toISOString()
    };
    
    transactions.push(transaction);
    await writeData(TRANSACTIONS_FILE, transactions);
    
    // 返回更新后的持仓统计
    const portfolioStats = await calculatePortfolioStats(user.portfolio);
    
    res.json({
      success: true,
      transaction,
      balance: user.balance,
      portfolioStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取交易历史
 * GET /api/transactions
 */
app.get('/api/transactions', async (req, res) => {
  try {
    const transactions = await readData(TRANSACTIONS_FILE);
    // 按时间倒序排列（最新的在前）
    transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 启动服务器
 */
async function startServer() {
  try {
    // 初始化数据
    await initializeData();
    
    // 启动服务
    app.listen(PORT, () => {
      console.log(`股票模拟服务已启动，运行在 http://localhost:${PORT}`);
      console.log('支持的API接口:');
      console.log('GET  /api/stocks             - 获取所有股票列表');
      console.log('POST /api/stocks/update-price - 更新股票价格');
      console.log('GET  /api/portfolio           - 获取投资组合和资产');
      console.log('POST /api/buy                 - 买入股票');
      console.log('POST /api/sell                - 卖出股票');
      console.log('GET  /api/transactions        - 获取交易历史');
    });
  } catch (error) {
    console.error('服务器启动失败:', error.message);
    process.exit(1); // 初始化失败时退出进程
  }
}

// 启动服务器
startServer();

// 导出app供测试或其他模块使用
module.exports = app;
