import { pascalCase } from 'change-case';
import * as dotenv from 'dotenv';
import {
  Account,
  CiCdEnvironmentConfig,
  EnvironmentConfig,
  Region,
  Stage,
} from '../pipeline-types/pipeline-types';

dotenv.config();

if (!process.env.CODESTAR_CONNECTION_ARN) {
  throw new Error('CODESTAR_CONNECTION_ARN must be set in the .env file');
}

export const CODESTAR_CONNECTION_ARN = process.env.CODESTAR_CONNECTION_ARN;

export const cicdEnvironment: CiCdEnvironmentConfig = {
  codestarConnectionArn: CODESTAR_CONNECTION_ARN,
  env: {
    account: Account.cicd,
    region: Region.virginia,
  },
};

export const environments: Record<Stage, EnvironmentConfig> = {
  // allow developers to spin up a quick branch for a given PR they are working on e.g. pr-124
  // this is done with an npm run dev, not through the pipeline, and uses the values in .env
  [Stage.feature]: {
    env: {
      account:
        process.env.ACCOUNT || (process.env.CDK_DEFAULT_ACCOUNT as string),
      region: process.env.REGION || (process.env.CDK_DEFAULT_REGION as string),
    },
    stateful: {
      bucketName: (
        `serverless-pro-${process.env.FEATURE}-bucket-` + Account.dev
      ).toLowerCase(),
      assetsBucketName: (
        `serverless-pro-lg-${process.env.FEATURE}-bucket-` + Account.dev
      ).toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: parseInt(process.env.LAMBDA_MEM_SIZE || '128'),
      canaryNotificationEmail: process.env.NOTIFICATION_EMAIL as string,
      randomErrorsEnabled: process.env.RANDOM_ERRORS_ENABLED || 'false',
    },
    client: {
      bucketName: (
        `serverless-pro-client-${process.env.FEATURE}-bucket-` + Account.dev
      ).toLowerCase(),
    },
    shared: {
      domainName: 'stonktrader.io',
      appConfigLambdaLayerArn: process.env
        .APP_CONFIG_LAMBDA_LAYER_ARN as string,
      powerToolsMetricsNamespace: process.env
        .POWERTOOLS_METRICS_NAMESPACE as string,
      powerToolServiceName: process.env.POWERTOOLS_SERVICE_NAME as string,
    },
    stageName: pascalCase(process.env.FEATURE || Stage.feature).replace(
      /_/g,
      '-'
    ),
  },
  [Stage.dev]: {
    env: { account: Account.dev, region: Region.virginia },
    stateful: {
      bucketName: 'serverless-pro-dev-bucket-' + Account.dev,
      assetsBucketName: 'serverless-pro-lg-dev-bucket-' + Account.dev,
    },
    stateless: {
      lambdaMemorySize: 128,
      canaryNotificationEmail: process.env.NOTIFICATION_EMAIL as string,
      randomErrorsEnabled: process.env.RANDOM_ERRORS_ENABLED || 'false',
    },
    client: {
      bucketName: 'serverless-pro-client-dev-bucket-' + Account.dev,
    },
    shared: {
      domainName: 'stonktrader.io',
      appConfigLambdaLayerArn:
        'arn:aws:lambda:eu-west-1:434848589818:layer:AWS-AppConfig-Extension-Arm64:46',
      powerToolServiceName: 'serverless-pro-orders-service-dev',
      powerToolsMetricsNamespace: 'ServerlessProDev',
    },
    stageName: Stage.dev,
  },
  [Stage.staging]: {
    env: {
      account: Account.staging,
      region: Region.virginia,
    },
    stateful: {
      bucketName: 'serverless-pro-staging-bucket-' + Account.staging,
      assetsBucketName: 'serverless-pro-lg-staging-bucket-' + Account.staging,
    },
    stateless: {
      lambdaMemorySize: 512,
      canaryNotificationEmail: process.env.NOTIFICATION_EMAIL as string,
      randomErrorsEnabled: process.env.RANDOM_ERRORS_ENABLED || 'false',
    },
    client: {
      bucketName: 'serverless-pro-client-staging-bucket-' + Account.staging,
    },
    shared: {
      domainName: 'stonktrader.io',
      appConfigLambdaLayerArn:
        'arn:aws:lambda:eu-west-1:434848589818:layer:AWS-AppConfig-Extension-Arm64:46',
      powerToolServiceName: 'serverless-pro-orders-service-staging',
      powerToolsMetricsNamespace: 'ServerlessProStaging',
    },
    stageName: Stage.staging,
  },
  [Stage.prod]: {
    env: {
      account: Account.prod,
      region: Region.virginia,
    },
    stateful: {
      bucketName: 'serverless-pro-prod-bucket-' + Account.prod,
      assetsBucketName: 'serverless-pro-lg-prod-bucket-' + Account.prod,
    },
    stateless: {
      lambdaMemorySize: 1024,
      canaryNotificationEmail: process.env.NOTIFICATION_EMAIL as string,
      randomErrorsEnabled: process.env.RANDOM_ERRORS_ENABLED || 'false',
    },
    client: {
      bucketName: 'serverless-pro-client-prod-bucket-' + Account.prod,
    },
    shared: {
      domainName: 'stonktrader.io',
      appConfigLambdaLayerArn:
        'arn:aws:lambda:eu-west-1:434848589818:layer:AWS-AppConfig-Extension-Arm64:46',
      powerToolServiceName: 'serverless-pro-orders-service-prod',
      powerToolsMetricsNamespace: 'ServerlessProProd',
    },
    stageName: Stage.prod,
  },
};
