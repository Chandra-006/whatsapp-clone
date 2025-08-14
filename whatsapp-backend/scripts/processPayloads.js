require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Chat = require('../models/Chat');

const PAYLOAD_DIR = process.argv[2] || path.join(__dirname, '..', 'payloads');
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/whatsapp';

async function main() {
  await mongoose.connect(MONGO_URL);
  console.log('✅ Connected to MongoDB');

  const files = fs.readdirSync(PAYLOAD_DIR).filter(f => f.endsWith('.json'));
  console.log(`📂 Found ${files.length} JSON file(s) in ${PAYLOAD_DIR}`);

  for (const file of files) {
    const fullPath = path.join(PAYLOAD_DIR, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️ Skipping invalid JSON: ${file}`);
      continue;
    }

    const value = data?.entry?.[0]?.changes?.[0]?.value || {};

    // 1) Insert messages
    if (Array.isArray(value.messages)) {
      for (const m of value.messages) {
        const wa_id = m.from || value?.contacts?.[0]?.wa_id || m.author || '';
        const name = value?.contacts?.[0]?.profile?.name || '';
        const text = m.text?.body || m.button?.text || m.order?.title || m.caption || '';
        const timestamp = m.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000) : new Date();
        const msg_id = m.id || m.message_id || '';
        const meta_msg_id = m.context?.id || m?.meta_msg_id || '';

        const doc = {
          wa_id,
          name,
          direction: 'in',
          timestamp,
          text,
          status: 'delivered',
          msg_id,
          meta_msg_id
        };

        const query = msg_id ? { msg_id } : { wa_id, text, timestamp };
        const saved = await Message.findOneAndUpdate(query, { $setOnInsert: doc }, { upsert: true, new: true });
        console.log(`💬 Inserted message from ${wa_id}: "${text}"`);

        // Increase unread count
        await Chat.findOneAndUpdate(
          { wa_id },
          { $setOnInsert: { name }, $inc: { unreadCount: 1 } },
          { upsert: true }
        );
      }
    }

    // 2) Update statuses
    if (Array.isArray(value.statuses)) {
      for (const s of value.statuses) {
        const id = s.id || s.message_id;
        const meta_msg_id = s.meta_msg_id;
        const status = s.status || s.status_type || 'unknown';
        const query = id ? { msg_id: id } : { meta_msg_id };
        if (!query.msg_id && !query.meta_msg_id) continue;

        const updated = await Message.findOneAndUpdate(query, { status }, { new: true });
        if (updated) {
          console.log(`✅ Updated status to "${status}" for message: ${updated._id}`);
        } else {
          console.warn(`⚠️ Status update: message not found for id/meta_id: ${id || meta_msg_id}`);
        }
      }
    }
  }

  await mongoose.disconnect();
  console.log('🏁 Done processing payloads.');
}

main().catch(err => {
  console.error('❌ Error processing payloads:', err);
  process.exit(1);
});
