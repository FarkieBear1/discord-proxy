require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Serve the index.html file directly from the backend
app.use(express.static(__dirname));

// Parse channels from .env
let channelMap = {};
try {
  channelMap = JSON.parse(process.env.CHANNELS || '{}');
} catch (e) {
  console.error("Error parsing CHANNELS in .env");
}

// ==========================================
// SECURE SERVER-SIDE SHORTHAND MAPPING
// ==========================================
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

// SSE Clients array
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

// Listen for new messages and push them to the browser instantly using shorthand codes
client.on(Events.MessageCreate, (msg) => {
  if (!allowedChannelIds.includes(msg.channelId)) return;
  if (msg.author.bot) return;

  const internalKey = Object.keys(channelMap).find(key => channelMap[key] === msg.channelId);
  
  // Find matching shorthand code to send to frontend safely
  const shorthandCode = Object.keys(shorthandToEnvMap).find(
    code => shorthandToEnvMap[code] === internalKey
  ) || 'GEN';
  
  const payload = {
    id: msg.id,
    author: msg.author.username,
    content: msg.content,
    timestamp: msg.createdAt.toISOString(),
    channel: shorthandCode // Sends shorthand instead of internal name
  };

  // Send to all connected browsers
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(dataString);
  }
});

client.login(process.env.DISCORD_TOKEN);

// Endpoint for the browser to listen to live updates
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.flushHeaders();
  
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Get history using shorthand mapping
app.get('/api/messages', async (req, res) => {
  const shorthandCode = req.query.channel; // e.g., "S", "GEN"
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

// 1. Endpoint to verify the technician password
app.post('/api/verify', (req, res) => {
  const { password } = req.body;
  
  if (password === "T3chRep@ir26!") {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: 'Invalid password' });
  }
});

// 2. Send message (Password Protected)
app.post('/api/messages', async (req, res) => {
  const { content, password, username, channel: shorthandCode } = req.body; 

  // 🛑 THE PASSWORD CHECK
  if (password !== "T3chRep@ir26!") {
    return res.status(403).json({ error: 'Access Denied: Invalid Technician ID.' });
  }

  if (!content) return res.status(400).json({ error: 'content required' });

  try {
    // Resolve shorthand code securely on the server side
    const internalKey = shorthandToEnvMap[shorthandCode || 'S'];
    const targetChannelId = channelMap[internalKey] || channelMap['Survival'];
    
    const channel = await client.channels.fetch(targetChannelId);
    const sender = username || 'WebUser';
    
    // Formatted message matching your CoreChatX trigger requirement
    const formattedMessage = `!alert [Farkie WebChat]: ${content}`;

    const sent = await channel.send(formattedMessage);
    res.json({ ok: true, id: sent.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 3000}`);
});