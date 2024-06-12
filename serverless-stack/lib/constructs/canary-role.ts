import {
  Effect,
  PolicyStatement,
  PolicyStatementProps,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface CanaryRoleProps {
  stageName: string;
  bucketArn: string;
}

export class CanaryRole extends Role {
  constructor(scope: Construct, id: string, props: CanaryRoleProps) {
    super(scope, id, {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: `Role for Lambda to access the canary bucket for ${props.stageName}`,
    });

    const policies: PolicyStatementProps[] = [
      {
        resources: ['*'],
        actions: ['s3:ListAllMyBuckets'],
      },
      {
        resources: [`${props.bucketArn}/*`],
        actions: ['kms:GenerateDataKey'],
      },
      {
        resources: [`${props.bucketArn}/*`],
        actions: ['s3:*'],
      },
      {
        resources: ['*'],
        actions: ['cloudwatch:PutMetricData'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'CloudWatchSynthetics',
          },
        },
      },
      {
        resources: ['arn:aws:logs:::*'],
        actions: [
          'logs:CreateLogStream',
          'logs:CreateLogGroup',
          'logs:PutLogEvents',
        ],
      },
    ];

    policies.forEach((policy) => {
      this.addToPolicy(
        new PolicyStatement({ ...policy, effect: Effect.ALLOW })
      );
    });
  }
}
