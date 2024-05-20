import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  PutCommand,
  PutCommandInput,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { Order, Stores } from '../../types';

const { TABLE_NAME: TableName, BUCKET_NAME: Bucket } = process.env;

const dynamodbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!TableName) {
      throw new Error('no table name supplied');
    }

    if (!Bucket) {
      throw new Error('bucket name not supplied');
    }

    if (!event.body) {
      throw new Error('no order supplied');
    }

    // we take the body (payload) from the event coming through from api gateway
    const item = JSON.parse(event.body);

    // we wont validate the input with this being a basic example only
    const order: Order = {
      id: uuid(),
      type: 'Orders',
      ...item,
    };

    console.log(`${prefix} - order: ${JSON.stringify(order)}`);

    const getParams = {
      TableName,
      IndexName: 'storeIndex',
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: {
        '#type': 'type',
      },
      ExpressionAttributeValues: {
        ':type': 'Stores',
      },
    };

    const { Items: items } = await ddbDocClient.send(
      new QueryCommand(getParams)
    );
    const stores = items as Stores;
    console.log(stores);

    if (!stores.find((item) => item.id === order.storeId)) {
      throw new Error(`${order.storeId} is not found`);
    }

    const params: PutCommandInput = {
      TableName,
      Item: order,
    };

    console.log(`${prefix} - create order: ${JSON.stringify(order)}`);

    const ddbCommand = new PutCommand(params);
    await ddbDocClient.send(ddbCommand);

    // create a text invoice and push to s3 bucket
    const request = {
      Bucket,
      Key: `${order.id}-invoice.txt`,
      Body: JSON.stringify(order),
    };

    const s3Command = new PutObjectCommand(request);
    await s3Client.send(s3Command);

    console.log(`${prefix} - invoice written to ${Bucket}`);

    // api gateway needs us to return this body (stringified) and the status code
    return {
      body: JSON.stringify(order),
      statusCode: 201,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
