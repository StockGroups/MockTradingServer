const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

const app = express();
app.use(bodyParser.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('缺少 Supabase 环境变量');
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// CORS配置
const allowedOrigins = [
  'https://stockgroups.github.io',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:5173',
  'http://localhost:9000'
];
app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('CORS 禁止访问')),
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
}));
app.options('*', cors());

// 校验函数
function validateStockId(stockId) {
  return (!stockId || typeof stockId !== 'string' || stockId.trim() === '')
    ? { valid: false, message: '请提供有效的股票代码' }
    : { valid: true };
}

function validateQuantity(quantity) {
  const parsed = parseInt(quantity, 10);
  return isNaN(parsed) || parsed <= 0 || parsed % 100 !== 0
    ? { valid: false, message: '请提供有效的股票数量（100的整数倍）' }
    : { valid: true, parsed };
}

function validatePrice(price) {
  const parsed = parseFloat(price);
  return isNaN(parsed) || parsed <= 0
    ? { valid: false, message: '请提供有效的正价格' }
    : { valid: true, parsed };
}

// 获取资金余额
async function getCurrentBalance() {
  try {
    console.log('💰 获取资金余额');
    const { data, error } = await supabase
      .from('user_funds')
      .select('*')
      .order('id', { ascending: true })
      .limit(1)
      .single();
      
    if (error) {
      console.log('📝 资金表为空，初始化资金记录');
      if (error.code === 'PGRST116') {
        const { data: newFund, error: insertError } = await supabase
          .from('user_funds')
          .insert([{ balance: 100000.00 }])
          .select()
          .single();
          
        if (insertError) {
          console.error('❌ 初始化资金失败:', insertError);
          throw new Error('初始化资金失败');
        }
        
        console.log('✅ 资金初始化成功:', newFund.balance);
        return newFund.balance;
      }
      throw new Error('获取资金失败: ' + error.message);
    }
    
    console.log('✅ 获取资金成功:', data.balance);
    return data.balance;
  } catch (error) {
    console.error('❌ 获取资金异常:', error);
    throw error;
  }
}

// 更新资金余额（使用小写字段名）
async function updateBalance(amount) {
  try {
    console.log(`🔄 更新资金余额: ${amount}`);
    const currentBalance = await getCurrentBalance();
    const newBalance = parseFloat((currentBalance + amount).toFixed(2));
    
    if (newBalance < 0) {
      console.error('❌ 余额不足:', currentBalance, amount);
      throw new Error('余额不足');
    }

    const { data, error } = await supabase
      .from('user_funds')
      .update({ 
        balance: newBalance, 
        updatedat: new Date()  // 使用小写
      })
      .eq('id', 1)
      .select()
      .single();
      
    if (error) {
      console.error('❌ 更新资金失败:', error);
      throw new Error('更新资金失败: ' + error.message);
    }

    console.log('✅ 资金更新成功:', data.balance);
    return data.balance;
  } catch (error) {
    console.error('❌ 更新资金异常:', error);
    throw error;
  }
}

// 获取所有股票
app.get('/api/stocks', async (req, res) => {
  try {
    console.log('📋 获取股票列表请求');
    const { data, error } = await supabase.from('stocks').select('*').order('id');
    
    if (error) {
      console.error('❌ 获取股票列表失败:', error);
      return res.status(500).json({ error: error.message });
    }
    
    console.log(`✅ 成功获取 ${data.length} 支股票`);
    res.json(data);
  } catch (error) {
    console.error('❌ 获取股票列表异常:', error);
    res.status(500).json({ error: '获取股票列表失败' });
  }
});

// 更新股票价格（使用小写字段名）
app.post('/api/stocks/update-price', async (req, res) => {
  try {
    console.log('🔄 更新股票价格请求:', req.body);
    const { stockId, price } = req.body;
    
    const idCheck = validateStockId(stockId);
    const priceCheck = validatePrice(price);
    if (!idCheck.valid) return res.status(400).json({ error: idCheck.message });
    if (!priceCheck.valid) return res.status(400).json({ error: priceCheck.message });

    const { data: stock, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('id', stockId)
      .single();
      
    if (stockError) {
      console.error('❌ 股票不存在:', stockId, stockError);
      return res.status(404).json({ error: '股票不存在' });
    }

    console.log(`📊 更新股票 ${stockId} 价格: ${stock.price} -> ${priceCheck.parsed}`);

    const { data, error } = await supabase
      .from('stocks')
      .update({ 
        price: priceCheck.parsed, 
        updatedat: new Date()  // 使用小写
      })
      .eq('id', stockId)
      .select()
      .single();
      
    if (error) {
      console.error('❌ 更新股票价格失败:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ 股票价格更新成功:', data);
    res.json({ success: true, stock: data });
  } catch (error) {
    console.error('❌ 更新股票价格异常:', error);
    res.status(500).json({ error: '更新股票价格失败' });
  }
});

// 获取投资组合和资产
app.get('/api/portfolio', async (req, res) => {
  try {
    console.log('📊 获取投资组合请求');
    const balance = await getCurrentBalance();
    
    const { data: portfolio, error: portfolioError } = await supabase
      .from('portfolio')
      .select('*');
      
    if (portfolioError) {
      console.error('❌ 获取持仓失败:', portfolioError);
      return res.status(500).json({ error: portfolioError.message });
    }

    const { data: stocks, error: stocksError } = await supabase
      .from('stocks')
      .select('id, price');
      
    if (stocksError) {
      console.error('❌ 获取股票价格失败:', stocksError);
      return res.status(500).json({ error: stocksError.message });
    }

    const priceMap = Object.fromEntries(stocks ? stocks.map(s => [s.id, s.price]) : []);

    let totalValue = 0, totalCost = 0, totalProfitLoss = 0;
    const stocksArr = (portfolio || []).map(h => {
      const currentPrice = priceMap[h.stockid] || 0;
      const value = currentPrice * h.quantity;
      const cost = h.averageprice * h.quantity;
      const profitLoss = value - cost;
      totalValue += value;
      totalCost += cost;
      totalProfitLoss += profitLoss;
      return {
        stockId: h.stockid,
        stockName: h.stockname,
        quantity: h.quantity,
        averagePrice: h.averageprice,
        currentPrice,
        value: +value.toFixed(2),
        profitLoss: +profitLoss.toFixed(2),
        profitLossPercent: cost ? +(profitLoss / cost * 100).toFixed(2) : 0
      };
    });

    console.log('📊 投资组合统计:', {
      持仓数量: stocksArr.length,
      总市值: totalValue,
      总成本: totalCost,
      总盈亏: totalProfitLoss,
      可用资金: balance
    });

    res.json({
      balance: +balance.toFixed(2),
      totalAssets: +(balance + totalValue).toFixed(2),
      portfolioValue: +totalValue.toFixed(2),
      portfolioStats: {
        stocks: stocksArr,
        totalValue: +totalValue.toFixed(2),
        totalCost: +totalCost.toFixed(2),
        totalProfitLoss: +totalProfitLoss.toFixed(2),
        totalProfitLossPercent: totalCost ? +(totalProfitLoss / totalCost * 100).toFixed(2) : 0
      }
    });
  } catch (error) {
    console.error('❌ 获取投资组合异常:', error);
    res.status(500).json({ error: error.message });
  }
});

// 买入股票
app.post('/api/buy', async (req, res) => {
  try {
    console.log('🛒 买入股票请求:', req.body);
    const { stockId, quantity, price } = req.body;
    
    const idCheck = validateStockId(stockId);
    const qtyCheck = validateQuantity(quantity);
    if (!idCheck.valid) return res.status(400).json({ error: idCheck.message });
    if (!qtyCheck.valid) return res.status(400).json({ error: qtyCheck.message });

    const parsedQuantity = qtyCheck.parsed;
    let parsedPrice = price !== undefined ? validatePrice(price).parsed : null;

    const { data: stock, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('id', stockId)
      .single();
      
    if (stockError) {
      console.error('❌ 股票不存在:', stockId, stockError);
      return res.status(404).json({ error: '股票不存在' });
    }

    const tradePrice = parsedPrice || stock.price;
    const totalCost = tradePrice * parsedQuantity;
    console.log(`💵 交易详情: ${parsedQuantity}股 @ ${tradePrice} = ${totalCost}`);

    const currentBalance = await getCurrentBalance();
    if (currentBalance < totalCost) {
      console.error('❌ 余额不足:', currentBalance, totalCost);
      return res.status(400).json({ error: '余额不足' });
    }

    await updateBalance(-totalCost);

    const { data: holding, error: holdingError } = await supabase
      .from('portfolio')
      .select('*')
      .eq('stockid', stockId)
      .single();
      
    if (holdingError && holdingError.code !== 'PGRST116') {
      console.error('❌ 查询持仓失败:', holdingError);
      return res.status(500).json({ error: holdingError.message });
    }

    if (holding) {
      console.log('📝 更新现有持仓:', holding);
      const newQuantity = holding.quantity + parsedQuantity;
      const newTotalCost = (holding.averageprice * holding.quantity) + totalCost;
      const newAveragePrice = newTotalCost / newQuantity;
      
      const { error: updateError } = await supabase
        .from('portfolio')
        .update({
          quantity: newQuantity,
          averageprice: newAveragePrice,
          updatedat: new Date()
        })
        .eq('id', holding.id);
        
      if (updateError) {
        console.error('❌ 更新持仓失败:', updateError);
        return res.status(500).json({ error: updateError.message });
      }
    } else {
      console.log('📝 创建新持仓');
      const { error: insertError } = await supabase
        .from('portfolio')
        .insert([{
          stockid: stockId,
          stockname: stock.name,
          quantity: parsedQuantity,
          averageprice: tradePrice
        }]);
        
      if (insertError) {
        console.error('❌ 创建持仓失败:', insertError);
        return res.status(500).json({ error: insertError.message });
      }
    }

    const txId = uuidv4();
    const timestamp = new Date();
    const { error: txError } = await supabase
      .from('transactions')
      .insert([{
        id: txId,
        type: 'buy',
        stockid: stockId,
        stockname: stock.name,
        quantity: parsedQuantity,
        price: tradePrice,
        total: totalCost,
        timestamp
      }]);
      
    if (txError) {
      console.error('❌ 记录交易失败:', txError);
      return res.status(500).json({ error: txError.message });
    }

    const newBalance = await getCurrentBalance();
    console.log('✅ 买入成功，新余额:', newBalance);
    
    res.json({
      success: true,
      balance: newBalance,
      message: '买入成功'
    });
  } catch (error) {
    console.error('❌ 买入股票异常:', error);
    res.status(500).json({ error: error.message });
  }
});

// 卖出股票
app.post('/api/sell', async (req, res) => {
  try {
    console.log('💰 卖出股票请求:', req.body);
    const { stockId, quantity, price } = req.body;
    
    const idCheck = validateStockId(stockId);
    const qtyCheck = validateQuantity(quantity);
    const priceCheck = validatePrice(price);
    if (!idCheck.valid) return res.status(400).json({ error: idCheck.message });
    if (!qtyCheck.valid) return res.status(400).json({ error: qtyCheck.message });
    if (!priceCheck.valid) return res.status(400).json({ error: priceCheck.message });

    const parsedQuantity = qtyCheck.parsed;
    const tradePrice = priceCheck.parsed;
    const totalRevenue = tradePrice * parsedQuantity;
    console.log(`💵 交易详情: ${parsedQuantity}股 @ ${tradePrice} = ${totalRevenue}`);

    const { data: stock, error: stockError } = await supabase
      .from('stocks')
      .select('*')
      .eq('id', stockId)
      .single();
      
    if (stockError) {
      console.error('❌ 股票不存在:', stockId, stockError);
      return res.status(404).json({ error: '股票不存在' });
    }

    const { data: holding, error: holdingError } = await supabase
      .from('portfolio')
      .select('*')
      .eq('stockid', stockId)
      .single();
      
    if (holdingError) {
      console.error('❌ 查询持仓失败:', holdingError);
      if (holdingError.code === 'PGRST116') {
        return res.status(400).json({ error: `没有持仓的股票: ${stockId}` });
      }
      return res.status(500).json({ error: holdingError.message });
    }

    if (!holding) {
      console.error('❌ 没有持仓:', stockId);
      return res.status(400).json({ error: `没有持仓的股票: ${stockId}` });
    }

    if (holding.quantity < parsedQuantity) {
      console.error('❌ 持仓数量不足:', holding.quantity, parsedQuantity);
      return res.status(400).json({ error: '持仓数量不足' });
    }

    const profitLoss = +((tradePrice - holding.averageprice) * parsedQuantity).toFixed(2);
    console.log(`📊 盈亏计算: ${profitLoss}`);

    await updateBalance(totalRevenue);

    if (holding.quantity === parsedQuantity) {
      console.log('🗑️ 删除持仓（全部卖出）');
      const { error: deleteError } = await supabase
        .from('portfolio')
        .delete()
        .eq('id', holding.id);
        
      if (deleteError) {
        console.error('❌ 删除持仓失败:', deleteError);
        return res.status(500).json({ error: deleteError.message });
      }
    } else {
      console.log('📝 减少持仓数量');
      const { error: updateError } = await supabase
        .from('portfolio')
        .update({
          quantity: holding.quantity - parsedQuantity,
          updatedat: new Date()
        })
        .eq('id', holding.id);
        
      if (updateError) {
        console.error('❌ 更新持仓失败:', updateError);
        return res.status(500).json({ error: updateError.message });
      }
    }

    const txId = uuidv4();
    const timestamp = new Date();
    const { error: txError } = await supabase
      .from('transactions')
      .insert([{
        id: txId,
        type: 'sell',
        stockid: stockId,
        stockname: stock.name,
        quantity: parsedQuantity,
        price: tradePrice,
        total: totalRevenue,
        profitloss: profitLoss,
        timestamp
      }]);
      
    if (txError) {
      console.error('❌ 记录交易失败:', txError);
      return res.status(500).json({ error: txError.message });
    }

    const newBalance = await getCurrentBalance();
    console.log('✅ 卖出成功，新余额:', newBalance);
    
    res.json({
      success: true,
      balance: newBalance,
      profitLoss,
      message: '卖出成功'
    });
  } catch (error) {
    console.error('❌ 卖出股票异常:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取交易记录
app.get('/api/transactions', async (req, res) => {
  try {
    console.log('📜 获取交易记录请求');
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50);
      
    if (error) {
      console.error('❌ 获取交易记录失败:', error);
      return res.status(500).json({ error: error.message });
    }

    // 映射字段名称到前端期望的格式
    const mappedTransactions = transactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      stockId: tx.stockid,
      stockName: tx.stockname,
      quantity: tx.quantity,
      price: tx.price,
      total: tx.total,
      profitLoss: tx.profitloss,
      timestamp: tx.timestamp
    }));

    console.log(`✅ 获取 ${mappedTransactions.length} 条交易记录`);
    res.json(mappedTransactions);
  } catch (error) {
    console.error('❌ 获取交易记录异常:', error);
    res.status(500).json({ error: '获取交易记录失败' });
  }
});

// 根路由
app.get('/', (req, res) => {
  console.log('🌐 根路由访问');
  res.json({ message: '股票交易API服务运行中' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('🚨 未处理的错误:', err);
  res.status(500).json({ error: '服务器错误' });
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 服务运行在 http://localhost:${PORT}`);
  console.log(`📊 数据库连接: ${supabaseUrl}`);
});