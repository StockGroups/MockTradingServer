import express from "express";

const app = express();

app.get("/api", (req, res) => {
    res.end(`Hello! Serverless`);
});

app.get("/api/item/:slug", (req, res) => {
    const { slug } = req.params;
    res.end(`Item: ${slug}`);
});

app.post("/api/item", (req, res) => {
    const { name, price, category } = req.body;
    if (!name || !price) {
        return res.status(400).json({
            code: 400,
            message: "参数错误：商品名称（name）和价格（price）不能为空"
        });
    }
});

export default app;
