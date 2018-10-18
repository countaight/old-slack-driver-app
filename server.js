const Airtable = require('airtable');
const bodyParser = require('body-parser');
const { createEventAdapter } = require('@slack/events-api');
const express = require('express');
const mongoose = require('mongoose');
const qs = require('querystring');
const request = require('request');
const { WebClient } = require('@slack/client');
const twilio = require('twilio');
require('dotenv').config();

const User = require('./models/user');
const Conversation = require('./models/conversation');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE);

const app = express();

const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
	includeBody: true
});

mongoose.Promise = global.Promise;

console.log(process.env.NODE_ENV);

if (process.env.NODE_ENV !== 'production') {
	mongoose.connect('mongodb://localhost/slack_users', { useNewUrlParser: true });
}

const accountSid = process.env.TWILIO_ACCOUNTSID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = new twilio(accountSid, authToken);

const unauthWeb = new WebClient();

app.use('/events', slackEvents.expressMiddleware());

app.use(bodyParser.urlencoded({ extended: false }));

slackEvents.on('message', (message, body) => {
	if (message.thread_ts && message.user) {
		const query = Conversation.findOne({ thread_ts: message.thread_ts })

		query.exec(function (err, convo) {
			if (err) { console.error(err); return; }

			if (convo) {
				client.messages.create({
					body: message.text,
					to: convo.mobile_no,
					from: process.env.TWILIO_NO
				})
				.then(message => {
					console.log(message);
				})
				.catch(console.error);
			}

		});
	} else {
		console.log('Not a reply to a SMS message:', message);
	}
})

app.get('/', function (req, res) {
	res.redirect('https://slack.com/oauth/authorize?'
		+qs.stringify({
			client_id: process.env.SLACK_CLIENT_ID,
			team: process.env.SLACK_TEAM,
			redirect_uri: 'https://slack.noeltrans.com/auth',
			scope: 'incoming-webhook chat:write:user'
		})
	);
});

app.post('/sms', function (req, res) {
	const bot = new WebClient(process.env.SLACK_BOT_TOKEN);

	const query = Conversation.findOne({ mobile_no: req.body.From });

	base('Driver').select({
		filterByFormula: filterByPhone(req.body.From),
		view: 'Grid view'
	}).eachPage(function page(records, fetchNextPage) {
		const name = records[0].fields.DriverName || records[0].fields.LessorName;

		query.exec(function (err, convo) {
			if (!convo) {
				bot.chat.postMessage({
					channel: '#dispatch',
					username: name,
					attachments: JSON.stringify([
						{
							"fallback": "SMS received through Twilio",
							"color": "#4286F4",
							"pretext": req.body.From,
							"author_name": name || 'Unknown Number',
							"title": "SMS from Driver",
							"fields": [
								{
									"title": "Message",
									"value": req.body.Body,
									"short": false
								}
							]
						}
					])
				})
				.then(response => {
					const newConvo = new Conversation({ mobile_no: req.body.From, thread_ts: response.ts });
					newConvo.save();
				})
				.catch(console.error);
			} else {
				bot.chat.postMessage({
					channel: '#dispatch',
					username: name || 'Unknown Number',
					thread_ts: convo.thread_ts,
					attachments: JSON.stringify([
						{
							"fallback": "SMS received through Twilio",
							"color": "#4286F4",
							"pretext": "SMS received",
							"author_name": name || "Unknown Number",
							"title": "SMS from Driver",
							"fields": [
								{
									"title": "Message",
									"value": req.body.Body,
									"short": false
								}
							]
						}
					])
				})
				.then(response => console.log(response))
				.catch(console.error);
			}
		})
	}, function done(err) {
		if (err) { console.error(err); return; }
	});

	res.writeHead(200);
	res.end();
});

app.post('/smssend', function(req, res) {
	const number = req.body.text.split(" ")[0];
	const msgBody = req.body.text.split(" ").slice(1).join(" ");

	client.messages.create({
		body: msgBody,
		to: number,
		from: process.env.TWILIO_NO
	})
	.then(message => {
		res.writeHead(200, {
			'Content-Type': 'application/json'
		});
		res.write(JSON.stringify({
			response_type: 'in_channel',
			text: 'SMS Sent'
		}));
		res.end();
	});
});

app.get('/auth',  function(req, res) {
	unauthWeb.oauth.access({
		client_id: process.env.SLACK_CLIENT_ID,
		client_secret: process.env.SLACK_CLIENT_SECRET,
		code: req.query.code
	})
	.then(response => {
		const user = new User({ user_id:  response.user_id, apiToken: response.access_token });
		user.save();
		res.writeHead(200);
		res.end();
	});
});

app.post('/reply', function(req, res) {
	const payload = JSON.parse(req.body.payload);
	const slackMessage = payload.message;

	const query = User.findOne({ user_id: payload.user.id });

	query.exec(function (err, user) {
		if (err) { console.error(err); return; }

		const web = new WebClient(user.apiToken);

		if (slackMessage && payload.callback_id === 'reply_sms') {
			console.log(slackMessage);
			web.dialog.open({
				trigger_id: payload.trigger_id,
				dialog: JSON.stringify({
					callback_id: 'reply_sms',
					title: `${slackMessage.attachments[0].author_name}`,
					submit_label: 'Reply',
					notify_on_cancel: false,
					state: payload.message_ts + ' ' + slackMessage.attachments[0].pretext,
					elements: [
						{
							type: 'textarea',
							label: 'Reply Message',
							name: 'message_body',
							placeholder: 'Type your message here.'
						}
					]
				})
			})
			.then(response => {
				res.writeHead(200);
				res.end();
			})
			.catch(err => console.log(err.data));
		} else if (payload.type === 'dialog_submission') {
			client.messages.create({
				body: payload.submission.message_body,
				to: payload.state.split(' ')[1],
				from: process.env.TWILIO_NO
			})
			.then(message => {
				web.chat.postMessage({
					channel: '#dispatch',
					as_user: true,
					thread_ts: payload.state.split(' ')[0],
					attachments: JSON.stringify([
										{
											"fallback": "SMS Replied Successful!",
											"color": "#006838",
											"pretext": "SMS Reply",
											"title": "SMS sent from Slack",
											"fields": [
												{
													"title": "Message",
													"value": payload.submission.message_body,
													"short": false
												}
											]
										}
					    		])
				})
				.then(response => console.log('Chat message posted: ', response))
				.catch(console.error)
			});

			res.writeHead(200);
			res.end();
		} else {
			console.log('This only works with Driver Messages');
		}
	}); //query.exec
});

function filterByPhone(phoneNo) {
	const short = phoneNo.slice(2).split('');
	const formattedNo = `(${short[0]}${short[1]}${short[2]}) ${short[3]}${short[4]}${short[5]}-${short[6]}${short[7]}${short[8]}${short[9]}`;
	return `{MobileNo} = '${formattedNo}'`;
}

const server = app.listen(process.env.PORT, function () {
	const host = server.address().address;
	const port = server.address().port;

	console.log("Example app listening at http://%s:%s", host, port);
});