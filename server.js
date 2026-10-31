const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// In-memory links store
const linksDB = new Map();
const logs = [
  { time: new Date().toLocaleTimeString(), level: 'ok', text: 'EcoCash Pay server online.' }
];

function addLog(level, text) {
  logs.unshift({ time: new Date().toLocaleTimeString(), level, text });
  if (logs.length > 100) logs.pop();
}

function generateCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

app.post('/api/links', (req, res) => {
  try {
    const payload = req.body;
    let code = generateCode(6);
    while (linksDB.has(code)) code = generateCode(6);
    linksDB.set(code, { ...payload, createdAt: Date.now() });
    addLog('ok', `Link #${code} created for ${payload.rn || 'client'}`);
    res.json({ code, success: true });
  } catch (err) {
    addLog('err', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/links/:code', (req, res) => {
  const link = linksDB.get(req.params.code.toUpperCase());
  if (!link) return res.status(404).json({ error: 'Link not found' });
  res.json(link);
});

app.post('/api/shorten', (req, res) => res.json({ shortUrl: req.body.url }));
app.get('/api/logs', (req, res) => res.json({ entries: logs }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
