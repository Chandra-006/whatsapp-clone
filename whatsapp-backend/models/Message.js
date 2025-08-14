const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  wa_id: { type: String, index: true },     // contact id (phone)
  name: String,
  direction: { type: String, enum: ['in', 'out'], required: true },
  timestamp: { type: Date, index: true },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed', 'unknown'], default: 'sent' },

  // NEW
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  text: String,
  mediaUrl: String,      // e.g. /uploads/abc.jpg
  mediaMime: String,     // e.g. image/jpeg
  caption: String,       // optional caption for images
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },

  // existing ids from provider
  msg_id: { type: String, index: true, sparse: true },
  meta_msg_id: { type: String, index: true, sparse: true }
}, { versionKey: false });

module.exports = mongoose.model('Message', MessageSchema, 'processed_messages');
