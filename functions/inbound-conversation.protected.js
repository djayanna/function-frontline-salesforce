const sfdcAuthenticatePath =
  Runtime.getFunctions()["auth/sfdc-authenticate"].path;
const { sfdcAuthenticate } = require(sfdcAuthenticatePath);

exports.handler = async function (context, event, callback) {
  const twilioClient = context.getTwilioClient();
  let response = new Twilio.Response();
  response.appendHeader("Content-Type", "application/json");
  const customerNumber =
    event["MessagingBinding.Address"] &&
    event["MessagingBinding.Address"].startsWith("whatsapp:")
      ? event["MessagingBinding.Address"].substring(9)
      : event["MessagingBinding.Address"];

  switch (event.EventType) {
    case "onConversationAdd": {
      const isIncomingConversation = !!customerNumber;
      //console.log(event);
      if (isIncomingConversation) {
        const sfdcConnectionIdentity = await sfdcAuthenticate(context, null); // this is null due to no user context, default to env. var SF user
        const { connection } = sfdcConnectionIdentity;
        const customerDetails =
          (await getCustomerByNumber(customerNumber, connection)) || {};
        const conversationProperties = {
          friendly_name: customerDetails.display_name || customerNumber,
        };
        response.setBody(conversationProperties);
      }
      break;
    }
    case "onParticipantAdded": {
      const conversationSid = event.ConversationSid;
      const participantSid = event.ParticipantSid;
      const isCustomer = customerNumber && !event.Identity;
      const sfdcConnectionIdentity = await sfdcAuthenticate(context, null);
      const { connection } = sfdcConnectionIdentity;
      if (isCustomer) {
        const customerParticipant = await twilioClient.conversations
          .conversations(conversationSid)
          .participants.get(participantSid)
          .fetch();

        const customerDetails =
          (await getCustomerByNumber(customerNumber, connection)) || {};
        await setCustomerParticipantProperties(
          customerParticipant,
          customerDetails
        );

        // Writeback to SF
        sfdcParticipant = await connection
          .sobject("Frontline_Conversation_Participant_Custo__c")
          .create({
            AccountSid__c: event.AccountSid,
            ConversationSid__c: event.ConversationSid,
            CustomerId__c: customerDetails.customer_id,
            CustomerPhone__c: event["MessagingBinding.Address"],
            ProxyPhone__c: event["MessagingBinding.ProxyAddress"],
            DateCreated__c: event.DateCreated,
            DateUpdated__c: event.DateCreated,
            ClientIdentity__c: event.ClientIdentity ? event.ClientIdentity : "",
            RoleSid__c: event.RoleSid,
            ParticipantSid__c: event.ParticipantSid,
            Source__c: event.Source,
          });

        console.log(`New Participant Customer : ${sfdcParticipant.id}`);
      } else {
        sfdcParticipant = await connection
          .sobject("Frontline_Conversation_Participant_User__c")
          .create({
            AccountSid__c: event.AccountSid,
            ConversationSid__c: event.ConversationSid,
            UserName__c: event.Identity,
            DateCreated__c: event.DateCreated,
            DateUpdated__c: event.DateCreated,
            ClientIdentity__c: event.ClientIdentity ? event.ClientIdentity : "",
            RoleSid__c: event.RoleSid,
            ParticipantSid__c: event.ParticipantSid,
            Source__c: event.Source,
          });

        console.log(`New Participant User : ${sfdcParticipant.id}`);
      }

      break;
    }
    case "onConversationAdded": {
      const sfdcConnectionIdentity = await sfdcAuthenticate(context, null);
      const { connection } = sfdcConnectionIdentity;

      sfdcConversation = await connection
        .sobject("Frontline_Conversation__c")
        .create({
          AccountSid__c: event.AccountSid,
          Attributes__c: event.Attributes,
          ChatServiceSid__c: event.ChatServiceSid,
          ConversationSid__c: event.ConversationSid,
          DateCreated__c: event.DateCreated,
          FriendlyName__c: event.FriendlyName,
          MessagingServiceSid__c: event.MessagingServiceSid,
          Source__c: event.Source,
          State__c: event.State,
        });

      console.log(`New Conversation: ${sfdcConversation.id}`);

      break;
    }
    case "onMessageAdded": {
      const sfdcConnectionIdentity = await sfdcAuthenticate(context, null);
      const { connection } = sfdcConnectionIdentity;
      console.log(event);
      sfdcMessage = await connection
        .sobject("Frontline_Conversation_Message_Log__c")
        .create({
          AccountSid__c: event.AccountSid,
          Attributes__c: event.Attributes,
          Author__c: event.Author__c,
          ConversationSid__c: event.ConversationSid,
          DateCreated__c: event.DateCreated,
          Body__c: event.Body,
          Index__c: event.Index,
          MessageSid__c: event.MessageSid,
          Source__c: event.Source,
        });

      console.log(`New Message: ${sfdcMessage.id}`);

      break;
    }

    default: {
      console.log("Unknown event type: ", event.EventType);
      console.log(event);
      response.setStatusCode(200);
    }
  }
  return callback(null, response);
};

const getCustomerByNumber = async (number, sfdcConn) => {
  console.log("Getting Customer details by #: ", number);
  let sfdcRecords = [];
  try {
    sfdcRecords = await sfdcConn
      .sobject("Account")
      .find(
        {
          Phone: number,
        },
        {
          Id: 1,
          Name: 1,
        }
      )
      .sort({ LastModifiedDate: -1 })
      .limit(1)
      .execute();
    console.log(
      "Fetched # SFDC records for contact by #: " + sfdcRecords.length
    );
    if (sfdcRecords.length === 0) {
      return;
    }
    const sfdcRecord = sfdcRecords[0];
    return {
      display_name: sfdcRecord.Name,
      customer_id: sfdcRecord.Id,
    };
  } catch (err) {
    console.error(err);
  }
};

const setCustomerParticipantProperties = async (
  customerParticipant,
  customerDetails
) => {
  const participantAttributes = JSON.parse(customerParticipant.attributes);
  console.log(participantAttributes);
  const customerProperties = {
    attributes: JSON.stringify({
      ...participantAttributes,
      customer_id:
        participantAttributes.customer_id || customerDetails.customer_id,
      display_name:
        participantAttributes.display_name || customerDetails.display_name,
    }),
  };

  // If there is difference, update participant
  if (customerParticipant.attributes !== customerProperties.attributes) {
    // Update attributes of customer to include customer_id
    await customerParticipant
      .update(customerProperties)
      .catch((e) => console.log("Update customer participant failed: ", e));
  }
};
