const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STUDENTS_FILE = path.join(DATA_DIR, "students.json");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234567890";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD must be configured in production.");
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(STUDENTS_FILE)) {
  fs.writeFileSync(STUDENTS_FILE, "[]", "utf8");
}

const sessions = new Map();

function readStudents() {
  try {
    return JSON.parse(fs.readFileSync(STUDENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeStudents(students) {
  fs.writeFileSync(STUDENTS_FILE, JSON.stringify(students, null, 2), "utf8");
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

function signSession(id) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("hex");
  return `${id}.${sig}`;
}

function verifySession(value) {
  if (!value || !value.includes(".")) return null;
  const [id, sig] = value.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies.admin_session);
  if (!session) {
    return res.status(401).json({ error: "Admin login required." });
  }
  req.admin = session;
  next();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isValidName(name) {
  return /^[A-Za-z][A-Za-z .'-]{1,79}$/.test(name.trim());
}

function secretsMatch(provided, expected) {
  const left = crypto.createHash("sha256").update(String(provided)).digest();
  const right = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/register", (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  const email = normalizeEmail(req.body.email);
  const phone = String(req.body.phone || "").trim();
  const normalizedPhone = normalizePhone(phone);

  if (!isValidName(fullName)) {
    return res.status(400).json({
      error: "Enter a valid full name using letters (2–80 characters).",
    });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!isValidPhone(normalizedPhone)) {
    return res.status(400).json({ error: "Enter a valid phone number (10–15 digits)." });
  }

  const students = readStudents();
  const alreadyRegistered = students.find(
    (student) =>
      student.email === email || student.normalizedPhone === normalizedPhone
  );
  if (alreadyRegistered) {
    return res.status(409).json({
      error: "A student with this email or phone number is already registered.",
    });
  }

  const student = {
    id: crypto.randomUUID(),
    fullName,
    email,
    phone,
    normalizedPhone,
    registeredAt: new Date().toISOString(),
  };
  students.unshift(student);
  writeStudents(students);

  res.status(201).json({
    message: "Registration successful. Welcome aboard.",
    student: {
      fullName: student.fullName,
      email: student.email,
      phone: student.phone,
    },
  });
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!secretsMatch(username, ADMIN_USER) || !secretsMatch(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Invalid admin username or password." });
  }

  const id = crypto.randomBytes(16).toString("hex");
  sessions.set(id, { username, expiresAt: Date.now() + SESSION_TTL_MS });

  res.setHeader(
    "Set-Cookie",
    `admin_session=${encodeURIComponent(signSession(id))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
  );
  res.json({ message: "Logged in." });
});

app.post("/api/admin/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies.admin_session;
  if (value && value.includes(".")) {
    sessions.delete(value.split(".")[0]);
  }
  res.setHeader(
    "Set-Cookie",
    "admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );
  res.json({ message: "Logged out." });
});

app.get("/api/admin/me", requireAdmin, (_req, res) => {
  res.json({ username: ADMIN_USER });
});

app.get("/api/admin/students", requireAdmin, (_req, res) => {
  const students = readStudents().map(({ normalizedPhone, ...student }) => student);
  res.json({ students, total: students.length });
});

function deleteStudent(req, res) {
  const students = readStudents();
  const studentIndex = students.findIndex((student) => student.id === req.params.id);
  if (studentIndex === -1) {
    return res.status(404).json({ error: "Student registration not found." });
  }

  const [deletedStudent] = students.splice(studentIndex, 1);
  writeStudents(students);
  res.json({ message: "Student registration deleted.", id: deletedStudent.id });
}

app.delete("/api/admin/students/:id", requireAdmin, deleteStudent);
app.post("/api/admin/students/:id/delete", requireAdmin, deleteStudent);

app.listen(PORT, () => {
  console.log(`Student registration running at http://localhost:${PORT}`);
  console.log(`Admin username: ${ADMIN_USER}`);
  console.log(`Admin page: http://localhost:${PORT}/admin.html`);
});
