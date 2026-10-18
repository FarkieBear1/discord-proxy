require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static files (HTML, CSS, images) from the root directory
app.use(express.static(__dirname));

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

client.login(process.env.DISCORD_TOKEN);

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

app.post('/api/verify', (express.json()), (req, res) => {
  const { password } = req.body;
  
  // Compare against environment variable securely
  if (password === process.env.TECH_PASSWORD) {
    return res.json({ success: true });
  } else {
    return res.status(401).json({ success: false, error: 'Invalid Password' });
  }
});

app.post('/api/messages', async (req, res) => {
  const { content, password, username, channel: shorthandCode } = req.body; 

  if (password !== "T3chRep@ir26!") {
    return res.status(403).json({ error: 'Access Denied: Invalid Technician ID.' });
  }

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

app.listen(process.env.PORT || 3000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 3000}`);
});