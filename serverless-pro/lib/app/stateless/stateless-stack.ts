import * as cdk from 'aws-cdk-lib';
import { Aspects, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution, PriceClass } from 'aws-cdk-lib/aws-cloudfront';
import {
  LambdaApplication,
  LambdaDeploymentConfig,
} from 'aws-cdk-lib/aws-codedeploy';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  LayerVersion,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  ARecord,
  HostedZone,
  IHostedZone,
  RecordTarget,
} from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import {
  Code,
  Schedule,
  Runtime as SyntheticsRuntime,
  Test,
} from 'aws-cdk-lib/aws-synthetics';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';
import {
  Api,
  ApiCloudFrontDistribution,
  CanaryRole,
  ProgressiveLambda,
  SyntheticCanary,
} from '../../constructs';
import { Stage } from '../../pipeline/pipeline-types/pipeline-types';
import { Flags } from '../feature-flags/config/feature-flag-types';

export interface StatelessStackProps extends cdk.StackProps {
  env: {
    account: string;
    region: string;
  };
  table: dynamodb.Table;
  bucket: s3.Bucket;
  assetsBucket: s3.Bucket;
  stageName: string;
  lambdaMemorySize: number;
  domainName: string;
  canaryNotificationEmail: string;
  appConfigLambdaLayerArn: string;
  randomErrorsEnabled: string;
  appConfigApplicationRef: string;
  appConfigEnvName: string;
  appConfigConfigurationProfileRef: string;
  appConfigEnvRef: string;
  powerToolsServiceName: string;
  powerToolsMetricsNamespace: string;
}

export class StatelessStack extends cdk.Stack {
  public readonly apiEndpointUrl: cdk.CfnOutput;
  public readonly healthCheckUrl: cdk.CfnOutput;
  private readonly ordersApi: apigw.RestApi;
  private readonly cloudFrontDistribution: Distribution;

  constructor(scope: Construct, id: string, props: StatelessStackProps) {
    super(scope, id, props);

    const { table, bucket } = props;
    const apiSubDomain =
      props.stageName === Stage.prod
        ? `api.${props.domainName}`.toLowerCase()
        : `api.${props.stageName}.${props.domainName}`.toLowerCase();
    const websiteSubDomain =
      props.stageName === Stage.prod
        ? `https://${props.domainName}`.toLowerCase()
        : `https://${props.stageName}.${props.domainName}`.toLowerCase();

    // get the hosted zone based on domain name lookup
    const zone: IHostedZone = HostedZone.fromLookup(this, 'HostedZone', {
      domainName:
        props.stageName === Stage.prod
          ? `${props.domainName}`
          : `${props.stageName}.${props.domainName}`,
    });

    const certifcateName = `${id}-certificate`;
    const certificate = new Certificate(this, certifcateName, {
      domainName: apiSubDomain,
      validation: CertificateValidation.fromDns(zone),
    });

    // create the rest api
    this.ordersApi = new Api(this, 'Api', {
      description: `Serverless Pro API ${props.stageName}`,
      deploy: true,
      stageName: props.stageName,
    }).api;

    // create the rest api resources
    const orders: apigw.Resource = this.ordersApi.root.addResource('orders');
    const healthCheck: apigw.Resource =
      this.ordersApi.root.addResource('health-checks');

    const order: apigw.Resource = orders.addResource('{id}');

    const cloudFrontDistribution = new ApiCloudFrontDistribution(
      this,
      'Distribution',
      {
        stageName: props.stageName,
        certificate,
        api: this.ordersApi,
        apiSubDomain,
        priceClass: PriceClass.PRICE_CLASS_100,
        enabled: true,
        comment: `${props.stageName} api web distribution`,
      }
    ).distribution;

    // create the alias record for the api for this particular stage
    const subDomainRecord: ARecord = new ARecord(this, 'Alias', {
      zone,
      recordName: 'api',
      target: RecordTarget.fromAlias(
        new CloudFrontTarget(cloudFrontDistribution)
      ),
    });
    subDomainRecord.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // create a new application for the progressive deployments
    const application = new LambdaApplication(this, 'CodeDeployApplication', {
      applicationName: props.stageName,
    });

    // create a lambda progressive deployment topic
    const lambdaDeploymentTopic: Topic = new Topic(
      this,
      'LambdaDeploymentTopic',
      {
        displayName: `${props.stageName} Lambda Deployment Topic`,
        topicName: `${props.stageName}LambdaDeploymentTopic`,
      }
    );
    lambdaDeploymentTopic.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // send an email when the lambda progressive deployment topic is in error state
    const lambdaDeploymentSubscriptions = lambdaDeploymentTopic.addSubscription(
      new EmailSubscription(props.canaryNotificationEmail)
    );
    lambdaDeploymentSubscriptions.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // get the correct lambda layer extension for our region (props)
    const appConfigLambdaLayerExtension = LayerVersion.fromLayerVersionArn(
      this,
      'AppConfigExtension',
      props.appConfigLambdaLayerArn
    );

    // create the typed feature flags
    const createOrderAllowList: Flags = 'createOrderAllowList';
    const opsPreventCreateOrders: Flags = 'opsPreventCreateOrders';
    const releaseCheckCreateOrderQuantity: Flags =
      'releaseCheckCreateOrderQuantity';
    const opsLimitListOrdersResults: Flags = 'opsLimitListOrdersResults';

    // create the app config specific config shared properties
    const appConfigEnvironment = {
      APPCONFIG_APPLICATION_ID: props.appConfigApplicationRef,
      APPCONFIG_ENVIRONMENT: props.appConfigEnvName,
      APPCONFIG_ENVIRONMENT_ID: props.appConfigEnvRef,
      APPCONFIG_CONFIGURATION_ID: props.appConfigConfigurationProfileRef,
      AWS_APPCONFIG_EXTENSION_POLL_INTERVAL_SECONDS: '30',
      AWS_APPCONFIG_EXTENSION_POLL_TIMEOUT_MILLIS: '3000',
      AWS_APPCONFIG_EXTENSION_HTTP_PORT: '2772',
      AWS_APPCONFIG_EXTENSION_PREFETCH_LIST: `/applications/${props.appConfigApplicationRef}/environments/${props.appConfigEnvRef}/configurations/${props.appConfigConfigurationProfileRef}`,
    };

    // create the lambda power tools specific config shared properties
    const lambdaPowerToolsConfig = {
      LOG_LEVEL: 'DEBUG',
      POWERTOOLS_LOGGER_LOG_EVENT: 'false',
      POWERTOOLS_LOGGER_SAMPLE_RATE: '1',
      POWERTOOLS_METRICS_NAMESPACE: props.powerToolsMetricsNamespace,
      POWERTOOLS_SERVICE_NAME: props.powerToolsServiceName,
    };

    // create the policy statement for accessing appconfig
    const appConfigRoleStatement = new PolicyStatement({
      actions: [
        'appconfig:StartConfigurationSession',
        'appconfig:GetLatestConfiguration',
        'appConfig:GetConfiguration',
      ],
      resources: ['*'],
    });

    // create the lambdas
    const { alias: createOrderLambdaAlias, lambda: createOrderLambda } =
      new ProgressiveLambda(this, 'CreateOrderLambda', {
        stageName: props.stageName,
        serviceName: props.powerToolsServiceName,
        metricName: 'OrderCreatedError',
        namespace: props.powerToolsMetricsNamespace,
        tracing: Tracing.ACTIVE,
        logRetention: RetentionDays.ONE_DAY,
        architecture: Architecture.ARM_64,
        application,
        alarmEnabled: true,
        snsTopic: lambdaDeploymentTopic,
        timeout: cdk.Duration.seconds(10),
        retryAttempts: 0,
        deploymentConfig: LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
        runtime: Runtime.NODEJS_20_X,
        layers: [appConfigLambdaLayerExtension],
        entry: path.join(
          __dirname,
          'src/handlers/create-order/create-order.ts'
        ),
        memorySize: props.lambdaMemorySize,
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
          sourceMap: true,
        },
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: bucket.bucketName,
          RANDOM_ERRORS_ENABLED: props.randomErrorsEnabled,
          ...appConfigEnvironment,
          ...lambdaPowerToolsConfig,
          FLAG_CREATE_ORDER_ALLOW_LIST: createOrderAllowList,
          FLAG_PREVENT_CREATE_ORDERS: opsPreventCreateOrders,
          FLAG_CHECK_CREATE_ORDER_QUANTITY: releaseCheckCreateOrderQuantity,
        },
      });

    const { alias: getOrderLambdaAlias, lambda: getOrderLambda } =
      new ProgressiveLambda(this, 'GetOrderLambda', {
        stageName: props.stageName,
        serviceName: props.powerToolsServiceName,
        metricName: 'GetOrderError',
        namespace: props.powerToolsMetricsNamespace,
        tracing: Tracing.ACTIVE,
        logRetention: RetentionDays.ONE_DAY,
        architecture: Architecture.ARM_64,
        application,
        alarmEnabled: true,
        snsTopic: lambdaDeploymentTopic,
        timeout: cdk.Duration.seconds(10),
        retryAttempts: 0,
        deploymentConfig: LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(__dirname, 'src/handlers/get-order/get-order.ts'),
        memorySize: props.lambdaMemorySize,
        handler: 'handler',
        layers: [appConfigLambdaLayerExtension],
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: table.tableName,
          RANDOM_ERRORS_ENABLED: props.randomErrorsEnabled,
          ...appConfigEnvironment,
          ...lambdaPowerToolsConfig,
        },
      });

    const { alias: listOrdersLambdaAlias, lambda: listOrdersLambda } =
      new ProgressiveLambda(this, 'ListOrdersLambda', {
        stageName: props.stageName,
        serviceName: props.powerToolsServiceName,
        metricName: 'ListOrdersError',
        namespace: props.powerToolsMetricsNamespace,
        tracing: Tracing.ACTIVE,
        logRetention: RetentionDays.ONE_DAY,
        architecture: Architecture.ARM_64,
        application,
        alarmEnabled: true,
        snsTopic: lambdaDeploymentTopic,
        timeout: cdk.Duration.seconds(10),
        retryAttempts: 0,
        deploymentConfig: LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(__dirname, 'src/handlers/list-orders/list-orders.ts'),
        memorySize: props.lambdaMemorySize,
        handler: 'handler',
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['aws-sdk'],
        },
        layers: [appConfigLambdaLayerExtension],
        environment: {
          TABLE_NAME: table.tableName,
          RANDOM_ERRORS_ENABLED: props.randomErrorsEnabled,
          ...appConfigEnvironment,
          ...lambdaPowerToolsConfig,
          FLAG_LIMIT_LIST_ORDERS_RESULTS: opsLimitListOrdersResults,
        },
      });

    const healthCheckLambda: NodejsFunction = new NodejsFunction(
      this,
      'HealthCheckLambda',
      {
        runtime: Runtime.NODEJS_20_X,
        logRetention: RetentionDays.ONE_DAY,
        entry: path.join(
          __dirname,
          'src/handlers/health-check/health-check.ts'
        ),
        memorySize: props.lambdaMemorySize,
        handler: 'handler',
        environment: {
          ...lambdaPowerToolsConfig,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['aws-sdk'],
        },
      }
    );

    // add the app config role statements to the existing functions
    createOrderLambda.addToRolePolicy(appConfigRoleStatement);
    listOrdersLambda.addToRolePolicy(appConfigRoleStatement);
    getOrderLambda.addToRolePolicy(appConfigRoleStatement);

    // this is the custom resource which populates our table with initial master data
    const populateOrdersHandler: NodejsFunction = new NodejsFunction(
      this,
      'PopulateTableLambda',
      {
        runtime: Runtime.NODEJS_20_X,
        logRetention: RetentionDays.ONE_DAY,
        entry: path.join(
          __dirname,
          'src/handlers/populate-table-cr/populate-table-cr.ts'
        ),
        memorySize: props.lambdaMemorySize,
        handler: 'handler',
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: [
            'aws-sdk',
            '@aws-lambda-powertools/commons',
            '@aws-lambda-powertools/logger',
            '@aws-lambda-powertools/tracer',
            '@aws-lambda-powertools/metrics',
          ],
        },
      }
    );

    // hook up the lambda functions to the api
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrderLambdaAlias, {
        proxy: true,
      })
    );

    order.addMethod(
      'GET',
      new apigw.LambdaIntegration(getOrderLambdaAlias, {
        proxy: true,
      })
    );

    orders.addMethod(
      'GET',
      new apigw.LambdaIntegration(listOrdersLambdaAlias, {
        proxy: true,
      })
    );

    healthCheck.addMethod(
      'GET',
      new apigw.LambdaIntegration(healthCheckLambda, {
        proxy: true,
      })
    );

    const provider: Provider = new Provider(
      this,
      'PopulateTableConfigCustomResource',
      {
        onEventHandler: populateOrdersHandler, // this lambda will be called on cfn deploy
        logRetention: RetentionDays.ONE_DAY,
        providerFunctionName: `populate-orders-${props.stageName}-cr-lambda`,
      }
    );

    // use the custom resource provider
    new CustomResource(this, 'DbTableConfigCustomResource', {
      serviceToken: provider.serviceToken,
      properties: {
        tableName: props.table.tableName,
      },
    });

    // grant the relevant lambdas access to our dynamodb database
    table.grantReadData(getOrderLambda);
    table.grantReadData(listOrdersLambda);
    table.grantReadWriteData(createOrderLambda);
    table.grantWriteData(populateOrdersHandler);

    // grant the create order lambda access to the s3 bucket
    bucket.grantWrite(createOrderLambda);

    // we only use synthetics in the staging (gamma) or prod stages
    // https://pipelines.devops.aws.dev/application-pipeline/index.html
    if (props.stageName === Stage.staging || props.stageName === Stage.prod) {
      const apiTopic: Topic = new Topic(this, 'CanaryAPITopic', {
        displayName: `${props.stageName} API Canary Topic`,
        topicName: `${props.stageName}ApiCanaryTopic`,
      });
      apiTopic.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const visualTopic: Topic = new Topic(this, 'CanaryVisualTopic', {
        displayName: `${props.stageName} Visual Canary Topic`,
        topicName: `${props.stageName}VisualCanaryTopic`,
      });
      visualTopic.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const apiTopicSubscription = apiTopic.addSubscription(
        new EmailSubscription(props.canaryNotificationEmail)
      );
      const visualTopicSubscription = visualTopic.addSubscription(
        new EmailSubscription(props.canaryNotificationEmail)
      );

      apiTopicSubscription.applyRemovalPolicy(RemovalPolicy.DESTROY);
      visualTopicSubscription.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const canaryRole = new CanaryRole(this, 'CanaryIamRole', {
        stageName: props.stageName,
        bucketArn: props.assetsBucket.bucketArn,
      });

      new SyntheticCanary(this, 'APICanary', {
        stageName: props.stageName,
        actionEnabled: true,
        snsTopic: apiTopic,
        canaryName: `${props.stageName}-api-canary`,
        role: canaryRole,
        schedule: Schedule.rate(cdk.Duration.minutes(60)),
        artifactsBucketLocation: {
          bucket: props.assetsBucket,
        },
        test: Test.custom({
          code: Code.fromAsset(
            path.join(__dirname, './src/canaries/api-canary')
          ),
          handler: 'index.handler',
        }),
        runtime: SyntheticsRuntime.SYNTHETICS_NODEJS_PUPPETEER_6_2,
        environmentVariables: {
          APP_API_HOST: props.domainName,
          STAGE: props.stageName,
        },
      });

      new SyntheticCanary(this, 'VisualCanary', {
        stageName: props.stageName,
        actionEnabled: true,
        snsTopic: visualTopic,
        canaryName: `${props.stageName}-visual-canary`,
        role: canaryRole,
        schedule: Schedule.rate(cdk.Duration.minutes(60)),
        artifactsBucketLocation: {
          bucket: props.assetsBucket,
        },
        test: Test.custom({
          code: Code.fromAsset(
            path.join(__dirname, './src/canaries/visual-canary')
          ),
          handler: 'index.handler',
        }),
        runtime: SyntheticsRuntime.SYNTHETICS_NODEJS_PUPPETEER_6_2,
        environmentVariables: {
          STAGE: props.stageName,
          WEBSITE_URL: websiteSubDomain,
        },
      });
    }

    const apiEndpoint = apiSubDomain;
    this.apiEndpointUrl = new cdk.CfnOutput(this, 'ApiEndpointOutput', {
      value: apiEndpoint,
      exportName: `api-endpoint-${props.stageName}`,
    });

    this.healthCheckUrl = new cdk.CfnOutput(this, 'healthCheckUrlOutput', {
      value: `${apiEndpoint}/health-checks`,
      exportName: `healthcheck-endpoint-${props.stageName}`,
    });

    Aspects.of(this).add(new AwsSolutionsChecks({ verbose: false }));
    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-COG4',
          reason: `Rule suppression for 'The REST API stage is not associated with AWS WAFv2 web ACL'`,
        },
        {
          id: 'AwsSolutions-APIG3',
          reason: `Rule suppression for 'The REST API stage is not associated with AWS WAFv2 web ACL'`,
        },
        {
          id: 'AwsSolutions-APIG2',
          reason: `Rule suppression for 'The REST API does not have request validation enabled'`,
        },
        {
          id: 'AwsSolutions-IAM4',
          reason: `Rule suppression for 'The IAM user, role, or group uses AWS managed policies'`,
        },
        {
          id: 'AwsSolutions-APIG4',
          reason: `Rule suppression for 'The API does not implement authorization.'`,
        },
        {
          id: 'AwsSolutions-APIG1',
          reason: `Rule suppression for 'The API does not have access logging enabled'`,
        },
        {
          id: 'AwsSolutions-L1',
          reason: `Rule suppression for 'The non-container Lambda function is not configured to use the latest runtime version'`,
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: `Rule suppression for 'The IAM entity contains wildcard permissions and does not have a cdk-nag rule suppression with evidence for those permission'`,
        },
        {
          id: 'AwsSolutions-CFR3',
          reason: `Rule suppression for 'The CloudFront distribution does not have access logging enabled'`,
        },
        {
          id: 'AwsSolutions-SNS2',
          reason: `Rule supression for 'The SNS Topic does not have server-side encryption enabled'`,
        },
        {
          id: 'AwsSolutions-SNS3',
          reason: `Rule supression for 'The SNS Topic does not require publishers to use SSL.'`,
        },
        {
          id: 'AwsSolutions-CFR1',
          reason: `Rule supression for 'The CloudFront distribution may require Geo restrictions'`,
        },
        {
          id: 'AwsSolutions-CFR2',
          reason: `Rule supression for 'The CloudFront distribution may require integration with AWS WAF'`,
        },
      ],
      true
    );
  }
}
