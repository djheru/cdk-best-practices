import { Canary, CanaryProps } from '@aws-cdk/aws-synthetics-alpha';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

interface SyntheticCanaryProps extends CanaryProps {
  stageName: string;
  snsTopic: Topic;
  actionEnabled: boolean;
}

export class SyntheticCanary extends Construct {
  public readonly canary: Canary;
  public readonly alarm: Alarm;

  constructor(scope: Construct, id: string, props: SyntheticCanaryProps) {
    super(scope, id);

    this.canary = new Canary(this, id, {
      ...props,
    });
    this.canary.applyRemovalPolicy(RemovalPolicy.DESTROY);

    this.alarm = new Alarm(this, id + 'Alarm', {
      metric: this.canary.metricSuccessPercent(),
      threshold: 90,
      actionsEnabled: props.actionEnabled,
      alarmDescription: `${props.stageName} Canary CloudWatch Alarm`,
      alarmName: `${props.stageName}${id}Alarm`,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    this.alarm.addAlarmAction(new SnsAction(props.snsTopic));
    this.alarm.applyRemovalPolicy(RemovalPolicy.DESTROY);
  }
}
