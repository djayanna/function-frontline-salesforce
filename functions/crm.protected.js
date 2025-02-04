const sfdcAuthenticatePath = Runtime.getFunctions()['auth/sfdc-authenticate'].path;
const { sfdcAuthenticate } = require(sfdcAuthenticatePath);

exports.handler = async function (context, event, callback) {
  let response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');
  try {
    console.log(event);
    console.log('Frontline user identity: ' + event.Worker);
    const sfdcConnectionIdentity = await sfdcAuthenticate(context, event.Worker);
    console.log('Connected as SF user:' + sfdcConnectionIdentity);
    const { connection , identityInfo} = sfdcConnectionIdentity;
    
    console.log('Connected as SF user:' + identityInfo.username);
    switch (event.Location) {
      case 'GetCustomerDetailsByCustomerId': {
        response.setBody(
          await getCustomerDetailsByCustomerIdCallback(
            event.CustomerId,
            connection)
        );
        break;
      }
      case 'GetCustomersList': {
        if (event.Query && event.Query.length > 1) {
          console.log("Getcustomer");
          response.setBody(
            await getCustomersSearch(
              event.Worker,
              event.Query,
              connection,
              event.PageSize,
              event.NextPageToken
            )
          );
        } else {
          response.setBody(
            await getCustomersList(
              event.Worker,
              connection,
              event.PageSize,
              event.NextPageToken
            )
          );
        }
        break;
      }
      default: {
        console.log('Unknown Location: ', event.Location);
        res.setStatusCode(422);
      }
    }
    return callback(null, response);

  } catch (e) {
    console.error(e);
    response.setStatusCode(500);
    return callback(null, response);
  }
};

const getCustomerDetailsByCustomerIdCallback = async (contactId, connection) => {
  console.log('Getting Customer details: ', contactId);
  let sfdcRecords = [];
  try {
    sfdcRecords = await connection.sobject("Account")
      .find(
        {
          'Id': contactId
        },
        {
          Id: 1,
          Name: 1,        
          Phone: 1,
        }
      )
      .limit(1)
      .execute();
    console.log("Fetched # SFDC records for customer details by ID: " + sfdcRecords.length);
  } catch (err) {
    console.error(err);
  }
  const sfdcRecord = sfdcRecords[0];

  const accountName = (
    sfdcRecord.Account ? sfdcRecord.Account.Name : 'Unknown Company'
  );

  return {
    objects: {
      customer: {
        customer_id: sfdcRecord.Id,
        display_name: sfdcRecord.Name,
        channels: [
          {
            type: 'sms',
            value: sfdcRecord.Phone
          },
          {
            type: 'whatsapp',
            value: `whatsapp:${sfdcRecord.Phone}`
          },
          {
            type: 'email',
            value: sfdcRecord.Email
          }
        ],
        details: {
          title: "Information",
          content: `${accountName} - ${sfdcRecord.Title}`
        }
      }
    }
  }
};

const getCustomersList = async (workerIdentity, connection, pageSize, offset) => {
  let sfdcRecords = [];
  try {
    sfdcRecords = await connection.sobject("Account")
    .find(
      {
        
      },
      {
        Id: 1,
        Name: 1,
      }
    )
    .sort({ Name: 1 })
    .limit(pageSize)
    .skip(offset ? offset : 0)
    .execute();
    console.log("Fetched # SFDC records for customers list: " + sfdcRecords);
  } catch (err) {
    console.error(err);
  }

  const list = sfdcRecords.map(contact => ({
    display_name: contact.Name,
    customer_id: contact.Id
  }));

  return {
    objects:
    {
      customers: list,
      searchable: true,
      next_page_token: parseInt(pageSize) + (offset ? parseInt(offset) : 0)
    }
  };
  //var records = [];
// await connection.query("SELECT Id, Name FROM Account", function(err, result) {
//   if (err) { return console.error("error account", err); }
//   console.log("total : " + result.totalSize);
//   console.log("fetched : " + result.records.length);
//   console.log("done ? : " + result.done);
//   if (!result.done) {
//     // you can use the locator to fetch next records set.
//     // Connection#queryMore()
//     console.log("next records URL : " + result.nextRecordsUrl);
//   }
// });

//sfdcRecords =  await connection.sobject("Account");


};

const getCustomersSearch = async (workerIdentity, query, connection, pageSize, offset) => {
  console.log('A search query was sent:', JSON.stringify(query));
  let sfdcRecords = [];
  try {
    sfdcRecords = await connection.search(
      `FIND {${query}*} IN NAME FIELDS RETURNING Contact(Id, Name WHERE Owner.Username = '${workerIdentity}' LIMIT ${pageSize} OFFSET ${offset ? parseInt(offset) : 0})`
    );
    console.log("Fetched # SFDC records for customers search: " + sfdcRecords.searchRecords.length);
  } catch (err) {
    console.error(err);
  }

  const list = sfdcRecords.searchRecords.map(contact => ({
    display_name: contact.Name,
    customer_id: contact.Id
  }));

  return {
    objects:
    {
      customers: list,
      searchable: true,
      next_page_token: parseInt(pageSize) + (offset ? parseInt(offset) : 0)
    }
  };
};