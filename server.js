require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "true") === "true";
const DATABASE_SSL = String(process.env.DATABASE_SSL || "false") === "true";
const RETENTION_MONTHS = Math.max(1, Number(process.env.RETENTION_MONTHS || 3));

if (!DATABASE_URL || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error("Defina DATABASE_URL, ADMIN_PASSWORD e JWT_SECRET.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createToken() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "30m" });
}

function requireAuth(req, res, next) {
  const token = req.cookies.calendar_auth;
  if (!token) return res.status(401).json({ error: "Senha necessária." });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("invalid role");
    next();
  } catch {
    res.clearCookie("calendar_auth");
    return res.status(401).json({ error: "Sessão expirada. Digite a senha novamente." });
  }
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 20);
}

function validateDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS families (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGSERIAL PRIMARY KEY,
      family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
      booking_date DATE NOT NULL,
      meal_type VARCHAR(10) NOT NULL CHECK (meal_type IN ('almoco', 'janta')),
      fixed_type VARCHAR(10) NOT NULL DEFAULT 'none'
        CHECK (fixed_type IN ('none', 'date', 'weekday')),
      day_of_month INTEGER,
      weekday INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_booking_per_meal UNIQUE (booking_date, meal_type)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date)`);
}

async function cleanupOldBookings() {
  try {
    const result = await pool.query(
      `DELETE FROM bookings
       WHERE booking_date < (CURRENT_DATE - ($1 || ' months')::interval)::date`,
      [RETENTION_MONTHS]
    );
    if (result.rowCount > 0) {
      console.log(`Limpeza: ${result.rowCount} agendamento(s) antigo(s) removido(s).`);
    }
  } catch (error) {
    console.error("Erro na limpeza:", error.message);
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/auth/status", (req, res) => {
  const token = req.cookies.calendar_auth;
  if (!token) return res.json({ authenticated: false });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ authenticated: payload.role === "admin" });
  } catch {
    res.clearCookie("calendar_auth");
    res.json({ authenticated: false });
  }
});

app.post("/api/auth/login", (req, res) => {
  const password = String(req.body?.password || "");
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Senha incorreta." });
  }

  res.cookie("calendar_auth", createToken(), {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    maxAge: 30 * 60 * 1000
  });

  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("calendar_auth");
  res.json({ ok: true });
});

app.get("/api/families", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id::text, name, phone, created_at
       FROM families ORDER BY LOWER(name), id`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/families", requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const phone = normalizePhone(req.body?.phone);

    if (!name || phone.length < 8) {
      return res.status(400).json({ error: "Informe nome e telefone válidos." });
    }

    const { rows } = await pool.query(
      `INSERT INTO families(name, phone)
       VALUES ($1, $2)
       RETURNING id::text, name, phone, created_at`,
      [name, phone]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/api/bookings", async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Ano ou mês inválido." });
    }

    const { rows } = await pool.query(
      `SELECT
         b.id::text,
         b.family_id::text AS "familyId",
         f.name AS "familyName",
         f.phone,
         TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS date,
         b.meal_type AS type,
         b.fixed_type AS "fixedType",
         b.day_of_month AS "dayOfMonth",
         b.weekday
       FROM bookings b
       JOIN families f ON f.id = b.family_id
       WHERE b.booking_date >= make_date($1, $2, 1)
         AND b.booking_date < (make_date($1, $2, 1) + INTERVAL '1 month')
       ORDER BY b.booking_date, b.meal_type`,
      [year, month]
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/bookings", requireAuth, async (req, res, next) => {
  try {
    const familyId = Number(req.body?.familyId);
    const date = String(req.body?.date || "");
    const type = req.body?.type === "janta" ? "janta" : "almoco";
    const fixedType = ["none", "date", "weekday"].includes(req.body?.fixedType)
      ? req.body.fixedType
      : "none";

    if (!Number.isInteger(familyId) || !validateDate(date)) {
      return res.status(400).json({ error: "Dados do agendamento inválidos." });
    }

    const jsDate = new Date(`${date}T12:00:00Z`);
    const dayOfMonth = jsDate.getUTCDate();
    const weekday = jsDate.getUTCDay();

    const { rows } = await pool.query(
      `INSERT INTO bookings(
         family_id, booking_date, meal_type, fixed_type, day_of_month, weekday
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text`,
      [familyId, date, type, fixedType, dayOfMonth, weekday]
    );

    res.status(201).json({ id: rows[0].id });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Já existe esse tipo de refeição agendado nesse dia." });
    }
    next(error);
  }
});

app.put("/api/bookings/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const familyId = Number(req.body?.familyId);
    const type = req.body?.type === "janta" ? "janta" : "almoco";
    const fixedType = ["none", "date", "weekday"].includes(req.body?.fixedType)
      ? req.body.fixedType
      : "none";

    if (!Number.isInteger(id) || !Number.isInteger(familyId)) {
      return res.status(400).json({ error: "Dados inválidos." });
    }

    const { rowCount } = await pool.query(
      `UPDATE bookings
       SET family_id = $1,
           meal_type = $2,
           fixed_type = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [familyId, type, fixedType, id]
    );

    if (!rowCount) return res.status(404).json({ error: "Agendamento não encontrado." });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Já existe esse tipo de refeição agendado nesse dia." });
    }
    next(error);
  }
});

app.delete("/api/bookings/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "ID inválido." });

    const { rowCount } = await pool.query("DELETE FROM bookings WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Agendamento não encontrado." });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/bookings/generate-next-month", requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const year = Number(req.body?.year);
    const month = Number(req.body?.month);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Ano ou mês inválido." });
    }

    const target = new Date(Date.UTC(year, month, 1));
    const targetYear = target.getUTCFullYear();
    const targetMonth = target.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();

    const { rows: fixed } = await client.query(
      `SELECT family_id, meal_type, fixed_type, day_of_month, weekday
       FROM bookings
       WHERE fixed_type <> 'none'`
    );

    let copied = 0;
    await client.query("BEGIN");

    for (const item of fixed) {
      let day = null;

      if (item.fixed_type === "date" && item.day_of_month <= lastDay) {
        day = item.day_of_month;
      }

      if (item.fixed_type === "weekday") {
        for (let d = 1; d <= lastDay; d++) {
          const candidate = new Date(Date.UTC(targetYear, targetMonth - 1, d));
          if (candidate.getUTCDay() === item.weekday) {
            day = d;
            break;
          }
        }
      }

      if (!day) continue;

      const date = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const result = await client.query(
        `INSERT INTO bookings(
           family_id, booking_date, meal_type, fixed_type, day_of_month, weekday
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (booking_date, meal_type) DO NOTHING`,
        [item.family_id, date, item.meal_type, item.fixed_type, day, item.weekday]
      );
      copied += result.rowCount;
    }

    await client.query("COMMIT");
    res.json({ copied, year: targetYear, month: targetMonth });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Erro interno no servidor." });
});

initDatabase()
  .then(async () => {
    await cleanupOldBookings();
    setInterval(cleanupOldBookings, 24 * 60 * 60 * 1000);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Calendário executando na porta ${PORT}.`);
    });
  })
  .catch((error) => {
    console.error("Falha ao iniciar:", error);
    process.exit(1);
  });
