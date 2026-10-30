require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
const PUBLIC_HOSTS = new Set(['stowawaytech.com', 'www.stowawaytech.com', 'stowawaytech.onrender.com']);
const PRIVATE_HOST = 'tech.stowawaytech.com';
const COOKIE = 'stowawaytech_private';
const PASSWORD = process.env.PRIVATE_SITE_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
const secureReady = Boolean(PASSWORD && SECRET && SECRET.length >= 32);
if (!secureReady) console.error('PRIVATE SITE DISABLED: set PRIVATE_SITE_PASSWORD and SESSION_SECRET (at least 32 characters).');
// Only use Express's Host header, not untrusted X-Forwarded-Host.
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!PUBLIC_HOSTS.has(host) && host !== PRIVATE_HOST) return res.status(421).send('Unknown hostname');
  req.isPrivateHost = host === PRIVATE_HOST;
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  if (req.isPrivateHost) res.set('Cache-Control', 'no-store');
  next();
});
function sign(value) { return crypto.createHmac('sha256', SECRET).update(value).digest('base64url'); }
function authed(req) {
  if (!req.isPrivateHost || !secureReady) return false;
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [value, signature] = raw.slice(COOKIE.length + 1).split('.');
  if (!value || !signature || !/^\d+$/.test(value)) return false;
  const a = Buffer.from(signature), b = Buffer.from(sign(value));
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(value) > Date.now() && Number(value) < Date.now() + 24 * 3600e3;
}
function sameOrigin(req) {
  const origin = req.get('origin');
  return origin === 'https://' + PRIVATE_HOST;
}
const attempts = new Map();
function loginLimiter(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const v = attempts.get(key) || { n: 0, until: now + 15 * 60e3 };
  if (now > v.until) { v.n = 0; v.until = now + 15 * 60e3; }
  if (v.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  req.loginAttempt = v; req.loginKey = key;
  next();
}
app.post('/private/login', loginLimiter, (req, res) => {
  if (!req.isPrivateHost || !secureReady) return res.sendStatus(404);
  if (!sameOrigin(req)) return res.sendStatus(403);
  const provided = typeof req.body?.password === 'string' ? req.body.password : '';
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    req.loginAttempt.n++; attempts.set(req.loginKey, req.loginAttempt);
    return res.status(401).json({ error: 'Incorrect password' });
  }
  attempts.delete(req.loginKey);
  const expiry = String(Date.now() + 8 * 3600e3);
  res.setHeader('Set-Cookie', `${COOKIE}=${expiry}.${sign(expiry)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
  res.json({ ok: true });
});
app.post('/private/logout', (req, res) => {
  if (!req.isPrivateHost || !sameOrigin(req)) return res.sendStatus(403);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});
app.get('/private/login', (req, res) => {
  if (!req.isPrivateHost) return res.sendStatus(404);
  if (authed(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'private-login.html'));
});
// Protect every private page and every Discord API call BEFORE serving static files.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    if (!authed(req)) return res.status(403).json({ error: 'Private Discord access only' });
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return res.sendStatus(403);
    return next();
  }
  if (req.isPrivateHost && !authed(req)) {
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect('/private/login');
    return res.sendStatus(403);
  }
  next();
});
// Allowlist public static file types; never serve .env, source code, archives, or internal config.
const safeExtensions = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.json', '.txt', '.webmanifest']);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const pathname = req.path === '/' ? '/index.html' : req.path;
  if (pathname.includes('\\') || pathname.split('/').some(p => p.startsWith('.'))) return res.sendStatus(404);
  if (!safeExtensions.has(path.extname(pathname).toLowerCase())) return res.sendStatus(404);
  if (!req.isPrivateHost && (pathname === '/index.html')) return res.sendFile(path.join(__dirname, 'public-index.html'));
  // Keep internal code, the login page, and private assets inaccessible from public domain.
  if (['/index.js', '/private-login.html', '/public-index.html', '/package.json', '/package-lock.json'].includes(pathname)) return res.sendStatus(404);
  // The public homepage should have its Discord widget removed in index.html as a separate UI change.
  express.static(__dirname, { dotfiles: 'deny', index: 'index.html', fallthrough: false })(req, res, next);
});

// Parse channels from .env
let channelMap = {};
try {
  channelMap = JSON.parse(process.env.CHANNELS || '{}');
} catch (e) {
  console.error("Error parsing CHANNELS in .env");
}

const shorthandToEnvMap = {
  "GEN": "gen",
  "IGC": "gaming",
  "JL":  "joins-leaves",
  "COM": "commands",
  "L":   "Lobby",
  "S":   "Survival",
  "SEC": "general"
};

const allowedChannelIds = Object.values(channelMap);
const sseClients = new Set();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`Monitoring ${allowedChannelIds.length} channels.`);
});

client.on(Events.MessageCreate, (msg) => {
  if (!allowedChannelIds.includes(msg.channelId)) return;
  if (msg.author.bot) return;

  const internalKey = Object.keys(channelMap).find(key => channelMap[key] === msg.channelId);
  const shorthandCode = Object.keys(shorthandToEnvMap).find(
    code => shorthandToEnvMap[code] === internalKey
  ) || 'GEN';
  
  const payload = {
    id: msg.id,
    author: msg.author.username,
    content: msg.content,
    timestamp: msg.createdAt.toISOString(),
    channel: shorthandCode
  };

  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(dataString);
  }
});

if (process.env.DISCORD_TOKEN) client.login(process.env.DISCORD_TOKEN).catch(err => console.error('Discord login failed:', err.message));

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();
  
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/messages', async (req, res) => {
  const shorthandCode = req.query.channel;
  const internalKey = shorthandToEnvMap[shorthandCode];
  const channelId = channelMap[internalKey];

  if (!channelId) return res.status(400).json({ error: `Channel '${shorthandCode}' not found` });

  try {
    const channel = await client.channels.fetch(channelId);
    const fetched = await channel.messages.fetch({ limit: 50 });
    const data = fetched.map((m) => ({
      id: m.id,
      author: m.author.username,
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      channel: shorthandCode, 
    })).reverse();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/verify', (req, res) => {
  // Legacy frontend compatibility: the user is already authenticated to the private site.
  res.json({ success: true });
});

app.post('/api/messages', async (req, res) => {
  const { content, password, username, channel: shorthandCode } = req.body; 

  // Already protected by the private-domain session middleware.

  if (!content) return res.status(400).json({ error: 'content required' });

  try {
    const internalKey = shorthandToEnvMap[shorthandCode || 'S'];
    const targetChannelId = channelMap[internalKey] || channelMap['Survival'];
    
    const channel = await client.channels.fetch(targetChannelId);
    const sender = username || 'WebUser';
    const formattedMessage = `[Farkie WebChat]: ${content}`;

    const sent = await channel.send(formattedMessage);
    res.json({ ok: true, id: sent.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(process.env.PORT || 3000, () => console.log('StowawayTech running on port ' + (process.env.PORT || 3000)));
