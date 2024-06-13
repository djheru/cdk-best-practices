import { Logger } from '@aws-lambda-powertools/logger';
import { LogLevel } from '@aws-lambda-powertools/logger/lib/cjs/types/Log';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { config } from '../../config';
import { Flags, getFeatureFlags, headers, randomErrors } from '../../shared';
import { Order } from '../../types';

const dynamodbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const { logLevel, logSampleRate, logEvent } = config.get('shared.functions');

const logger = new Logger({
  serviceName: 'get-order',
  logLevel: logLevel as LogLevel,
  sampleRateValue: logSampleRate,
});

const tracer = new Tracer();
const metrics = new Metrics();

const listOrderHandler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    logger.info('started', { event });

    // get the config values from process env
    const application = config.get('appConfig.appConfigApplicationId');
    const environment = config.get('appConfig.appConfigEnvironmentId');
    const configuration = config.get('appConfig.appConfigConfigurationId');
    const randomErrorsEnabled = config.get('shared.randomErrorsEnabled');
    const TableName = config.get('tableName');

    // get feature flags from appconfig
    const flags: Flags | Record<string, unknown> = await getFeatureFlags(
      application,
      environment,
      configuration
    );

    const flag = flags as Flags['opsLimitListOrdersResults'];

    logger.info(`feature flags: ${JSON.stringify(flags)}`);

    // if we have this enabled it will sometimes randomly throw errors
    randomErrors(randomErrorsEnabled);

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

    let orders: Order[] = !Items
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

    // we have an operational feature flag that limits the orders returned
    // note: this is for the article only and we would not be performing a full scan typically like this
    if (flag.enabled) {
      console.error(
        `opsLimitListOrdersResults enabled so limiting results to ${flag.limit}`
      );
      orders = orders.slice(0, flag.limit);
    }

    // we create the metric for success
    metrics.addMetric('ListOrdersSuccess', MetricUnit.Count, 1);

    // api gateway needs us to return this body (stringified) and the status code
    return {
      statusCode: 200,
      body: JSON.stringify(orders),
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

export const handler = middy(listOrderHandler)
  .use(
    injectLambdaContext(logger, {
      logEvent: logEvent.toLowerCase() === 'true',
    })
  )
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics));
