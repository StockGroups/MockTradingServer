const Database = require('better-sqlite3');
const path = require('path');

// 数据库文件路径（Vercel 允许 /tmp 目录临时读写）
const dbPath = path.join(process.cwd(), 'db', 'stock.db');

// 创建数据库连接
const db = new Database(dbPath, { verbose: console.log });

// 创建表结构
function initDB() {
  // 1. 股票表
  db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0.01
    );
  `);

  // 2. 用户表（单用户模式，默认10万初始资金）
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY DEFAULT 1,
      balance REAL NOT NULL DEFAULT 100000.00,
      UNIQUE(id)
    );
  `);

  // 3. 持仓表
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stockId TEXT NOT NULL,
      stockName TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      averagePrice REAL NOT NULL DEFAULT 0.01,
      FOREIGN KEY (stockId) REFERENCES stocks(id)
    );
  `);

  // 4. 交易记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
      stockId TEXT NOT NULL,
      stockName TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      profitLoss REAL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (stockId) REFERENCES stocks(id)
    );
  `);

  // 初始化默认数据（若股票表为空）
  const count = db.prepare('SELECT COUNT(*) as c FROM stocks').get().c;
  if (count === 0) {
    const insertStock = db.prepare('INSERT INTO stocks (id, name, price) VALUES (?, ?, ?)');
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
    stocks.forEach(stock => insertStock.run(stock[0], stock[1], stock[2]));
    console.log('初始化默认股票数据成功');
  }

  // 初始化用户数据（若用户表为空）
  const userCount = db.prepare('SELECT COUNT(*) as c FROM user').get().c;
  if (userCount === 0) {
    db.prepare('INSERT INTO user (id, balance) VALUES (1, 100000.00)').run();
    console.log('初始化用户数据成功');
  }

  db.close();
  console.log('数据库初始化完成');
}

initDB();
