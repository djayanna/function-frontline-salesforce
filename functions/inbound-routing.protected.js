const sfdcAuthenticatePath = Runtime.getFunctions()['auth/sfdc-authenticate'].path;
const { sfdcAuthenticate } = require(sfdcAuthenticatePath);
const axios = require('axios');
const base64 = require('base-64');


exports.handler = async function (context, event, callback) {
    const twilioClient = context.getTwilioClient();
    let response = new Twilio.Response();
    response.appendHeader('Content-Type', 'application/json');
    const conversationSid = event.ConversationSid;
    const workerNumber = event['MessagingBinding.ProxyAddress'];
    const sfdcConnectionIdentity = await sfdcAuthenticate(context, null); // this is null due to no user context, default to env. var SF user
    const { connection } = sfdcConnectionIdentity;
    await routeConversation(context, twilioClient, conversationSid, workerNumber, connection);
    return callback(null, response);


};

const routeConversation = async (context, twilioClient, conversationSid,
    workerNumber, sfdcConn) => {
    let workerIdentity = await getContactOwnerByNumber(workerNumber, sfdcConn);
    if (!workerIdentity) { // Customer doesn't have a worker
        // Select a default worker
        workerIdentity = context.DEFAULT_WORKER;
    }
    await routeConversationToWorker(context,twilioClient, conversationSid, workerIdentity);
}

const routeConversationToWorker = async (context, twilioClient, conversationSid, workerIdentity) => {
    // Add worker to the conversation with a customer
    console.log('Conversation SID: ', conversationSid);
 
    const params = new URLSearchParams()
    params.append('Identity', workerIdentity)
        const response = await axios.post(
            `https://conversations.twilio.com/v1/Conversations/${conversationSid}/Participants`,
            params,
            {
                headers: {
                    'X-Twilio-Webhook-Enabled': 'true',
                    Authorization: `Basic ${base64.encode(
                        `${context.ACCOUNT_SID}:${context.AUTH_TOKEN}`
                    )}`
                },
            }
        );
        responseData = response.data;
        console.log('Created inbound chat message SID: ', responseData.sid);

    
}

const getContactOwnerByNumber = async (number, sfdcConn) => {
    console.log('Getting Contact Owner by #: ', number);
    let sfdcRecords = [];
    try {
        // Use below query if looking up Worker identity based on Twilio proxy #
        sfdcRecords = await sfdcConn.sobject("User")
            .find(
                {
                    'MobilePhone': number
                },
                {
                    'Username': 1,
                }
            )
            .sort({ LastModifiedDate: -1 })
            .limit(1)
            .execute();
        /* Use below query if looking up Contact owner by Contact phone #
        sfdcRecords = await sfdcConn.sobject("Contact")
            .find(
                {
                    'MobilePhone': number
                },
                {
                    'Owner.Username': 1,
                }
            )
            .sort({ LastModifiedDate: -1 })
            .limit(1)
            .execute();
        */
        console.log("Fetched # SFDC records for contact owner by #: " + sfdcRecords.length);
        if (sfdcRecords.length === 0) {
            return;
        }
        const sfdcRecord = sfdcRecords[0];
        console.log('Matched to worker: ' + sfdcRecord.Username);
        return sfdcRecord.Username;
    } catch (err) {
        console.error(err);
    }
};