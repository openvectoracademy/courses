// Alcove Messenger — Complete Backend API
// Cloudflare Pages + D1 (binding: COMMUNITY_DB)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

async function sha256(message) {
  const buf = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(payload, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const JWT_SECRET = 'alcove-messenger-secret-key-2026';

async function createToken(user) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
  const payload = btoa(JSON.stringify({
    id: user.id, email: user.email, role: user.role,
    exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
  })).replace(/=+$/, '');
  const sig = await hmacSign(`${header}.${payload}`, JWT_SECRET);
  return `${header}.${payload}.${sig}`;
}

async function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = await hmacSign(`${parts[0]}.${parts[1]}`, JWT_SECRET);
    if (expectedSig !== parts[2]) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

async function getUser(req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  return await verifyToken(token);
}

async function requireAuth(req) {
  const user = await getUser(req);
  if (!user) throw { status: 401, message: 'Authentication required' };
  return user;
}

async function requireAdmin(req) {
  const user = await requireAuth(req);
  if (user.role !== 'admin') throw { status: 403, message: 'Admin access required' };
  return user;
}

async function ensureTables(db) {
  if (globalThis.__alcoveTablesReady) return;

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_approved INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS groups_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      invite_code TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      is_banned INTEGER DEFAULT 0,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS dm_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL,
      user2_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user1_id, user2_id)
    )`,
    `CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS dm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dm_room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS daily_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS task_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, group_id, task_id, date(completed_at))
    )`,
    `CREATE TABLE IF NOT EXISTS wallet (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      coins INTEGER DEFAULT 0,
      diamonds INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_completion_date DATE,
      week_multiplier INTEGER DEFAULT 1,
      UNIQUE(user_id, group_id)
    )`,
    `CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      is_approved INTEGER DEFAULT 0,
      diamonds_spent INTEGER DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER UNIQUE,
      is_enabled INTEGER DEFAULT 0,
      api_key TEXT,
      notification_hour INTEGER DEFAULT 18,
      personality TEXT DEFAULT 'motivational',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const sql of tables) {
    try { await db.prepare(sql).run(); } catch (e) { /* ignore */ }
  }

  // Seed admin
  const adminHash = await sha256('Admin@2026!');
  await db.prepare(
    `INSERT OR IGNORE INTO users (name, email, password, role, is_approved)
     VALUES ('Admin', 'admin@alcove.messenger', ?, 'admin', 1)`
  ).bind(adminHash).run();

  globalThis.__alcoveTablesReady = true;
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.COMMUNITY_DB;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    await ensureTables(db);

    // ==================== AUTH ====================
    if (method === 'POST' && path === '/auth/login') {
      const { email, password } = await request.json();
      if (!email || !password) return err('Email and password required');
      const hash = await sha256(password);
      const user = await db.prepare(
        'SELECT * FROM users WHERE email = ? AND password = ? AND is_approved = 1'
      ).bind(email, hash).first();
      if (!user) return err('Invalid credentials', 401);
      const token = await createToken(user);
      return json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }

    if (method === 'POST' && path === '/auth/signup') {
      const { name, email, password } = await request.json();
      if (!name || !email || !password) return err('All fields required');
      if (password.length < 6) return err('Password must be at least 6 characters');
      const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (existing) return err('Email already registered', 409);
      const hash = await sha256(password);
      const result = await db.prepare(
        'INSERT INTO users (name, email, password) VALUES (?, ?, ?)'
      ).bind(name, email, hash).run();
      return json({ message: 'Account created', userId: result.meta.last_row_id }, 201);
    }

    // ==================== GROUPS ====================
    if (method === 'POST' && path === '/groups/join') {
      const user = await requireAuth(request);
      const { invite_code } = await request.json();
      if (!invite_code) return err('Invite code required');
      
      const group = await db.prepare(
        'SELECT * FROM groups_table WHERE invite_code = ? AND is_active = 1'
      ).bind(invite_code.trim().toUpperCase()).first();
      if (!group) return err('Invalid or inactive invite code', 404);
      
      const already = await db.prepare(
        'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
      ).bind(group.id, user.id).first();
      if (already) return err('Already a member of this group', 409);
      
      await db.prepare(
        'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)'
      ).bind(group.id, user.id).run();
      
      return json({ group: { id: group.id, name: group.name, description: group.description } });
    }

    if (method === 'GET' && path === '/groups') {
      const user = await requireAuth(request);
      const groups = await db.prepare(
        `SELECT g.* FROM groups_table g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = ? AND gm.is_banned = 0 AND g.is_active = 1`
      ).bind(user.id).all();
      return json({ groups: groups.results });
    }

    if (method === 'GET' && path.match(/^\/groups\/(\d+)$/)) {
      const user = await requireAuth(request);
      const groupId = path.match(/^\/groups\/(\d+)$/)[1];
      const group = await db.prepare('SELECT * FROM groups_table WHERE id = ?').bind(groupId).first();
      if (!group) return err('Group not found', 404);
      const memberCount = await db.prepare(
        'SELECT COUNT(*) as count FROM group_members WHERE group_id = ? AND is_banned = 0'
      ).bind(groupId).first();
      return json({ group: { ...group, member_count: memberCount.count } });
    }

    if (method === 'POST' && path === '/groups/leave') {
      const user = await requireAuth(request);
      const { group_id } = await request.json();
      await db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(group_id, user.id).run();
      return json({ message: 'Left group' });
    }

    // ==================== GROUP MESSAGES ====================
    if (method === 'GET' && path.match(/^\/groups\/(\d+)\/messages$/)) {
      const user = await requireAuth(request);
      const groupId = path.match(/^\/groups\/(\d+)\/messages$/)[1];
      
      // Auto-clean old messages
      await db.prepare("DELETE FROM group_messages WHERE created_at < datetime('now', '-24 hours')").run();
      
      const messages = await db.prepare(
        'SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at ASC LIMIT 200'
      ).bind(groupId).all();
      return json({ messages: messages.results });
    }

    if (method === 'POST' && path.match(/^\/groups\/(\d+)\/send$/)) {
      const user = await requireAuth(request);
      const groupId = path.match(/^\/groups\/(\d+)\/send$/)[1];
      const { message } = await request.json();
      if (!message || !message.trim()) return err('Message required');
      
      const member = await db.prepare(
        'SELECT id FROM group_members WHERE group_id = ? AND user_id = ? AND is_banned = 0'
      ).bind(groupId, user.id).first();
      if (!member) return err('Not a member of this group', 403);
      
      await db.prepare(
        'INSERT INTO group_messages (group_id, user_id, user_name, message) VALUES (?, ?, ?, ?)'
      ).bind(groupId, user.id, user.name, message.trim()).run();
      
      return json({ sent: true });
    }

    // ==================== CONVERSATIONS (DMs) ====================
    if (method === 'GET' && path === '/conversations') {
      const user = await requireAuth(request);
      const dms = await db.prepare(
        `SELECT d.*, u1.name as user1_name, u2.name as user2_name
         FROM dm_rooms d
         JOIN users u1 ON d.user1_id = u1.id
         JOIN users u2 ON d.user2_id = u2.id
         WHERE (d.user1_id = ? OR d.user2_id = ?) AND d.is_active = 1`
      ).bind(user.id, user.id).all();
      return json({ conversations: dms.results });
    }

    if (method === 'GET' && path.match(/^\/conversations\/(\d+)\/messages$/)) {
      const user = await requireAuth(request);
      const roomId = path.match(/^\/conversations\/(\d+)\/messages$/)[1];
      
      const room = await db.prepare('SELECT * FROM dm_rooms WHERE id = ? AND is_active = 1').bind(roomId).first();
      if (!room) return err('Conversation not found', 404);
      if (room.user1_id !== user.id && room.user2_id !== user.id) return err('Access denied', 403);
      
      // Auto-clean old messages
      await db.prepare("DELETE FROM dm_messages WHERE created_at < datetime('now', '-7 days')").run();
      
      const messages = await db.prepare(
        'SELECT * FROM dm_messages WHERE dm_room_id = ? ORDER BY created_at ASC LIMIT 200'
      ).bind(roomId).all();
      return json({ messages: messages.results });
    }

    if (method === 'POST' && path.match(/^\/conversations\/(\d+)\/send$/)) {
      const user = await requireAuth(request);
      const roomId = path.match(/^\/conversations\/(\d+)\/send$/)[1];
      const { message } = await request.json();
      if (!message || !message.trim()) return err('Message required');
      
      const room = await db.prepare('SELECT * FROM dm_rooms WHERE id = ? AND is_active = 1').bind(roomId).first();
      if (!room) return err('Conversation not found', 404);
      if (room.user1_id !== user.id && room.user2_id !== user.id) return err('Access denied', 403);
      
      await db.prepare(
        'INSERT INTO dm_messages (dm_room_id, user_id, message) VALUES (?, ?, ?)'
      ).bind(roomId, user.id, message.trim()).run();
      
      return json({ sent: true });
    }

    // ==================== TASKS ====================
    if (method === 'GET' && path.match(/^\/groups\/(\d+)\/tasks$/)) {
      const user = await requireAuth(request);
      const groupId = path.match(/^\/groups\/(\d+)\/tasks$/)[1];
      const tasks = await db.prepare(
        'SELECT * FROM daily_tasks WHERE group_id = ? AND is_active = 1 ORDER BY sort_order'
      ).bind(groupId).all();
      
      // Get today's completions
      const today = new Date().toISOString().substring(0, 10);
      const completions = await db.prepare(
        'SELECT task_id FROM task_completions WHERE user_id = ? AND group_id = ? AND date(completed_at) = ?'
      ).bind(user.id, groupId, today).all();
      const completedIds = completions.results.map(c => c.task_id);
      
      return json({
        tasks: tasks.results.map(t => ({ ...t, completed: completedIds.includes(t.id) }))
      });
    }

    if (method === 'POST' && path === '/tasks/complete') {
      const user = await requireAuth(request);
      const { group_id, task_id } = await request.json();
      
      const today = new Date().toISOString().substring(0, 10);
      await db.prepare(
        'INSERT OR IGNORE INTO task_completions (user_id, group_id, task_id, completed_at) VALUES (?, ?, ?, datetime("now"))'
      ).bind(user.id, group_id, task_id).run();
      
      return json({ completed: true });
    }

    if (method === 'POST' && path === '/tasks/complete-all') {
      const user = await requireAuth(request);
      const { group_id } = await request.json();
      
      const tasks = await db.prepare(
        'SELECT id FROM daily_tasks WHERE group_id = ? AND is_active = 1'
      ).bind(group_id).all();
      
      const today = new Date().toISOString().substring(0, 10);
      
      for (const task of tasks.results) {
        await db.prepare(
          'INSERT OR IGNORE INTO task_completions (user_id, group_id, task_id, completed_at) VALUES (?, ?, ?, datetime("now"))'
        ).bind(user.id, group_id, task.id).run();
      }
      
      // Calculate rewards
      const wallet = await db.prepare(
        'SELECT * FROM wallet WHERE user_id = ? AND group_id = ?'
      ).bind(user.id, group_id).first();
      
      let streak = 1, multiplier = 1, coins = 1, diamonds = 0;
      
      if (wallet && wallet.last_completion_date) {
        const lastDate = new Date(wallet.last_completion_date);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (lastDate.toDateString() === yesterday.toDateString()) {
          streak = (wallet.current_streak || 0) + 1;
          multiplier = wallet.week_multiplier || 1;
        }
        
        if (streak % 7 === 0) {
          const weeks = Math.floor(streak / 7);
          coins = streak + (streak * multiplier);
          diamonds = 1 * multiplier;
          multiplier++;
        } else {
          coins = 1;
        }
      }
      
      if (wallet) {
        await db.prepare(
          `UPDATE wallet SET coins = coins + ?, diamonds = diamonds + ?,
           current_streak = ?, longest_streak = MAX(longest_streak, ?),
           last_completion_date = ?, week_multiplier = ?
           WHERE user_id = ? AND group_id = ?`
        ).bind(coins, diamonds, streak, streak, today, multiplier, user.id, group_id).run();
      } else {
        await db.prepare(
          `INSERT INTO wallet (user_id, group_id, coins, diamonds, current_streak, longest_streak, last_completion_date, week_multiplier)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(user.id, group_id, coins, diamonds, streak, streak, today, multiplier).run();
      }
      
      return json({
        coins_earned: coins,
        diamonds_earned: diamonds,
        streak: streak,
        multiplier: multiplier
      });
    }

    // ==================== WALLET ====================
    if (method === 'GET' && path.match(/^\/wallet\/(\d+)$/)) {
      const user = await requireAuth(request);
      const groupId = path.match(/^\/wallet\/(\d+)$/)[1];
      const wallet = await db.prepare(
        'SELECT * FROM wallet WHERE user_id = ? AND group_id = ?'
      ).bind(user.id, groupId).first();
      return json({ wallet: wallet || { coins: 0, diamonds: 0, current_streak: 0, week_multiplier: 1 } });
    }

    // ==================== RESOURCES ====================
    if (method === 'GET' && path.match(/^\/groups\/(\d+)\/resources$/)) {
      const groupId = path.match(/^\/groups\/(\d+)\/resources$/)[1];
      const resources = await db.prepare(
        `SELECT r.*, u.name as user_name FROM resources r
         JOIN users u ON r.user_id = u.id
         WHERE r.group_id = ? AND r.is_approved = 1
         ORDER BY r.created_at DESC`
      ).bind(groupId).all();
      return json({ resources: resources.results });
    }

    if (method === 'POST' && path === '/resources/submit') {
      const user = await requireAuth(request);
      const { group_id, title, type, content } = await request.json();
      if (!title || !type || !content) return err('Title, type, and content required');
      
      // Check diamonds
      const wallet = await db.prepare(
        'SELECT diamonds FROM wallet WHERE user_id = ? AND group_id = ?'
      ).bind(user.id, group_id).first();
      
      if (!wallet || wallet.diamonds < 3) return err('You need 3 diamonds to post a resource. Complete daily tasks!', 402);
      
      // Deduct diamonds
      await db.prepare(
        'UPDATE wallet SET diamonds = diamonds - 3 WHERE user_id = ? AND group_id = ?'
      ).bind(user.id, group_id).run();
      
      // Insert resource
      const result = await db.prepare(
        'INSERT INTO resources (group_id, user_id, title, type, content, diamonds_spent) VALUES (?, ?, ?, ?, ?, 3)'
      ).bind(group_id, user.id, title, type, content).run();
      
      return json({ id: result.meta.last_row_id, message: 'Resource submitted for approval' }, 201);
    }

    // ==================== ADMIN ====================
    if (method === 'GET' && path === '/admin/groups') {
      await requireAdmin(request);
      const groups = await db.prepare('SELECT * FROM groups_table ORDER BY created_at DESC').all();
      return json({ groups: groups.results });
    }

    if (method === 'POST' && path === '/admin/groups') {
      const admin = await requireAdmin(request);
      const { name, description } = await request.json();
      if (!name) return err('Name required');
      
      const code = 'ALC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const result = await db.prepare(
        'INSERT INTO groups_table (name, description, invite_code, created_by) VALUES (?, ?, ?, ?)'
      ).bind(name, description || '', code, admin.id).run();
      
      return json({ id: result.meta.last_row_id, invite_code: code }, 201);
    }

    if (method === 'PUT' && path.match(/^\/admin\/groups\/(\d+)$/)) {
      await requireAdmin(request);
      const groupId = path.match(/^\/admin\/groups\/(\d+)$/)[1];
      const { is_active } = await request.json();
      await db.prepare('UPDATE groups_table SET is_active = ? WHERE id = ?').bind(is_active ? 1 : 0, groupId).run();
      return json({ message: is_active ? 'Group activated' : 'Group closed' });
    }

    if (method === 'DELETE' && path.match(/^\/admin\/groups\/(\d+)$/)) {
      await requireAdmin(request);
      const groupId = path.match(/^\/admin\/groups\/(\d+)$/)[1];
      await db.prepare('DELETE FROM group_messages WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM group_members WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM task_completions WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM daily_tasks WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM wallet WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM resources WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM ai_settings WHERE group_id = ?').bind(groupId).run();
      await db.prepare('DELETE FROM groups_table WHERE id = ?').bind(groupId).run();
      return json({ message: 'Group deleted' });
    }

    if (method === 'GET' && path.match(/^\/admin\/groups\/(\d+)\/members$/)) {
      await requireAdmin(request);
      const groupId = path.match(/^\/admin\/groups\/(\d+)\/members$/)[1];
      const members = await db.prepare(
        `SELECT gm.*, u.name, u.email FROM group_members gm
         JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?`
      ).bind(groupId).all();
      return json({ members: members.results });
    }

    if (method === 'PUT' && path.match(/^\/admin\/members\/(\d+)\/ban$/)) {
      await requireAdmin(request);
      const memberId = path.match(/^\/admin\/members\/(\d+)\/ban$/)[1];
      await db.prepare('UPDATE group_members SET is_banned = 1 WHERE id = ?').bind(memberId).run();
      return json({ message: 'User banned' });
    }

    if (method === 'PUT' && path.match(/^\/admin\/members\/(\d+)\/unban$/)) {
      await requireAdmin(request);
      const memberId = path.match(/^\/admin\/members\/(\d+)\/unban$/)[1];
      await db.prepare('UPDATE group_members SET is_banned = 0 WHERE id = ?').bind(memberId).run();
      return json({ message: 'User unbanned' });
    }

    // Admin — Conversations
    if (method === 'POST' && path === '/admin/conversations') {
      const admin = await requireAdmin(request);
      const { user1_id, user2_id } = await request.json();
      if (!user1_id || !user2_id) return err('Both user IDs required');
      if (user1_id === user2_id) return err('Cannot create conversation with same user');
      
      const a = Math.min(user1_id, user2_id);
      const b = Math.max(user1_id, user2_id);
      
      await db.prepare(
        'INSERT OR IGNORE INTO dm_rooms (user1_id, user2_id, created_by) VALUES (?, ?, ?)'
      ).bind(a, b, admin.id).run();
      
      return json({ message: 'Conversation created' }, 201);
    }

    if (method === 'GET' && path === '/admin/conversations') {
      await requireAdmin(request);
      const dms = await db.prepare(
        `SELECT d.*, u1.name as user1_name, u2.name as user2_name
         FROM dm_rooms d
         JOIN users u1 ON d.user1_id = u1.id
         JOIN users u2 ON d.user2_id = u2.id
         ORDER BY d.created_at DESC`
      ).all();
      return json({ conversations: dms.results });
    }

    if (method === 'DELETE' && path.match(/^\/admin\/conversations\/(\d+)$/)) {
      await requireAdmin(request);
      const roomId = path.match(/^\/admin\/conversations\/(\d+)$/)[1];
      await db.prepare('DELETE FROM dm_messages WHERE dm_room_id = ?').bind(roomId).run();
      await db.prepare('DELETE FROM dm_rooms WHERE id = ?').bind(roomId).run();
      return json({ message: 'Conversation deleted' });
    }

    // Admin — Tasks
    if (method === 'POST' && path === '/admin/tasks') {
      await requireAdmin(request);
      const { group_id, title, description } = await request.json();
      const result = await db.prepare(
        'INSERT INTO daily_tasks (group_id, title, description) VALUES (?, ?, ?)'
      ).bind(group_id, title, description || '').run();
      return json({ id: result.meta.last_row_id }, 201);
    }

    if (method === 'DELETE' && path.match(/^\/admin\/tasks\/(\d+)$/)) {
      await requireAdmin(request);
      const taskId = path.match(/^\/admin\/tasks\/(\d+)$/)[1];
      await db.prepare('DELETE FROM task_completions WHERE task_id = ?').bind(taskId).run();
      await db.prepare('DELETE FROM daily_tasks WHERE id = ?').bind(taskId).run();
      return json({ message: 'Task deleted' });
    }

    // Admin — Resources
    if (method === 'GET' && path === '/admin/resources/pending') {
      await requireAdmin(request);
      const resources = await db.prepare(
        `SELECT r.*, u.name as user_name FROM resources r
         JOIN users u ON r.user_id = u.id WHERE r.is_approved = 0 ORDER BY r.created_at DESC`
      ).all();
      return json({ resources: resources.results });
    }

    if (method === 'PUT' && path.match(/^\/admin\/resources\/(\d+)\/approve$/)) {
      await requireAdmin(request);
      const resId = path.match(/^\/admin\/resources\/(\d+)\/approve$/)[1];
      await db.prepare('UPDATE resources SET is_approved = 1 WHERE id = ?').bind(resId).run();
      return json({ message: 'Resource approved' });
    }

    if (method === 'PUT' && path.match(/^\/admin\/resources\/(\d+)\/reject$/)) {
      await requireAdmin(request);
      const resId = path.match(/^\/admin\/resources\/(\d+)\/reject$/)[1];
      const resource = await db.prepare('SELECT * FROM resources WHERE id = ?').bind(resId).first();
      if (resource) {
        // Refund diamonds
        await db.prepare(
          'UPDATE wallet SET diamonds = diamonds + 3 WHERE user_id = ? AND group_id = ?'
        ).bind(resource.user_id, resource.group_id).run();
      }
      await db.prepare('DELETE FROM resources WHERE id = ?').bind(resId).run();
      return json({ message: 'Resource rejected and refunded' });
    }

    // Admin — AI Settings
    if (method === 'GET' && path.match(/^\/admin\/ai-settings\/(\d+)$/)) {
      await requireAdmin(request);
      const groupId = path.match(/^\/admin\/ai-settings\/(\d+)$/)[1];
      const settings = await db.prepare('SELECT * FROM ai_settings WHERE group_id = ?').bind(groupId).first();
      return json({ settings: settings || { is_enabled: 0 } });
    }

    if (method === 'PUT' && path.match(/^\/admin\/ai-settings\/(\d+)$/)) {
      await requireAdmin(request);
      const groupId = path.match(/^\/admin\/ai-settings\/(\d+)$/)[1];
      const { is_enabled, api_key, notification_hour, personality } = await request.json();
      
      const existing = await db.prepare('SELECT id FROM ai_settings WHERE group_id = ?').bind(groupId).first();
      if (existing) {
        await db.prepare(
          `UPDATE ai_settings SET is_enabled = ?, api_key = ?, notification_hour = ?, personality = ?, updated_at = datetime('now')
           WHERE group_id = ?`
        ).bind(is_enabled ? 1 : 0, api_key || null, notification_hour || 18, personality || 'motivational', groupId).run();
      } else {
        await db.prepare(
          `INSERT INTO ai_settings (group_id, is_enabled, api_key, notification_hour, personality)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(groupId, is_enabled ? 1 : 0, api_key || null, notification_hour || 18, personality || 'motivational').run();
      }
      return json({ message: 'AI settings saved' });
    }

    return err('Not found', 404);

  } catch (e) {
    console.error('API Error:', e);
    if (e.status) return err(e.message, e.status);
    return err('Internal server error', 500);
  }
}
