import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { Order } from '../../types';

const { TABLE_NAME: TableName } = process.env;

const dynamodbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('event: %j', event);
    const correlationId = uuid();
    const method = 'list-orders.handler';
    const prefix = `${correlationId} (v2) - ${method}`;

    if (!process.env.TABLE_NAME) {
      throw new Error('no table name supplied');
    }

    console.log(`${prefix} - started`);

    if (!TableName) {
      throw new Error('no table name supplied');
    }

    const getParams = {
      TableName,
      IndexName: 'recordTypeIndex',
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: {
        '#type': 'type',
      },
      ExpressionAttributeValues: {
        ':type': 'Orders',
      },
    };

    const { Items } = await ddbDocClient.send(new QueryCommand(getParams));

    const orders: Order[] = !Items
      ? []
      : Items?.map((item) => {
          return {
            id: item.id,
            productId: item.productId,
            quantity: item.quantity,
            storeId: item.storeId,
            created: item.created,
            type: item.type,
          };
        });

    // api gateway needs us to return this body (stringified) and the status code
    return {
      statusCode: 200,
      body: JSON.stringify(orders),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
        'Access-Control-Allow-Credentials': true,
      },
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
