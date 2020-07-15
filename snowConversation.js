
var config = require('./config.json');
var botId = Object.keys(config.credentials);
var botName = "SNOW Live agent";
var sdk = require("./lib/sdk");

const http = require("https");
var request = require("request");
var rp = require('request-promise');
var fs = require("fs");
var path = require("path");
var _ = require('lodash');

var snowAPI = require('./snowAPIs.js');
var AttachingFile = require("./Attachment.js");
var mapUserIdVsData = {},
    mapGroupIdVsUserId = {};


const DownloadImage = (url, filename) => {
    return new Promise((resolve, reject) => {
        console.log("Before executing download")
        var options = {
            'encoding': null,
            'url': url
        }
        request(options, (err, res, data) => {
            if (err) {
                reject(err);
            }
            fs.writeFileSync(filename, data)
            resolve(data)
            console.log(data)

        })

        // console.log("Downloaded")
    })

}

module.exports = {
    botId: botId,
    botName: botName,
    mapUserIdVsData: mapUserIdVsData,
    on_user_message: function(requestId, data, callback) {

        if (!data.agent_transfer) {
            //Forward the message to bot
            return sdk.sendBotMessage(data, callback);
        } else {
            var visitorId = _.get(data, 'channel.channelInfos.from');
            if (!visitorId) visitorId = _.get(data, 'channel.from');
            var group;
            console.log("Message in agent transfer mode. mapGroupIdVsUserId[", visitorId, "] = ", mapGroupIdVsUserId[visitorId]);
            if (mapGroupIdVsUserId[visitorId])
                group = mapGroupIdVsUserId[visitorId];

            if (data && data.agent_transfer && (data.message === "####" || data.message === "quit" || data.message === "stop chat")) {
                data.message = "Ok, the conversation with the Agent has been stopped. You can continue chatting with the bot.";
                sdk.sendUserMessage(data, callback);
                sdk.clearAgentSession(data);
                data.message = "Please end the chat. Thanks!";
                mapGroupIdVsUserId[visitorId] = undefined;
                mapUserIdVsData[visitorId] = undefined;
            }
            if (!group) {
                data.message = "Please wait, while we connect you with service agent."
                return sdk.sendUserMessage(data, callback);
            }

            var message_data = {
                "message": data.message,
                "group": group,
                "reflected_field": "comments"
            }

            return snowAPI.SendMessageToLiveAgent(message_data, group)
                .catch(function(e) {
                    console.error("Error in sending messages to snow : ", e.message);
                    sdk.clearAgentSession(data);
                    mapGroupIdVsUserId[visitorId] = undefined;
                    mapUserIdVsData[visitorId] = undefined;
                    return sdk.sendBotMessage(data, callback);
                });
        }
    },
    on_bot_message: function(requestId, data, callback) {
        //Sends back the message to user
        return sdk.sendUserMessage(data, callback);
    },
    on_agent_transfer: function(requestId, data, callback) {
        var visitorId = _.get(data, 'channel.channelInfos.from');
        if (!visitorId) visitorId = _.get(data, 'channel.from');
        mapUserIdVsData[visitorId] = data;

        var userContext = data.context.session.UserContext,
            identity = "";
        if (userContext) {
            identity = (userContext.firstName) ? userContext.firstName + " " : "";
            identity += (userContext.lastName) ? userContext.lastName : "";
            identity += (identity.trim() === "" && userContext.emailId) ? userContext.emailId : "";
            if (identity.trim() === "") identity = "undefined";
        }

     var context  = data.context;
        var historyTags = (context.historicTags && context.historicTags[0] && context.historicTags[0].tags) ? context.historicTags[0].tags.join("\n") : "";
                    console.log(historyTags);
                    var lastMessage = _.get(data, 'context.session.BotUserSession.lastMessage.messagePayload.message.body', "");

        var welcomeMessage = {
            "message": "You are speaking to [" + identity + "], authenticated by WebSSO.\n" +
                "Link for User Chat History with the bot: " +
                config.app.url + config.app.apiPrefix + "/history/index.html?visitorId=" + visitorId+ "\nHistory tags : " + historyTags + "\nLast message : " + lastMessage
        }



  
        snowAPI.CreateChatQueue(welcomeMessage).then(function(chatQueueEntryResponse) {
            mapGroupIdVsUserId[visitorId] = chatQueueEntryResponse.result.group;
            console.log("Created queue. mapGroupIdVsUserId[", visitorId, "] = ", mapGroupIdVsUserId[visitorId]);
            data.message = "Thank you for contacting support. Someone will be with you shortly to assist you";
            sdk.sendUserMessage(data, callback);
            return callback(null, data);
        }).catch(function(e) {
            console.error("Error in crearting the chat queue : ", e.stack);
            sdk.clearAgentSession(data);
        })
    },

	on_webhook: function (requestId, data, componentName, callback) {
        var context = data["context"];
         
        if(componentName==="BotkitConnection")
        {
            var instance="dev80567";
            var Authorization="Basic YWRtaW46a2E2TXRWOGN3QkhZ";
            var table_sys_id=context.sys_id;
	        var FileName = context.entities.ImageAttachment[0].fileName;
            var FileUrl = (context.entities.ImageAttachment[0].url.fileUrl).trim();

            sdk.saveData(requestId, data).then(function () {
                callback(null, new sdk.AsyncResponse());
                console.log("Saved data ");
            }).then(function () {
                return DownloadImage(FileUrl, FileName)
            }).then(function (respp) {
            instance_url='https://'+instance+".service-now.com/api/now/attachment/upload";
            console.log("downladed : ", FileUrl, FileName);
            var options =
            {
                'method': 'POST',
                'url': instance_url,
                'headers': {
                    'Accept': 'application/json',
                    'Content-Type': 'multipart/form-data',
                    'Authorization': Authorization//'Basic YWRtaW46a2E2TXRWOGN3QkhZ'
                },
                formData: {
                    'table_name': 'incident',
                    'table_sys_id': table_sys_id,//'1ef291bf4f2733005728f3117310c757',
                    'uploadFile': {
                        'value': fs.createReadStream(FileName),
                        'options': {
                            'filename': FileName,
                            'contentType': null
                        }
                    }
                }
            }
            request(options, function (error, response) {
                if (error)
                throw new Error(error);
            else {
                data.context.BotKitResponse = response.statusCode;
                console.log(response.body);
            }
            sdk.respondToHook(data);

        })
    }).catch(function (err) {
        data.context.BotKitResponse = "Error occured";
        sdk.respondToHook(data);
    })
        }
    },

    on_event: function(requestId, data, callback) {
        console.log("on_event -->  Event : ", data.event);

        if (data.context.botid === 'st-aa0a9d12-4ffb-553c-8b1c-eaa98d0b47d7') { //only for British Gas bot
            if (data.event && data.event.completedTaskName === 'collectfeedback') {
                console.log("Ignoring collectfeedback dialog, ");
                return; //simply return;
            }
            var overrideMessagePayload = {
                body: JSON.stringify({
                    "type": "template",
                    "payload": {
                        "template_type": "quick_replies",
                        "text": "Share your feed back",
                        "quick_replies": [{
                            "content_type": "text",
                            "title": "👍",
                            "payload": "CollectFeedBack $#$  👍"
                        }, {
                            "content_type": "text",
                            "title": "👎",
                            "payload": "CollectFeedBack $#$  👎"
                        }]
                    }
                }),
                isTemplate: true
            };
            data.overrideMessagePayload = overrideMessagePayload;
            return sdk.sendUserMessage(data);
        }
        return callback(null, data);
    },
    on_alert: function(requestId, data, callback) {
        console.log("on_alert -->  : ", data, data.message);
        return sdk.sendAlertMessage(data, callback);
    },
    //custom route in which messages from snow are received
    sendMessagetoBotUser: function(req, res) {
        var reqBody = req.body;
        console.log("Receivced hit from service now : ", reqBody.formatted_message);
        var groupId = (req.body && req.body.group) ? req.body.group : undefined;
        var userId = Object.keys(mapGroupIdVsUserId).find(key => mapGroupIdVsUserId[key] === groupId);
        if (userId) {
            var data = mapUserIdVsData[userId];
            console.log("Group ID - ", groupId, "\nUser ID - ", userId);

            data.message = reqBody.formatted_message;
            if (data.message.indexOf("has closed the support session") > -1) {
                mapGroupIdVsUserId[userId] = undefined;
                mapUserIdVsData[userId] = undefined;
                sdk.clearAgentSession(data);
            }
            if (data.message.trim().indexOf("Thank you for contacting support.  I am looking into your question now and will be with you shortly") > -1)
                data.message = "Hi, I am Abel Tuter. Your customer support executive. How can I help you today?"

            console.log("@@@: ", data.message.trim().indexOf("Thank you for contacting support.  I am looking into your question now and will be with you shortly"));
            sdk.sendUserMessage(data, function(err, done) {
                console.log("sendUserMessage", data.message);
            }).catch(function(e) {
                console.log(e);
                sdk.clearAgentSession(data);
                mapGroupIdVsUserId[userId] = undefined;
                mapUserIdVsData[userId] = undefined;
            });
        }
        res.send("Am done");
    },
    gethistory: function(req, res) {
        var userId = req.query.userId;
        var data = mapUserIdVsData[userId];

        if (data) {
            data.limit = 20; //max i suppose
            return sdk.getMessages(data, function(err, resp) {
                if (err) {
                    res.status(400);
                    return res.json(err);
                }
                var messages = resp.messages;
                res.status(200);
                return res.json(messages);
            });
        } else {
            var error = {
                msg: "Invalid user",
                code: 401
            };
            res.status(401);
            return res.json(error);
        }
    }
};