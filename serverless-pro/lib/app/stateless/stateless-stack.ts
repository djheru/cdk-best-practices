import * as cdk from 'aws-cdk-lib';
import { Aspects, CustomResource, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  PriceClass,
  SSLMethod,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { RestApiOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Alarm, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
  Canary,
  Code,
  Runtime,
  Schedule,
  Test,
} from 'aws-cdk-lib/aws-synthetics';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { Stage } from 'lib/pipeline/pipeline-types/pipeline-types';
import * as path from 'path';

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
}

export class StatelessStack extends cdk.Stack {
  public readonly apiEndpointUrl: cdk.CfnOutput;
  public readonly healthCheckUrl: cdk.CfnOutput;
  private readonly ordersApi: apigw.RestApi;

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
    this.ordersApi = new apigw.RestApi(this, 'Api', {
      description: `Serverless Pro API ${props.stageName}`,
      deploy: true,
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowCredentials: true,
        allowMethods: ['OPTIONS', 'POST', 'GET'],
        allowHeaders: ['*'],
      },
      endpointTypes: [apigw.EndpointType.REGIONAL],
      cloudWatchRole: true,
      deployOptions: {
        stageName: props.stageName,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
      },
    });

    // create the rest api resources
    const orders: apigw.Resource = this.ordersApi.root.addResource('orders');
    const healthCheck: apigw.Resource =
      this.ordersApi.root.addResource('health-checks');

    const order: apigw.Resource = orders.addResource('{id}');

    const cloudFrontDistribution = new Distribution(this, 'Distribution', {
      comment: `${props.stageName} api web distribution`,
      priceClass: PriceClass.PRICE_CLASS_100,
      enabled: true,
      httpVersion: HttpVersion.HTTP3,
      defaultBehavior: {
        origin: new RestApiOrigin(this.ordersApi),
        allowedMethods: AllowedMethods.ALLOW_ALL,
        compress: true,
        cachePolicy: new CachePolicy(this, 'CachePolicy', {
          comment: 'Policy with caching disabled',
          enableAcceptEncodingGzip: false,
          enableAcceptEncodingBrotli: false,
          defaultTtl: Duration.seconds(0),
          maxTtl: Duration.seconds(0),
          minTtl: Duration.seconds(0),
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: new OriginRequestPolicy(this, 'RequestPolicy', {
          comment: 'Policy to forward all query parameters but no headers',
          headerBehavior: OriginRequestHeaderBehavior.none(),
          queryStringBehavior: OriginRequestQueryStringBehavior.all(),
        }),
      },
      domainNames: [apiSubDomain],
      sslSupportMethod: SSLMethod.SNI,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      certificate,
    });

    cloudFrontDistribution.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // create the alias record for the api for this particular stage
    const subDomainRecord: ARecord = new ARecord(this, 'Alias', {
      zone,
      recordName: 'api',
      target: RecordTarget.fromAlias(
        new CloudFrontTarget(cloudFrontDistribution)
      ),
    });
    subDomainRecord.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // create the lambdas
    const createOrderLambda: NodejsFunction = new NodejsFunction(
      this,
      'CreateOrderLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          'src/handlers/create-order/create-order.ts'
        ),
        memorySize: props.lambdaMemorySize, // this is passed through per env from config
        handler: 'handler',
        bundling: {
          minify: true,
        },
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: bucket.bucketName,
        },
      }
    );

    const getOrderLambda: NodejsFunction = new NodejsFunction(
      this,
      'GetOrderLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, 'src/handlers/get-order/get-order.ts'),
        memorySize: props.lambdaMemorySize, // this is passed through per env from config
        handler: 'handler',
        bundling: {
          minify: true,
        },
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: bucket.bucketName,
        },
      }
    );

    const listOrdersLambda: NodejsFunction = new NodejsFunction(
      this,
      'ListOrdersLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, 'src/handlers/list-orders/list-orders.ts'),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
        },
        environment: {
          TABLE_NAME: table.tableName,
        },
      }
    );

    const healthCheckLambda: NodejsFunction = new NodejsFunction(
      this,
      'HealthCheckLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          'src/handlers/health-check/health-check.ts'
        ),
        memorySize: props.lambdaMemorySize, // this is passed through per env from config
        handler: 'handler',
        bundling: {
          minify: true,
        },
      }
    );

    const populateOrdersHandler: NodejsFunction = new NodejsFunction(
      this,
      'PopulateTableLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          'src/handlers/populate-table-cr/populate-table-cr.ts'
        ),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
        },
      }
    );

    // hook up the lambda functions to the api
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrderLambda, {
        proxy: true,
      })
    );

    order.addMethod(
      'GET',
      new apigw.LambdaIntegration(getOrderLambda, {
        proxy: true,
      })
    );

    orders.addMethod(
      'GET',
      new apigw.LambdaIntegration(listOrdersLambda, {
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

      const canaryRole: Role = new Role(this, 'CanaryIamRole', {
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        description: `Canary IAM Role for ${props.stageName}`,
      });

      canaryRole.addToPolicy(
        new PolicyStatement({
          resources: ['*'],
          actions: ['s3:ListAllMyBuckets'],
          effect: Effect.ALLOW,
        })
      );

      canaryRole.addToPolicy(
        new PolicyStatement({
          resources: [`${props.assetsBucket.bucketArn}/*`],
          actions: ['kms:GenerateDataKey'],
          effect: Effect.ALLOW,
        })
      );

      canaryRole.addToPolicy(
        new PolicyStatement({
          resources: [`${props.assetsBucket.bucketArn}/*`],
          actions: ['s3:*'],
          effect: Effect.ALLOW,
        })
      );

      canaryRole.addToPolicy(
        new PolicyStatement({
          resources: ['*'],
          actions: ['cloudwatch:PutMetricData'],
          effect: Effect.ALLOW,
          conditions: {
            StringEquals: {
              'cloudwatch:namespace': 'CloudWatchSynthetics',
            },
          },
        })
      );

      canaryRole.addToPolicy(
        new PolicyStatement({
          resources: ['arn:aws:logs:::*'],
          actions: [
            'logs:CreateLogStream',
            'logs:CreateLogGroup',
            'logs:PutLogEvents',
          ],
          effect: Effect.ALLOW,
        })
      );

      const apiCanary: Canary = new Canary(this, 'APICanary', {
        canaryName: `${props.stageName}-api-canary`,
        role: canaryRole,
        schedule: Schedule.rate(cdk.Duration.minutes(5)),
        artifactsBucketLocation: {
          bucket: props.assetsBucket,
        },
        test: Test.custom({
          code: Code.fromAsset(
            path.join(__dirname, './src/canaries/api-canary')
          ),
          handler: 'index.handler',
        }),
        runtime: Runtime.SYNTHETICS_NODEJS_PUPPETEER_6_2,
        environmentVariables: {
          APP_API_HOST: props.domainName,
          STAGE: props.stageName,
        },
      });
      apiCanary.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const visualCanary: Canary = new Canary(this, 'VisualCanary', {
        canaryName: `${props.stageName}-visual-canary`,
        role: canaryRole,
        schedule: Schedule.rate(cdk.Duration.minutes(5)),
        artifactsBucketLocation: {
          bucket: props.assetsBucket,
        },
        test: Test.custom({
          code: Code.fromAsset(
            path.join(__dirname, './src/canaries/visual-canary')
          ),
          handler: 'index.handler',
        }),
        runtime: Runtime.SYNTHETICS_NODEJS_PUPPETEER_6_2,
        environmentVariables: {
          STAGE: props.stageName,
          WEBSITE_URL: websiteSubDomain,
        },
      });
      visualCanary.applyRemovalPolicy(RemovalPolicy.DESTROY);

      // add alarms
      const apiAlarm: Alarm = new Alarm(this, 'APICanaryAlarm', {
        metric: apiCanary.metricSuccessPercent(), // percentage of successful canary runs over a given time
        evaluationPeriods: 1,
        threshold: 90,
        actionsEnabled: true,
        alarmDescription: `${props.stageName} API Canary CloudWatch Alarm`,
        alarmName: `${props.stageName}ApiCanaryAlarm`,
        comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      });

      const visualAlarm: Alarm = new Alarm(this, 'VisualCanaryAlarm', {
        metric: visualCanary.metricSuccessPercent(), // percentage of successful canary runs over a given time
        evaluationPeriods: 1,
        threshold: 60,
        datapointsToAlarm: 1,
        actionsEnabled: true,
        alarmDescription: `${props.stageName} Visual Canary CloudWatch Alarm`,
        alarmName: `${props.stageName}VisualCanaryAlarm`,
        comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      });

      apiAlarm.addAlarmAction(new SnsAction(apiTopic));
      visualAlarm.addAlarmAction(new SnsAction(visualTopic));

      visualAlarm.applyRemovalPolicy(RemovalPolicy.DESTROY);
      apiAlarm.applyRemovalPolicy(RemovalPolicy.DESTROY);
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
