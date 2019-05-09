# README

### Purpose

This slack app allowed communication between the drivers and dispatchers using SMS on the drivers' side and Slack messages/replies on the dispatchers' side.

### Process

I created a Node server that uses a mongoDB in order to hold the tokens required to log in through Slack as the user and eventually it was meant to hold conversations for backup purposes or perhaps machine learning.

The database did, however, hold the conversation id of the slack message thread in order to determine if a new message needed to be created or if the SMS message needed to be appended as a reply to a thread to an existing conversation.

SMS communcation was made possible by Twilio.

### Observations

I firmly believe in having one source of truth when it comes to information. The goal was to have Slack be just that, it was a familiar platform type, as is sending text messages, and my plan was to incorporate whatever was easily adoptable.

Having a diverse way of interacting with an app is important in the trucking industry because of the large generational diversity that exists. I believe it's important that an app should easily adopt to users, while simultaneously training them in certain aspects in order to establish a standard.
