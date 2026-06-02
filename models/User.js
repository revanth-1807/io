const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  Name: { type: String, required: true },
  Email: { type: String, required: true, unique: true },
  Password: { type: String, required: true },
verified: { type: Boolean, default: false },
})

module.exports = mongoose.model('Userlogin', userSchema);
