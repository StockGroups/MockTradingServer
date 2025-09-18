import express from "express";

const app = express();

// 👇 关键修复：注册 JSON 请求体解析中间件（必须放在接口定义前）
app.use(express.json());

// 以下接口定义不变
app.get("/api", (req, res) => {
    res.end(`Hello! Serverless`);
});

app.get("/api/item/:slug", (req, res) => {
    const { slug } = req.params;
    res.end(`Item: ${slug}`);
});

// POST 接口（无需修改，修复中间件后即可正常获取 req.body）
app.post("/api/item", (req, res) => {
  const { name, price, category } = req.body; 

  if (!name || !price) {
    return res.status(400).json({
      code: 400,
      message: "参数错误：商品名称（name）和价格（price）不能为空"
    });
  }

  const newItem = {
    id: Date.now().toString(),
    name,
    price: Number(price),
    category: category || "未分类",
    createTime: new Date().toLocaleString()
  };

  res.status(201).json({
    code: 200,
    message: "商品创建成功",
    data: newItem
  });
});

export default app;