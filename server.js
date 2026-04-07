require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());
app.use(express.static('public'));

// ── SSE: real-time push to all connected browsers ──────────────
const clients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // heartbeat every 25s to keep the connection alive through proxies
  const hb = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  clients.add(res);

  req.on('close', () => {
    clearInterval(hb);
    clients.delete(res);
  });
});

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => c.write(msg));
}

// ── ESSAYS ─────────────────────────────────────────────────────
app.get('/api/essays', async (_req, res) => {
  const { data, error } = await sb
    .from('essays')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/essays', async (req, res) => {
  const { name, title, body } = req.body;

  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body is required' });
  }

  const wordCount = body.trim().split(/\s+/).length;
  if (wordCount > 1000) {
    return res.status(400).json({ error: 'essay exceeds 1000 words' });
  }

  const { data, error } = await sb
    .from('essays')
    .insert({
      name:  (name  || 'anonymous').slice(0, 40),
      title: (title || 'Untitled').slice(0, 120),
      body:  body.slice(0, 10000)
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  broadcast('essay', data);
  res.status(201).json(data);
});

// ── THOUGHTS ───────────────────────────────────────────────────
app.get('/api/thoughts', async (_req, res) => {
  const { data, error } = await sb
    .from('thoughts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/thoughts', async (req, res) => {
  const { name, body } = req.body;

  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body is required' });
  }
  if (body.length > 280) {
    return res.status(400).json({ error: 'thought exceeds 280 characters' });
  }

  const { data, error } = await sb
    .from('thoughts')
    .insert({
      name: (name || 'anonymous').slice(0, 40),
      body: body.slice(0, 280)
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  broadcast('thought', data);
  res.status(201).json(data);
});

app.listen(PORT, () => {
  console.log(`Ailouros X running on http://localhost:${PORT}`);
});
