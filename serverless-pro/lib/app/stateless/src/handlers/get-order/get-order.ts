import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import { v4 as uuid } from "uuid";

const { TABLE_NAME: TableName } = process.env;
const client = new DynamoDBClient({});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "get-order.handler";
    const prefix = `${correlationId} - ${method}`;

    if (!process.env.TABLE_NAME) {
      throw new Error("no table name supplied");
    }

    console.log(`${prefix} - started`);

    if (!event?.pathParameters || !event.pathParameters.id)
      throw new Error("no id in the path parameters of the event");

    // we get the specific order id from the path parameters in the event from api gateway
    const { id } = event.pathParameters;

    const params = {
      TableName,
      Key: {
        id: { S: id },
      },
    };

    const command = new GetItemCommand(params);

    console.log(`${prefix} - get order: ${id}`);

    const data = await client.send(command);
    const item = data.Item;

    // api gateway needs us to return this body (stringified) and the status code
    return {
      statusCode: 200,
      body: JSON.stringify(item),
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
