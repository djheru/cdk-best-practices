import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  CdkCustomResourceEvent,
  CdkCustomResourceHandler,
  CdkCustomResourceResponse,
} from 'aws-lambda';
import { v4 as uuid } from 'uuid';

const dynamodbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const physicalResourceId = 'OrdersConfigData';

async function seedData(tableName: string): Promise<void> {
  const params = {
    RequestItems: {
      [tableName]: [
        {
          PutRequest: {
            Item: {
              id: '59b8a675-9bb7-46c7-955d-2566edfba8ea',
              storeCode: 'NEW',
              storeName: 'Newcastle',
              type: 'Stores',
            },
          },
        },
        {
          PutRequest: {
            Item: {
              id: '4e02e8f2-c0fe-493e-b259-1047254ad969',
              storeCode: 'LON',
              storeName: 'London',
              type: 'Stores',
            },
          },
        },
        {
          PutRequest: {
            Item: {
              id: 'f5de2a0a-5a1d-4842-b38d-34e0fe420d33',
              storeCode: 'MAN',
              storeName: 'Manchester',
              type: 'Stores',
            },
          },
        },
      ],
    },
  };

  try {
    const { UnprocessedItems = {} } = await ddbDocClient.send(
      new BatchWriteCommand(params)
    );

    if (Object.keys(UnprocessedItems).length > 0) {
      throw new Error(
        `The following were unprocessed: ${JSON.stringify(UnprocessedItems)}`
      );
    }
  } catch (error) {
    console.error('Error seeding data:', error);
    throw error; // Rethrow the error if needed
  }
}

export const handler: CdkCustomResourceHandler = async (
  event: CdkCustomResourceEvent
): Promise<CdkCustomResourceResponse> => {
  try {
    const correlationId = uuid();
    const method = 'populate-orders.handler';
    const prefix = `${correlationId} - ${method}`;

    let response: CdkCustomResourceResponse;

    console.log(`${prefix} - started`);
    console.log(`${prefix} - event request: ${JSON.stringify(event)}`);

    const { ResourceProperties } = event;
    const { tableName } = ResourceProperties;

    if (!tableName) throw new Error(`table name not supplied`);

    switch (event.RequestType) {
      case 'Create':
        await seedData(tableName); // seed the data

        response = {
          Status: 'SUCCESS',
          Reason: '',
          LogicalResourceId: event.LogicalResourceId,
          PhysicalResourceId: physicalResourceId,
          RequestId: event.RequestId,
          StackId: event.StackId,
        };
        break;
      case 'Update':
        await seedData(tableName); // reseed the data
        response = {
          Status: 'SUCCESS',
          Reason: '',
          LogicalResourceId: event.LogicalResourceId,
          PhysicalResourceId: physicalResourceId,
          RequestId: event.RequestId,
          StackId: event.StackId,
        };
        break;
      case 'Delete':
        // we do nothing as the table will be removed
        response = {
          Status: 'SUCCESS',
          Reason: '',
          LogicalResourceId: event.LogicalResourceId,
          PhysicalResourceId: physicalResourceId,
          RequestId: event.RequestId,
          StackId: event.StackId,
        };
        break;
      default:
        throw new Error(`${prefix} - event request type not found`);
    }

    console.log(`${prefix} - response: ${JSON.stringify(response)}`);

    return response;
  } catch (error) {
    console.log(error);
    return {
      Status: 'FAILED',
      Reason: JSON.stringify(error),
      LogicalResourceId: event.LogicalResourceId,
      PhysicalResourceId: physicalResourceId,
      RequestId: event.RequestId,
      StackId: event.StackId,
    };
  }
};
