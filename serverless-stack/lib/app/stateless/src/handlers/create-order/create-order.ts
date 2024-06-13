import { Logger } from '@aws-lambda-powertools/logger';
import { LogLevel } from '@aws-lambda-powertools/logger/lib/cjs/types/Log';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  PutCommand,
  PutCommandInput,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { config } from '../../config';
import { Flags, getFeatureFlags, headers, randomErrors } from '../../shared';
import { Order, Stores } from '../../types';

const dynamodbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const { logLevel, logSampleRate, logEvent } = config.get('shared.functions');
const logger = new Logger({
  logLevel: logLevel as LogLevel,
  sampleRateValue: logSampleRate,
  serviceName: 'create-order',
});

const tracer = new Tracer();
const metrics = new Metrics();

const createOrderHandler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    logger.info('started', { event });

    if (!event.body) {
      throw new Error('no order supplied');
    }

    // Get the config values
    const application = config.get('appConfig.appConfigApplicationId');
    const environment = config.get('appConfig.appConfigEnvironmentId');
    const configuration = config.get('appConfig.appConfigConfigurationId');
    const { preventCreateOrder, checkCreateOrderQuantity } =
      config.get('flags');
    const randomErrorsEnabled = config.get('shared.randomErrorsEnabled');

    const TableName = config.get('tableName');
    if (!TableName) {
      throw new Error('no table name supplied');
    }

    const Bucket = config.get('bucketname');
    if (!Bucket) {
      throw new Error('bucket name not supplied');
    }

    // get feature flags from appConfig
    const flags: Flags | Record<string, unknown> = (await getFeatureFlags(
      application,
      environment,
      configuration,
      [preventCreateOrder, checkCreateOrderQuantity]
    )) as Flags;

    logger.info(`feature flags: ${JSON.stringify(flags)}`);

    // We use a flag here to prevent the creation of orders
    // This is to simulate operational flags that can be used to control the flow of the application
    if (flags.opsPreventCreateOrders.enabled) {
      logger.error(
        'opsPreventCreateOrders enabled, preventing new order creation'
      );
      throw new Error(
        'new order creation is currently disabled via feature flag'
      );
    }

    // If we have this enabled, we will randomly throw errors
    randomErrors(randomErrorsEnabled);

    // we take the body (payload) from the event coming through from api gateway
    const item = JSON.parse(event.body);

    // we wont validate the input with this being a basic example only
    const order: Order = {
      id: uuid(),
      type: 'Orders',
      created: new Date().toISOString(),
      ...item,
    };

    // Use a flag here for a new feature release which checks that the order quantity is less than the flag limit
    if (
      flags.releaseCheckCreateOrderQuantity.enabled &&
      order.quantity >= flags.releaseCheckCreateOrderQuantity.limit
    ) {
      logger.error(
        `releaseCheckCreateOrderQuantity enabled, order quantity ${order.quantity} is greater than limit ${flags.releaseCheckCreateOrderQuantity.limit}`
      );
      throw new Error(
        `order quantity ${order.quantity} is greater than limit ${flags.releaseCheckCreateOrderQuantity.limit}`
      );
    }

    logger.info(`order: ${JSON.stringify(order)}`);

    const getParams = {
      TableName,
      IndexName: 'recordTypeIndex',
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

    logger.info(`create order: ${JSON.stringify(order)}`);

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

    logger.info(`invoice written to ${Bucket}`);

    metrics.addMetric('OrdersCreatedSuccess', MetricUnit.Count, 1);

    // api gateway needs us to return this body (stringified) and the status code plus CORS headers
    return {
      body: JSON.stringify(order),
      statusCode: 201,
      headers,
    };
  } catch (error) {
    let errorMessage = 'Unknown error';
    if (error instanceof Error) errorMessage = error.message;
    logger.error(errorMessage);

    // we create the metric for failure
    metrics.addMetric('OrderCreatedError', MetricUnit.Count, 1);

    return {
      body: JSON.stringify(errorMessage),
      statusCode: 400,
      headers,
    };
  }
};

export const handler = middy(createOrderHandler)
  .use(
    injectLambdaContext(logger, { logEvent: logEvent.toLowerCase() === 'true' })
  )
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics));
