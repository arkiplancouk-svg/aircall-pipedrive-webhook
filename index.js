import express from "express";

const app = express();
app.use(express.json());

// 👋 Health check route for Fly.io
app.get("/", (req, res) => {
  res.send("Webhook is alive!");
});

// Basic Aircall webhook (just to test)
app.post("/aircall/webhook", (req, res) => {
  console.log("Got webhook:", req.body);
  res.sendStatus(200); // Always reply quickly
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
