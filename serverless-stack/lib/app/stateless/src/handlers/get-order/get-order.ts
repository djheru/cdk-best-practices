import * as AWS from 'aws-sdk';

import { Logger } from '@aws-lambda-powertools/logger';
import { LogLevel } from '@aws-lambda-powertools/logger/lib/cjs/types/Log';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { config } from '../../config';
import { Flags, getFeatureFlags, headers, randomErrors } from '../../shared';

type Order = {
  id: string;
  quantity: number;
  productId: string;
  storeId: string;
  created: string;
  type: string;
};

const { logLevel, logSampleRate, logEvent } = config.get('shared.functions');

const logger = new Logger({
  serviceName: 'get-order',
  logLevel: logLevel as LogLevel,
  sampleRateValue: logSampleRate,
});

const tracer = new Tracer();
const metrics = new Metrics();
const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const getOrderHandler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    logger.info('started');

    if (!event?.pathParameters)
      throw new Error('no id in the path parameters of the event');

    // we get the specific order id from the path parameters in the event from api gateway
    const { id } = event.pathParameters;

    // get the config values from process env
    const application = config.get('appConfig.appConfigApplicationId');
    const environment = config.get('appConfig.appConfigEnvironmentId');
    const configuration = config.get('appConfig.appConfigConfigurationId');
    const randomErrorsEnabled = config.get('shared.randomErrorsEnabled');
    const ordersTable = config.get('tableName');

    // get feature flags from appconfig
    const flags: Flags | Record<string, unknown> = await getFeatureFlags(
      application,
      environment,
      configuration
    );

    logger.info(`feature flags: ${JSON.stringify(flags)}`);

    // if we have this enabled it will sometimes randomly throw errors
    randomErrors(randomErrorsEnabled);

    const params: AWS.DynamoDB.DocumentClient.GetItemInput = {
      TableName: ordersTable,
      Key: {
        id,
      },
    };

    logger.info(`get order: ${id}`);

    const { Item: item } = await dynamoDb.get(params).promise();

    if (!item) throw new Error(`order id ${id} is not found`);

    const order: Order = {
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      storeId: item.storeId,
      created: item.created,
      type: item.type,
    };

    // we create the metric for success
    metrics.addMetric('GetOrderSuccess', MetricUnit.Count, 1);

    // api gateway needs us to return this body (stringified) and the status code
    return {
      statusCode: 200,
      body: JSON.stringify(order),
      headers,
    };
  } catch (error) {
    let errorMessage = 'Unknown error';
    if (error instanceof Error) errorMessage = error.message;
    logger.error(errorMessage);

    // we create the metric for failure
    metrics.addMetric('GetOrderError', MetricUnit.Count, 1);

    return {
      body: JSON.stringify(errorMessage),
      statusCode: 400,
      headers,
    };
  }
};

export const handler = middy(getOrderHandler)
  .use(
    injectLambdaContext(logger, {
      logEvent: logEvent.toLowerCase() === 'true' ? true : false,
    })
  )
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics));
