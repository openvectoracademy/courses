// functions/api/[[route]].js
// Exalyte AI - Complete Backend with Environment Variables

export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB;
  
  // Get secrets from environment variables
  const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  const JWT_SECRET = env.JWT_SECRET;
  const AI_MODEL = "openai/gpt-3.5-turbo";
  
  // Validate secrets
  if (!OPENROUTER_API_KEY || !JWT_SECRET) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  
  // CORS headers helper
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
  
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  // Helper functions
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  
  function error(msg, status = 400) {
    return json({ error: msg }, status);
  }
  
  // SHA-256 hashing
  async function sha256(message) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // JWT functions
  async function createJWT(payload) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(payload));
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    
    const signature = await crypto.subtle.sign(
      "HMAC", key,
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }
  
  async function verifyJWT(token) {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split('.');
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", encoder.encode(JWT_SECRET),
        { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
      );
      
      const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
      const valid = await crypto.subtle.verify(
        "HMAC", key, signature,
        encoder.encode(`${headerB64}.${payloadB64}`)
      );
      
      if (!valid) return null;
      return JSON.parse(atob(payloadB64));
    } catch {
      return null;
    }
  }
  
  async function authenticate(req) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.split(" ")[1];
    const payload = await verifyJWT(token);
    if (!payload) return null;
    return await DB.prepare("SELECT * FROM users WHERE id = ?").bind(payload.id).first();
  }
  
  // Initialize database
  async function ensureTables() {
    await DB.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        premium_until DATETIME,
        credits_left INTEGER DEFAULT 3,
        credits_reset_at DATETIME,
        device_fingerprint TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    
    // Seed admin
    const admin = await DB.prepare("SELECT id FROM users WHERE email = ?").bind("adminai@gmail.com").first();
    if (!admin) {
      const hash = await sha256("adminai2099");
      await DB.prepare(
        "INSERT INTO users (name, email, password, is_admin, credits_left) VALUES (?, ?, ?, 1, 999999)"
      ).bind("Admin", "adminai@gmail.com", hash).run();
    }
  }
  
  // AI call
  async function callAI(messages) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://exalyte-ai.pages.dev",
        "X-Title": "Exalyte AI"
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "AI error");
    return data.choices[0].message.content;
  }
  
  // Initialize DB
  await ensureTables();
  
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  try {
    // ==================== AUTH ROUTES ====================
    
    if (path === "/api/auth/signup" && method === "POST") {
      const body = await request.json();
      const { name, email, password } = body;
      
      if (!name || !email || !password) return error("All fields required");
      if (password.length < 6) return error("Password must be 6+ characters");
      
      const exists = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (exists) return error("Email already registered", 409);
      
      const hash = await sha256(password);
      const fingerprint = request.headers.get("CF-Connecting-IP") || "unknown";
      const resetAt = new Date(Date.now() + 7 * 86400000).toISOString();
      
      await DB.prepare(
        "INSERT INTO users (name, email, password, device_fingerprint, credits_left, credits_reset_at) VALUES (?, ?, ?, ?, 3, ?)"
      ).bind(name, email, hash, fingerprint, resetAt).run();
      
      const user = await DB.prepare("SELECT id, name, email, is_admin FROM users WHERE email = ?").bind(email).first();
      const token = await createJWT({ id: user.id, email: user.email });
      
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
      const currentFingerprint = request.headers.get("CF-Connecting-IP") || "unknown";
      
      if (isPremium && user.device_fingerprint && user.device_fingerprint !== currentFingerprint) {
        await DB.prepare("UPDATE users SET is_banned = 1 WHERE id = ?").bind(user.id).run();
        return error("Account banned: Different device detected", 403);
      }
      
      if (!isPremium) {
        await DB.prepare("UPDATE users SET device_fingerprint = ? WHERE id = ?").bind(currentFingerprint, user.id).run();
      }
      
      const token = await createJWT({ id: user.id, email: user.email });
      return json({ token });
    }
    
    // ==================== PROTECTED ROUTES ====================
    
    const user = await authenticate(request);
    if (!user) return error("Unauthorized", 401);
    if (user.is_banned) return error("Account banned", 403);
    
    // User profile
    if (path === "/api/user/me" && method === "GET") {
      const data = await DB.prepare(
        "SELECT id, name, email, is_admin, is_banned, premium_until, credits_left, credits_reset_at, created_at FROM users WHERE id = ?"
      ).bind(user.id).first();
      return json(data);
    }
    
    // Send chat message
    if (path === "/api/chat/send" && method === "POST") {
      const { message } = await request.json();
      if (!message || !message.trim()) return error("Message required");
      
      const isPremium = user.premium_until && new Date(user.premium_until) > new Date();
      
      // Credit check for free users
      if (!isPremium) {
        const now = new Date();
        const resetAt = user.credits_reset_at ? new Date(user.credits_reset_at) : null;
        
        if (!resetAt || now >= resetAt) {
          const newReset = new Date(Date.now() + 7 * 86400000).toISOString();
          await DB.prepare("UPDATE users SET credits_left = 3, credits_reset_at = ? WHERE id = ?").bind(newReset, user.id).run();
          user.credits_left = 3;
        }
        
        if (user.credits_left <= 0) return error("No credits left. Upgrade to premium.", 402);
        await DB.prepare("UPDATE users SET credits_left = credits_left - 1 WHERE id = ?").bind(user.id).run();
      }
      
      // Save user message
      await DB.prepare("INSERT INTO chats (user_id, role, message) VALUES (?, 'user', ?)").bind(user.id, message).run();
      
      // Get context
      const history = await DB.prepare(
        "SELECT role, message FROM chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
      ).bind(user.id).all();
      
      const messages = [{
        role: "system",
        content: "You are Exalyte AI, a personal AI study mentor for students. Help with: exam strategy, revision plans, what to study, time management, motivation, based on the student's situation. Be friendly, concise, and practical. Ask about their exam date, subjects, and weak areas if not provided."
      }];
      
      history.results.reverse().forEach(h => messages.push({ role: h.role, content: h.message }));
      
      // Get AI response
      const reply = await callAI(messages);
      
      // Save AI response
      await DB.prepare("INSERT INTO chats (user_id, role, message) VALUES (?, 'assistant', ?)").bind(user.id, reply).run();
      
      const updated = await DB.prepare("SELECT credits_left, premium_until FROM users WHERE id = ?").bind(user.id).first();
      
      return json({
        reply,
        credits_left: updated.credits_left,
        is_premium: updated.premium_until && new Date(updated.premium_until) > new Date()
      });
    }
    
    // Chat history
    if (path === "/api/chat/history" && method === "GET") {
      const history = await DB.prepare(
        "SELECT role, message, created_at FROM chats WHERE user_id = ? ORDER BY created_at ASC LIMIT 100"
      ).bind(user.id).all();
      return json(history.results);
    }
    
    // ==================== ADMIN ROUTES ====================
    
    if (!user.is_admin) return error("Route not found", 404);
    
    if (path === "/api/admin/users" && method === "GET") {
      const users = await DB.prepare(
        "SELECT id, name, email, is_admin, is_banned, premium_until, credits_left, created_at FROM users ORDER BY created_at DESC"
      ).all();
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
    
    if (path === "/api/admin/extend" && method === "POST") {
      const { email, days } = await request.json();
      if (!email || !days) return error("Email and days required");
      
      const target = await DB.prepare("SELECT premium_until FROM users WHERE email = ?").bind(email).first();
      if (!target) return error("User not found");
      
      const current = target.premium_until ? new Date(target.premium_until) : new Date();
      current.setDate(current.getDate() + days);
      
      await DB.prepare("UPDATE users SET premium_until = ? WHERE email = ?").bind(current.toISOString(), email).run();
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
    console.error(e);
    return error("Internal server error", 500);
  }
}
