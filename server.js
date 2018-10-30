const Airtable = require('airtable');
const bodyParser = require('body-parser');
const { createEventAdapter } = require('@slack/events-api');
const express = require('express');
const mongoose = require('mongoose');
const qs = require('querystring');
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

if (process.env.NODE_ENV !== 'production') {
	mongoose.connect('mongodb://localhost/slack_users', { useNewUrlParser: true });
} else {
	mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true });
}

const accountSid = process.env.TWILIO_ACCOUNTSID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = new twilio(accountSid, authToken);

const unauthWeb = new WebClient();

app.use('/events', slackEvents.expressMiddleware());

app.use(bodyParser.urlencoded({ extended: false }));

slackEvents.on('message', (message, body) => {
	if (message.thread_ts && message.user) {
		const query = Conversation.findOne({ thread_ts: message.thread_ts });

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
			redirect_uri: 'http://slack.noeltrans.com/auth',
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
		let name;
		if (records[0]) {
			name = records[0].fields.DriverName || records[0].fields.LessorName;
		} else {
			name = 'Unknown Name';
		}

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
					username: name,
					thread_ts: convo.thread_ts,
					attachments: JSON.stringify([
						{
							"fallback": "SMS received through Twilio",
							"color": "#4286F4",
							"pretext": "SMS received",
							"title": "SMS from Driver",
							"fields": [
								{
									"title": "Message",
									"value": req.body.Body,
									"short": false
								}
							]
						}
					]),
					image_url:req.body.MediaUrl0 || ''
				})
				.then(response => console.log(response))
				.catch(console.error);
			}
		})
	}, function done(err) {
		if (err) { console.error(err); return; }
	});

	res.writeHead(204);
	res.end();
});

app.post('/smssend', function(req, res) {
	console.log(req.body);
	const number = req.body.text.split(" ")[0];
	const msgBody = req.body.text.split(" ").slice(1).join(' ');

	base('Driver').select({
		filterByFormula: `{DriverFirstName} = '${number}'`,
		view: 'Grid view'
	}).eachPage(function page(records, fetchNextPage) {
		if (records.length === 0) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.write(JSON.stringify({
				response_type: 'ephemeral',
				text: `No driver by the name of *${number}* was found, make sure you spelled it correctly and it is in the Airtable.`
			}));
			res.end();
			return;
		}

		let foundRecords;

		if (records.length > 1) {
			foundRecords = records.map(record => {
				return {
					text: `Did you mean, ${record.fields.DriverName}`,
					fallback: `Couldn't find a record with that name.`,
					callback_id: 'choose_driver',
					actions: [
						{
							name: 'driver',
							value: record.fields.MobileNo,
							text: record.fields.MobileNo,
							type: 'button'
						}
					]
				};
			});
		} else {
			foundRecords = [
				{
					text: `Did you mean, ${records[0].fields.DriverName}`,
					fallback: "Couldn't find a record with that name.",
					callback_id: 'choose_driver',
					actions: [
						{
							name: 'driver',
							value: records[0].fields.MobileNo,
							text: records[0].fields.MobileNo,
							type: 'button'
						}
					]
				}
			];
		}

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.write(JSON.stringify({
			response_type: 'ephemeral',
			text: `Send SMS to ${number}`,
			attachments: foundRecords
		}));
		res.end();
	}, function done(err) {
		if (err) { console.error(err); return; }
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

	if (payload.callback_id === 'choose_driver') {
		const mobile_no = formatPhone(payload.actions[0].value);

		client.messages.create({
			body: 'Dispatch would like to get a hold of you, please reply to this message.',
			to: mobile_no,
			from: process.env.TWILIO_NO
		})
		.then(message => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.write(JSON.stringify({
				response_type: 'ephemeral',
				text: 'SMS Sent!',
				replace_original: true,
				delete_original: true
			}));
			res.end();
		});
	} else {
		console.log('This only works with Driver Messages');
	}
});

function formatPhone(number) {
	return '+1' + number.match(/\((\d{3})\) (\d{3})-(\d{4})/).slice(1,4).join('');
}

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