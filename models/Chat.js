const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'Userlogin', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'Userlogin', required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  customName: { type: String, default: '' },
});

module.exports = mongoose.model('Chat', chatSchema);
