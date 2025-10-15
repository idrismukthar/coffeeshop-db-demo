// server.js
require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- Middleware --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // max 50 requests per minute per IP
});
app.use(limiter);

// -------------------- File uploads --------------------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${unique}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/"))
      return cb(new Error("Only image uploads allowed"));
    cb(null, true);
  },
});

// -------------------- Database --------------------
const DB_FILE = path.join(__dirname, "coffeeshop.db");
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) return console.error("DB open error:", err.message);
  console.log("Connected to", DB_FILE);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentID TEXT,
    surname TEXT,
    firstName TEXT,
    lastName TEXT,
    dob TEXT,
    religion TEXT,
    imageFile TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// -------------------- Admin Auth --------------------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme";

// simple middleware to protect admin endpoints
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (token === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// -------------------- Routes --------------------

// Handle form submission
app.post("/submit", upload.single("image"), (req, res) => {
  const { studentID, surname, firstName, lastName, dob, religion } = req.body;
  const imageFile = req.file ? req.file.filename : null;

  const sql = `INSERT INTO students (studentID, surname, firstName, lastName, dob, religion, imageFile)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;

  db.run(
    sql,
    [studentID, surname, firstName, lastName, dob, religion, imageFile],
    function (err) {
      if (err) {
        console.error("Insert error", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log("✅ Added new record ID:", this.lastID);
      return res.json({ success: true, id: this.lastID });
    }
  );
});

// Admin: get all students
app.get("/api/students", requireAdmin, (req, res) => {
  db.all(`SELECT * FROM students ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Admin: delete a student + image
app.delete("/api/students/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  db.get(`SELECT imageFile FROM students WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row && row.imageFile) {
      const imgPath = path.join(uploadDir, row.imageFile);
      fs.unlink(imgPath, (e) => {
        if (e && e.code !== "ENOENT")
          console.warn("Delete image error:", e.message);
      });
    }
    db.run(`DELETE FROM students WHERE id = ?`, [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, deleted: this.changes });
    });
  });
});

// Health check
app.get("/ping", (req, res) => res.send("pong"));

app.use(express.static(__dirname));

// -------------------- Start --------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
