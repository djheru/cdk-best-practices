import * as cdk from 'aws-cdk-lib';

import { FeatureFlagConfig, environments } from './config/config';

import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { AppConfigApplication } from '../../constructs';
import { Stage } from '../../pipeline/pipeline-types/pipeline-types';
import { schema } from './config/config.schema';

export interface FeatureFlagStackProps extends cdk.StackProps {
  stageName: string;
}

export class FeatureFlagStack extends cdk.Stack {
  public readonly appConfigApplicationRef: string;
  public readonly appConfigEnvName: string;
  public readonly appConfigEnvRef: string;
  public readonly appConfigConfigurationProfileRef: string;

  constructor(scope: Construct, id: string, props: FeatureFlagStackProps) {
    super(scope, id, props);

    const stage = [Stage.dev, Stage.staging, Stage.prod].includes(
      props.stageName as Stage
    )
      ? props.stageName
      : Stage.feature;

    const appConfigApplication = new AppConfigApplication(
      this,
      'AppConfigApplication',
      {
        stageName: props.stageName,
        growthFactor: 100,
        deploymentDurationInMinutes: 0,
        growthType: 'LINEAR',
        description: `${props.stageName} application feature flags`,
        validatorSchema: JSON.stringify(schema),
        content: JSON.stringify(environments[stage as keyof FeatureFlagConfig]),
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    this.appConfigApplicationRef = appConfigApplication.application.ref;
    this.appConfigEnvName = appConfigApplication.applicationEnvironment.name;
    this.appConfigConfigurationProfileRef =
      appConfigApplication.applicationConfigurationProfile.ref;
    this.appConfigEnvRef = appConfigApplication.applicationEnvironment.ref;

    // cdk nag check and suppressions
    Aspects.of(this).add(new AwsSolutionsChecks({ verbose: true }));
    NagSuppressions.addStackSuppressions(this, []);
  }
}
