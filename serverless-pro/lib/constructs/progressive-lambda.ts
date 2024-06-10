import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Metric,
  Stats,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import {
  ILambdaDeploymentConfig,
  LambdaApplication,
  LambdaDeploymentGroup,
} from 'aws-cdk-lib/aws-codedeploy';
import { Alias } from 'aws-cdk-lib/aws-lambda';
import {
  NodejsFunction,
  NodejsFunctionProps,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

interface ProgressiveLambdaProps extends NodejsFunctionProps {
  stageName: string;
  application: LambdaApplication;
  deploymentConfig: ILambdaDeploymentConfig;
  alarmEnabled: boolean;
  snsTopic: Topic;
  metricName: string;
  namespace: string;
  serviceName: string;
}

export class ProgressiveLambda extends Construct {
  public readonly lambda: NodejsFunction;
  public readonly alias: Alias;
  public readonly alarm: Alarm;
  public readonly deploymentGroup: LambdaDeploymentGroup;

  private readonly application: LambdaApplication;
  private readonly deploymentConfig: ILambdaDeploymentConfig;

  constructor(scope: Construct, id: string, props: ProgressiveLambdaProps) {
    super(scope, id);

    this.application = props.application;
    this.deploymentConfig = props.deploymentConfig;

    // creation of the lambda passing through the props
    this.lambda = new NodejsFunction(this, id, {
      ...props,
    });

    this.alias = new Alias(this, id + 'Alias', {
      aliasName: props.stageName,
      version: this.lambda.currentVersion,
    });

    // a fixed prop cloudwatch alarm
    this.alarm = new Alarm(this, id + 'Failure', {
      alarmDescription: `${props.namespace}/${props.metricName} deployment errors > 0 for ${id}`,
      actionsEnabled: props.alarmEnabled,
      treatMissingData: TreatMissingData.NOT_BREACHING, // ensure the alarm is only triggered for a period
      metric: new Metric({
        metricName: props.metricName,
        namespace: props.namespace,
        statistic: Stats.SUM,
        dimensionsMap: {
          service: props.serviceName,
        },
        period: Duration.minutes(1),
      }),
      threshold: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
    });

    this.alarm.addAlarmAction(new SnsAction(props.snsTopic));
    this.alarm.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // the code deploy deployment group
    this.deploymentGroup = new LambdaDeploymentGroup(
      this,
      id + 'CanaryDeployment',
      {
        alias: this.alias,
        deploymentConfig: this.deploymentConfig,
        alarms: [this.alarm],
        application: this.application,
      }
    );
  }
}
