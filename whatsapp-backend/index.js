// Load .env variables (MONGO_URL, WHATSAPP_VERIFY_TOKEN, etc.)
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Our Mongoose models
const Message = require('./models/Message');
const Chat = require('./models/Chat');
const Contact = require('./models/Contact');

const app = express();

// === Middleware ===
app.use(cors());             // Allow cross-origin requests
app.use(express.json());     // Parse JSON bodies
app.use(morgan('dev'));      // Log HTTP requests
app.use(cors({ origin: '*' }));



// === Static uploads directory ===
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
app.use('/uploads', express.static(UPLOAD_DIR));

// === HTTP + Socket.IO server setup ===
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// === Environment variables ===
const PORT = process.env.PORT || 5000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/whatsapp';

// === MongoDB connection ===
mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err.message); process.exit(1); });

// === Socket.IO events ===
io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  // When someone is typing, broadcast to others
  socket.on('typing', payload => {
    socket.broadcast.emit('typing', payload);
  });

  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// === Health check ===
app.get('/api/health', (_, res) => res.json({ ok: true }));

// ----------------------------------------------------------------
// CONTACTS ENDPOINTS
// ----------------------------------------------------------------

// Get all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ displayName: 1 }).lean();
    res.json(contacts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add/update a contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { wa_id, displayName, note } = req.body;
    if (!wa_id) return res.status(400).json({ error: 'wa_id is required' });

    // Upsert contact
    const contact = await Contact.findOneAndUpdate(
      { wa_id },
      { $set: { displayName, note } },
      { upsert: true, new: true }
    );

    // Ensure chat entry exists for this contact
    await Chat.findOneAndUpdate(
      { wa_id },
      { $setOnInsert: { name: displayName || wa_id } },
      { upsert: true }
    );

    res.status(201).json(contact);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----------------------------------------------------------------
// CHATS ENDPOINTS
// ----------------------------------------------------------------

// List chats with last message & unread count
app.get('/api/chats', async (req, res) => {
  try {
    const chats = await Chat.find().lean();
    const results = [];

    for (const chat of chats) {
      // Lookup contact info for display name
      const contact = await Contact.findOne({ wa_id: chat.wa_id }).lean();
      // Get most recent message for preview
      const lastMessage = await Message.findOne({ wa_id: chat.wa_id })
        .sort({ timestamp: -1 }).lean();

      results.push({
        wa_id: chat.wa_id,
        name: contact?.displayName || chat.name || chat.wa_id,
        unreadCount: chat.unreadCount,
        lastMessage: lastMessage ? {
          type: lastMessage.type,
          text: lastMessage.text,
          mediaUrl: lastMessage.mediaUrl,
          caption: lastMessage.caption,
          timestamp: lastMessage.timestamp,
          status: lastMessage.status,
          direction: lastMessage.direction
        } : null
      });
    }

    // Sort by latest message timestamp
    results.sort((a, b) =>
      new Date(b.lastMessage?.timestamp || 0) - new Date(a.lastMessage?.timestamp || 0)
    );

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset unread count when a chat is opened
app.put('/api/chats/:wa_id/read', async (req, res) => {
  try {
    await Chat.findOneAndUpdate({ wa_id: req.params.wa_id }, { unreadCount: 0 });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----------------------------------------------------------------
// MESSAGES ENDPOINTS
// ----------------------------------------------------------------

// Get all messages for a chat
app.get('/api/messages/:wa_id', async (req, res) => {
  try {
    const messages = await Message.find({ wa_id: req.params.wa_id }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a message (text or image)
app.post('/api/messages', async (req, res) => {
  try {
    const {
      wa_id, name, text, type = 'text',
      mediaUrl, mediaMime, caption,
      direction = 'out', replyTo
    } = req.body;

    // Basic validation
    if (!wa_id) return res.status(400).json({ error: 'wa_id is required' });
    if (type === 'text' && !text) return res.status(400).json({ error: 'text required for text type' });
    if (type === 'image' && !mediaUrl) return res.status(400).json({ error: 'mediaUrl required for image type' });

    // Save message to DB
    const msg = await Message.create({
      wa_id,
      name: name || '',
      direction,
      timestamp: new Date(),
      status: 'sent',
      type,
      text: text || '',
      mediaUrl,
      mediaMime,
      caption,
      replyTo: replyTo || null
    });

    // Update chat's unread count for incoming messages
    if (direction === 'in') {
      await Chat.findOneAndUpdate(
        { wa_id },
        { $setOnInsert: { name }, $inc: { unreadCount: 1 } },
        { upsert: true }
      );
    } else {
      await Chat.findOneAndUpdate(
        { wa_id },
        { $setOnInsert: { name } },
        { upsert: true }
      );
    }

    // Notify all connected clients
    io.emit('messages:new', msg);

    res.status(201).json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update delivery/read status
app.put('/api/status', async (req, res) => {
  try {
    const { id, meta_msg_id, status } = req.body;
    if (!status || (!id && !meta_msg_id)) {
      return res.status(400).json({ error: 'status and id or meta_msg_id are required' });
    }

    const query = id ? { msg_id: id } : { meta_msg_id };
    const updated = await Message.findOneAndUpdate(query, { status }, { new: true });
    if (updated) io.emit('messages:update', updated);

    res.json({ ok: true, updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----------------------------------------------------------------
// FILE UPLOAD ENDPOINT
// ----------------------------------------------------------------

// Configure Multer for file storage
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // limit 10MB

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const rel = '/uploads/' + req.file.filename;
  res.status(201).json({ url: rel, mime: req.file.mimetype, size: req.file.size });
});

// ----------------------------------------------------------------
// WEBHOOK ENDPOINTS
// ----------------------------------------------------------------

// For verifying webhook with Meta
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'verify_token_demo';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Handle incoming webhook events (messages + statuses)
app.post('/webhook', async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value || {};

    // --- Incoming messages ---
    if (Array.isArray(value.messages)) {
      for (const m of value.messages) {
        const wa_id = m.from || value?.contacts?.[0]?.wa_id || '';
        const name = value?.contacts?.[0]?.profile?.name || '';
        const timestamp = m.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000) : new Date();
        const msg_id = m.id || '';
        const meta_msg_id = m.context?.id || '';

        if (m.type === 'image') {
          const mediaUrl = m.image?.link || ''; // With real API, download file here
          const caption = m.image?.caption || '';
          const saved = await Message.create({
            wa_id, name, direction: 'in', timestamp, status: 'delivered',
            type: 'image', text: '', mediaUrl, mediaMime: 'image/jpeg', caption,
            msg_id, meta_msg_id
          });
          await Chat.findOneAndUpdate(
            { wa_id },
            { $setOnInsert: { name }, $inc: { unreadCount: 1 } },
            { upsert: true }
          );
          io.emit('messages:new', saved);
        } else {
          const text = m.text?.body || '';
          const saved = await Message.create({
            wa_id, name, direction: 'in', timestamp, status: 'delivered',
            type: 'text', text, msg_id, meta_msg_id
          });
          await Chat.findOneAndUpdate(
            { wa_id },
            { $setOnInsert: { name }, $inc: { unreadCount: 1 } },
            { upsert: true }
          );
          io.emit('messages:new', saved);
        }
      }
    }

    // --- Status updates ---
    if (Array.isArray(value.statuses)) {
      for (const s of value.statuses) {
        const id = s.id;
        const meta_msg_id = s.meta_msg_id;
        const status = s.status || 'unknown';

        const updated = await Message.findOneAndUpdate(
          id ? { msg_id: id } : { meta_msg_id },
          { status },
          { new: true }
        );
        if (updated) io.emit('messages:update', updated);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------------------
// START SERVER
// ----------------------------------------------------------------
server.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
