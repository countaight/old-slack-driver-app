const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ConversationSchema = new Schema({
	mobile_no: String,
	thread_ts: String
});

const Conversation = mongoose.model('conversation', ConversationSchema);

module.exports = Conversation;