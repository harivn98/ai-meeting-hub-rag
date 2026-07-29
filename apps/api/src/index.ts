import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import meetingsRoutes from "./routes/meetings";
import { UPLOAD_DIR } from "./middleware/upload";

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Uploaded meeting documents are served back from here, e.g. /uploads/<file>
app.use("/uploads", express.static(UPLOAD_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/meetings", meetingsRoutes);

// Basic error handler (catches multer file-type/size errors and anything unhandled)
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(400).json({ error: err.message || "Unexpected error" });
  }
);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
