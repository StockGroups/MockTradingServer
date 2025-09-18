import express from "express";

const app = express();

app.get("/api", (req, res) => {
    res.end(`Hello! Serverless`);
});

app.get("/api/item/:slug", (req, res) => {
    const { slug } = req.params;
    res.end(`Item: ${slug}`);
});

// 注册中间件（上文已加，此处省略）

// POST 接口：创建商品（接收 JSON 数据）
app.post("/api/item", (req, res) => {
  // 1. 从请求体中获取客户端提交的数据（req.body 由中间件解析生成）
  const { name, price, category } = req.body; // 解构赋值，提取关键字段

  // 2. 数据校验（避免空值提交）
  if (!name || !price) {
    // 返回 400 状态码（Bad Request），提示参数缺失
    return res.status(400).json({
      code: 400,
      message: "参数错误：商品名称（name）和价格（price）不能为空"
    });
  }

  // 3. 模拟业务逻辑（实际开发中会存数据库）
  const newItem = {
    id: Date.now().toString(), // 用时间戳生成临时唯一 ID
    name,
    price: Number(price), // 确保价格是数字类型
    category: category || "未分类", // 可选字段，默认“未分类”
    createTime: new Date().toLocaleString()
  };

  // 4. 返回成功响应（JSON 格式，前端可直接解析）
  res.status(201).json({ // 201 状态码表示“资源创建成功”
    code: 200,
    message: "商品创建成功",
    data: newItem
  });
});

export default app;
