import express from "express";

const app = express();

app.get("/api", (req, res) => {
  res.end(`Hello! Serverless`);
});

app.get("/api/item/:slug", (req, res) => {
  const { slug } = req.params;
  res.end(`Item: ${slug}`);
});

export default app;
