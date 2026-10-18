require('dotenv').config();
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

// Listen for new messages and push them to the browser instantly
client.on(Events.MessageCreate, (msg) => {
  if (!allowedChannelIds.includes(msg.channelId)) return;
  if (msg.author.bot) return;

  const channelName = Object.keys(channelMap).find(key => channelMap[key] === msg.channelId);
  
  const payload = {
    id: msg.id,
    author: msg.author.username,
    content: msg.content,
    timestamp: msg.createdAt.toISOString(),
    channel: channelName
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

// Get history
app.get('/api/messages', async (req, res) => {
  const channelName = req.query.channel;
  const channelId = channelMap[channelName];

  if (!channelId) return res.status(400).json({ error: `Channel '${channelName}' not found` });

  try {
    const channel = await client.channels.fetch(channelId);
    const fetched = await channel.messages.fetch({ limit: 50 });
    const data = fetched.map((m) => ({
      id: m.id,
      author: m.author.username,
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      channel: channelName, 
    })).reverse();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send message (Now with a super basic hardcoded password for testing)
app.post('/api/messages', async (req, res) => {
  const { content, channel: channelName, password } = req.body; 
  
  // 🛑 SECURITY CHECK
  if (password !== "mypassword123") {
    return res.status(401).json({ error: 'Unauthorized. Wrong password.' });
  }

  const channelId = channelMap[channelName];
  if (!content || !channelId) return res.status(400).json({ error: 'content and valid channel required' });

  try {
    const channel = await client.channels.fetch(channelId);
    const sent = await channel.send(content);
    res.json({ ok: true, id: sent.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 3000}`);
});