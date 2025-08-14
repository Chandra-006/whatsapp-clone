const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  wa_id: { type: String, unique: true, index: true }, // phone number as id
  displayName: String,
  note: String,
  avatarUrl: String // optional, could be a local upload later
}, { versionKey: false });

module.exports = mongoose.model('Contact', ContactSchema);
