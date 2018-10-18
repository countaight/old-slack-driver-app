const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
	user_id: String,
	apiToken: String
});

const User = mongoose.model('user', UserSchema);

module.exports = User;