import * as cdk from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { ClientStack } from '../../app/client/client-stack';
import { FeatureFlagStack } from '../../app/feature-flags/feature-flags';
import { StatefulStack } from '../../app/stateful/stateful-stack';
import { StatelessStack } from '../../app/stateless/stateless-stack';
import { EnvironmentConfig } from '../pipeline-types/pipeline-types';

// this is our stage made up of multiple stacks which will be deployed to various environments
// based on config i.e. feature-dev, staging, prod, which also includes our application config
export class PipelineStage extends cdk.Stage {
  public readonly apiEndpointUrl: cdk.CfnOutput;
  public readonly healthCheckUrl: cdk.CfnOutput;
  public readonly route53ClientUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: EnvironmentConfig) {
    super(scope, id, props);

    // this is our stage which can be deployed for various envs i.e. feature-dev, staging & prod
    // note: we will pass through the given environment props when adding the stage
    const featureFlagStack = new FeatureFlagStack(this, 'FeatureFlagStack', {
      stageName: props.stageName,
    });

    const statefulStack = new StatefulStack(this, 'StatefulStack', {
      stageName: props.stageName,
      bucketName: props.stateful.bucketName,
      assetsBucketName: props.stateful.assetsBucketName,
    });

    const statelessStack = new StatelessStack(this, 'StatelessStack', {
      env: {
        account: props.env.account,
        region: props.env.region,
      },
      table: statefulStack.table,
      bucket: statefulStack.bucket,
      assetsBucket: statefulStack.assetsBucket,
      lambdaMemorySize: props.stateless.lambdaMemorySize,
      stageName: props.stageName,
      domainName: props.shared.domainName,
      canaryNotificationEmail: props.stateless.canaryNotificationEmail,
      randomErrorsEnabled: props.stateless.randomErrorsEnabled,
      appConfigLambdaLayerArn: props.shared.appConfigLambdaLayerArn,
      appConfigApplicationRef: featureFlagStack.appConfigApplicationRef,
      appConfigConfigurationProfileRef:
        featureFlagStack.appConfigConfigurationProfileRef,
      appConfigEnvName: featureFlagStack.appConfigEnvName,
      appConfigEnvRef: featureFlagStack.appConfigEnvRef,
      powerToolsServiceName: props.shared.powerToolServiceName,
      powerToolsMetricsNamespace: props.shared.powerToolsMetricsNamespace,
    });

    const clientStack = new ClientStack(this, 'ClientStack', {
      env: {
        account: props.env.account,
        region: props.env.region,
      },
      bucketName: props.client.bucketName,
      stageName: props.stageName,
      domainName: props.shared.domainName,
    });

    this.apiEndpointUrl = statelessStack.apiEndpointUrl;
    this.healthCheckUrl = statelessStack.healthCheckUrl;
    this.route53ClientUrl = clientStack.route53ClientUrl;
  }
}
