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
  const { data: essays, error } = await sb
    .from('essays')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Attach comment counts
  const { data: commentRows } = await sb.from('comments').select('essay_id');
  const countMap = {};
  (commentRows || []).forEach(c => {
    countMap[c.essay_id] = (countMap[c.essay_id] || 0) + 1;
  });

  const result = essays.map(e => ({ ...e, comment_count: countMap[e.id] || 0 }));
  res.json(result);
});

app.post('/api/essays', async (req, res) => {
  const { name, title, body, avatar } = req.body;

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
      name:   (name  || 'anonymous').slice(0, 40),
      title:  (title || 'Untitled').slice(0, 120),
      body:   body.slice(0, 10000),
      avatar: avatar || null
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  broadcast('essay', data);
  res.status(201).json(data);
});

// ── LIKES ──────────────────────────────────────────────────────
app.post('/api/essays/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const { data, error: fetchErr } = await sb
    .from('essays')
    .select('like_count')
    .eq('id', id)
    .single();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const newCount = (data.like_count || 0) + 1;

  const { error: updateErr } = await sb
    .from('essays')
    .update({ like_count: newCount })
    .eq('id', id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  broadcast('like', { essay_id: id, like_count: newCount });
  res.json({ like_count: newCount });
});

// ── COMMENTS ───────────────────────────────────────────────────
app.get('/api/essays/:id/comments', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('essay_id', id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/essays/:id/comments', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const { name, body, avatar } = req.body;
  if (!body || typeof body !== 'string') return res.status(400).json({ error: 'body required' });
  if (body.length > 500) return res.status(400).json({ error: 'comment too long' });

  const { data, error } = await sb
    .from('comments')
    .insert({
      essay_id: id,
      name:     (name || 'anonymous').slice(0, 40),
      body:     body.slice(0, 500),
      avatar:   avatar || null
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  broadcast('comment', { essay_id: id });
  res.status(201).json(data);
});

// ── THOUGHT LIKES ─────────────────────────────────────────────
app.post('/api/thoughts/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });

  const { data, error: fetchErr } = await sb
    .from('thoughts')
    .select('like_count')
    .eq('id', id)
    .single();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const newCount = (data.like_count || 0) + 1;

  const { error: updateErr } = await sb
    .from('thoughts')
    .update({ like_count: newCount })
    .eq('id', id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  broadcast('thought_like', { thought_id: id, like_count: newCount });
  res.json({ like_count: newCount });
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
  const { name, body, avatar } = req.body;

  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body is required' });
  }
  if (body.length > 280) {
    return res.status(400).json({ error: 'thought exceeds 280 characters' });
  }

  const { data, error } = await sb
    .from('thoughts')
    .insert({
      name:   (name || 'anonymous').slice(0, 40),
      body:   body.slice(0, 280),
      avatar: avatar || null
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  broadcast('thought', data);
  res.status(201).json(data);
});

// ── CANVAS / GRAFFITI WALL ─────────────────────────────────────
app.get('/api/canvas', async (_req, res) => {
  const { data, error } = await sb
    .from('strokes')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/canvas/stroke', async (req, res) => {
  const { points } = req.body;
  if (!points || !Array.isArray(points) || points.length < 2)
    return res.status(400).json({ error: 'invalid stroke' });
  const { data, error } = await sb
    .from('strokes')
    .insert({ points })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.listen(PORT, () => {
  console.log(`Ailouros X running on http://localhost:${PORT}`);
});
