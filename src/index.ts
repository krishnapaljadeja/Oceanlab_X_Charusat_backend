import "dotenv/config";
import express from "express";
import cors from "cors";
import { analyzeRouter } from "./routes/analyze";
import { qaRouter } from "./routes/qa";
import { ingestRouter } from "./routes/ingest";
import { errorHandler } from "./middleware/errorHandler";
import { testConnection } from "./db/client";

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

const app = express();
const PORT = parseInt(process.env.PORT || "4000");

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use("/api", analyzeRouter);
app.use("/api", qaRouter);
app.use("/api", ingestRouter);

// 404 handler
app.use((_req, res) => {
  res
    .status(404)
    .json({ success: false, error: "Route not found", code: "NOT_FOUND" });
});

app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(
    `[Server] GitHub token: ${process.env.GITHUB_TOKEN ? "✓ loaded" : "✗ missing"}`,
  );
  console.log(
    `[Server] Gemini key: ${process.env.GEMINI_API_KEY ? "✓ loaded" : "✗ missing"}`,
  );
  await testConnection();
});
