const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  wa_id: { type: String, unique: true, index: true },
  name: String,
  unreadCount: { type: Number, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model('Chat', ChatSchema);
