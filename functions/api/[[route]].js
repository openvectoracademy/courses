export async function onRequest(context) {
  const { request, env } = context;
  
  // Skip non-API routes (let static files through)
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    return context.next();
  }
  
  const DB = env.DB;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  function error(msg, status = 400) {
    return json({ error: msg }, status);
  }

  async function sha256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getSettings() {
    const settings = await DB.prepare("SELECT key, value FROM settings").all();
    const config = {};
    settings.results.forEach(s => { config[s.key] = s.value; });
    return config;
  }

  async function createJWT(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(payload));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${encodedHeader}.${encodedPayload}`));
    return `${encodedHeader}.${encodedPayload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  }

  async function verifyJWT(token, secret) {
    try {
      const [h, p, s] = token.split('.');
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      const sig = Uint8Array.from(atob(s), c => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sig, encoder.encode(`${h}.${p}`));
      return valid ? JSON.parse(atob(p)) : null;
    } catch { return null; }
  }

  async function authenticate(req, secret) {
    const auth = req.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const payload = await verifyJWT(auth.slice(7), secret);
    if (!payload) return null;
    return await DB.prepare("SELECT * FROM users WHERE id = ?").bind(payload.id).first();
  }

  await DB.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      premium_until TEXT,
      credits_left INTEGER DEFAULT 3,
      credits_reset_at TEXT,
      device_fingerprint TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('jwt_secret', 'default-jwt-secret-change-me')").run();
  await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('openrouter_api_key', '')").run();
  await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_model', 'openai/gpt-3.5-turbo')").run();
  await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_email', 'adminai@gmail.com')").run();
  await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', 'adminai2099')").run();

  const adminEmail = (await DB.prepare("SELECT value FROM settings WHERE key = 'admin_email'").first()).value;
  const adminPassword = (await DB.prepare("SELECT value FROM settings WHERE key = 'admin_password'").first()).value;
  const adminExists = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(adminEmail).first();
  if (!adminExists) {
    const adminHash = await sha256(adminPassword);
    await DB.prepare("INSERT INTO users (name, email, password, is_admin, credits_left) VALUES ('Admin', ?, ?, 1, 999999)").bind(adminEmail, adminHash).run();
  }

  const settings = await getSettings();
  const JWT_SECRET = settings.jwt_secret || "default-jwt-secret-change-me";
  const OPENROUTER_API_KEY = settings.openrouter_api_key || "";
  const AI_MODEL = settings.ai_model || "openai/gpt-3.5-turbo";

  const path = url.pathname;
  const method = request.method;

  try {
    if (path === "/api/auth/signup" && method === "POST") {
      const { name, email, password } = await request.json();
      if (!name || !email || !password) return error("All fields required");
      if (password.length < 6) return error("Password too short");
      const exists = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (exists) return error("Email already registered", 409);
      const hash = await sha256(password);
      const fp = request.headers.get("CF-Connecting-IP") || "unknown";
      const resetAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await DB.prepare("INSERT INTO users (name, email, password, device_fingerprint, credits_left, credits_reset_at) VALUES (?, ?, ?, ?, 3, ?)").bind(name, email, hash, fp, resetAt).run();
      const user = await DB.prepare("SELECT id, name, email, is_admin FROM users WHERE email = ?").bind(email).first();
      const token = await createJWT({ id: user.id, email: user.email }, JWT_SECRET);
      return json({ token, user });
    }

    if (path === "/api/auth/login" && method === "POST") {
      const { email, password } = await request.json();
      if (!email || !password) return error("Email and password required");
      const hash = await sha256(password);
      const user = await DB.prepare("SELECT * FROM users WHERE email = ? AND password = ?").bind(email, hash).first();
      if (!user) return error("Invalid credentials", 401);
      if (user.is_banned) return error("Account banned", 403);
      const isPremium = user.premium_until && new Date(user.premium_until) > new Date();
      const currentFp = request.headers.get("CF-Connecting-IP") || "unknown";
      if (isPremium && user.device_fingerprint && user.device_fingerprint !== currentFp) {
        await DB.prepare("UPDATE users SET is_banned = 1 WHERE id = ?").bind(user.id).run();
        return error("Account banned: Different device", 403);
      }
      if (!isPremium) {
        await DB.prepare("UPDATE users SET device_fingerprint = ? WHERE id = ?").bind(currentFp, user.id).run();
      }
      const token = await createJWT({ id: user.id, email: user.email }, JWT_SECRET);
      return json({ token });
    }

    const user = await authenticate(request, JWT_SECRET);
    if (!user) return error("Unauthorized", 401);
    if (user.is_banned) return error("Account banned", 403);

    if (path === "/api/user/me" && method === "GET") {
      const data = await DB.prepare("SELECT id, name, email, is_admin, is_banned, premium_until, credits_left FROM users WHERE id = ?").bind(user.id).first();
      return json(data);
    }

    if (path === "/api/chat/send" && method === "POST") {
      if (!OPENROUTER_API_KEY) return error("API key not configured. Admin must set it in admin panel.", 500);
      const { message } = await request.json();
      if (!message || !message.trim()) return error("Message required");
      const isPremium = user.premium_until && new Date(user.premium_until) > new Date();
      if (!isPremium) {
        const now = new Date();
        const resetAt = user.credits_reset_at ? new Date(user.credits_reset_at) : null;
        if (!resetAt || now >= resetAt) {
          const newReset = new Date(Date.now() + 7 * 86400000).toISOString();
          await DB.prepare("UPDATE users SET credits_left = 3, credits_reset_at = ? WHERE id = ?").bind(newReset, user.id).run();
          user.credits_left = 3;
        }
        if (user.credits_left <= 0) return error("No credits left", 402);
        await DB.prepare("UPDATE users SET credits_left = credits_left - 1 WHERE id = ?").bind(user.id).run();
      }
      await DB.prepare("INSERT INTO chats (user_id, role, message) VALUES (?, 'user', ?)").bind(user.id, message).run();
      const history = await DB.prepare("SELECT role, message FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").bind(user.id).all();
      const messages = [{ role: "system", content: "You are Exalyte AI, a personal AI study mentor. Help with exam strategy, revision plans, time management. Be friendly and practical." }];
      history.results.reverse().forEach(h => messages.push({ role: h.role, content: h.message }));
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.7, max_tokens: 1000 })
      });
      const aiData = await res.json();
      if (aiData.error) return error("AI Error: " + aiData.error.message, 500);
      const reply = aiData.choices[0].message.content;
      await DB.prepare("INSERT INTO chats (user_id, role, message) VALUES (?, 'assistant', ?)").bind(user.id, reply).run();
      const updated = await DB.prepare("SELECT credits_left, premium_until FROM users WHERE id = ?").bind(user.id).first();
      return json({ reply, credits_left: updated.credits_left, is_premium: updated.premium_until && new Date(updated.premium_until) > new Date() });
    }

    if (path === "/api/chat/history" && method === "GET") {
      const history = await DB.prepare("SELECT role, message, created_at FROM chats WHERE user_id = ? ORDER BY created_at ASC LIMIT 100").bind(user.id).all();
      return json(history.results);
    }

    if (!user.is_admin) return error("Not found", 404);

    if (path === "/api/admin/settings" && method === "GET") {
      return json(settings);
    }

    if (path === "/api/admin/settings" && method === "POST") {
      const { openrouter_api_key, jwt_secret, ai_model, admin_email, admin_password } = await request.json();
      if (openrouter_api_key) await DB.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'openrouter_api_key'").bind(openrouter_api_key).run();
      if (jwt_secret) await DB.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'jwt_secret'").bind(jwt_secret).run();
      if (ai_model) await DB.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'ai_model'").bind(ai_model).run();
      if (admin_email) await DB.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'admin_email'").bind(admin_email).run();
      if (admin_password) {
        await DB.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'admin_password'").bind(admin_password).run();
        const hash = await sha256(admin_password);
        await DB.prepare("UPDATE users SET password = ? WHERE is_admin = 1").bind(hash).run();
      }
      return json({ success: true, message: "Settings updated" });
    }

    if (path === "/api/admin/users" && method === "GET") {
      const users = await DB.prepare("SELECT id, name, email, is_admin, is_banned, premium_until, credits_left, created_at FROM users ORDER BY created_at DESC").all();
      return json(users.results);
    }

    if (path === "/api/admin/grant" && method === "POST") {
      const { email, days } = await request.json();
      if (!email || !days) return error("Email and days required");
      const until = new Date(Date.now() + days * 86400000).toISOString();
      await DB.prepare("UPDATE users SET premium_until = ? WHERE email = ?").bind(until, email).run();
      return json({ success: true });
    }

    if (path === "/api/admin/revoke" && method === "POST") {
      const { email } = await request.json();
      if (!email) return error("Email required");
      await DB.prepare("UPDATE users SET premium_until = NULL WHERE email = ?").bind(email).run();
      return json({ success: true });
    }

    if (path === "/api/admin/unban" && method === "POST") {
      const { email } = await request.json();
      if (!email) return error("Email required");
      await DB.prepare("UPDATE users SET is_banned = 0 WHERE email = ?").bind(email).run();
      return json({ success: true });
    }

    return error("Route not found", 404);
  } catch (e) {
    return error("Server error: " + e.message, 500);
  }
}
