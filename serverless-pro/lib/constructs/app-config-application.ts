import { RemovalPolicy } from 'aws-cdk-lib';
import {
  CfnApplication,
  CfnConfigurationProfile,
  CfnDeployment,
  CfnDeploymentStrategy,
  CfnEnvironment,
  CfnHostedConfigurationVersion,
  CfnHostedConfigurationVersionProps,
} from 'aws-cdk-lib/aws-appconfig';
import { Construct } from 'constructs';

interface AppConfigApplicationProps
  extends Pick<CfnHostedConfigurationVersionProps, 'content' | 'description'> {
  stageName: string;
  removalPolicy: RemovalPolicy;
  deploymentDurationMinutes: number;
  growthFactor: number;
  growthType: 'EXPONENTIAL' | 'LINEAR';
  description: string;
  validatorSchema: string;
}

export class AppConfigApplication extends Construct {
  public readonly application: CfnApplication;
  public readonly applicationEnvironment: CfnEnvironment;
  public readonly featureFlags: CfnHostedConfigurationVersion[];
  public readonly applicationConfigurationProfile: CfnConfigurationProfile;

  private readonly deploymentStrategy: CfnDeploymentStrategy;
  private readonly deployment: CfnDeployment;

  constructor(scope: Construct, id: string, props: AppConfigApplicationProps) {
    super(scope, id);

    this.featureFlags = [];
    // In AWS AppConfig , an application is simply an organizational construct like a folder.
    // This organizational construct has a relationship with some unit of executable code.
    // For example, you could create an application called MyMobileApp to organize and manage configuration
    // data for a mobile application installed by your users.
    this.application = new CfnApplication(this, id, {
      name: `${props.stageName} AppConfig Application`,
      description: props.description,
    });
    this.application.applyRemovalPolicy(props.removalPolicy);

    // Creates an Environment, which is a logical deployment group of AppConfig targets
    // such as Applications in a Staging or Prod environment
    this.applicationEnvironment = new CfnEnvironment(this, id + 'Environment', {
      applicationId: this.application.ref,
      name: `${props.stageName}AppConfigEnvironment`,
      description: props.description,
    });
    this.applicationEnvironment.applyRemovalPolicy(props.removalPolicy);

    // creates a configuration profile that enables AWS AppConfig to access the configuration source
    this.applicationConfigurationProfile = new CfnConfigurationProfile(
      this,
      id + 'ConfigProfile',
      {
        applicationId: this.application.ref,
        name: `${props.stageName}AppConfigConfigurationProfile`,
        description: props.description,
        locationUri: 'hosted',
        type: 'AWS.AppConfig.FeatureFlags',
        validators: [
          {
            content: props.validatorSchema,
            type: 'JSON_SCHEMA',
          },
        ],
      }
    );
    this.applicationConfigurationProfile.applyRemovalPolicy(
      props.removalPolicy
    );

    // creates an AWS AppConfig deployment strategy. A deployment strategy defines
    // important criteria for rolling out your configuration to the designated targets.
    this.deploymentStrategy = new CfnDeploymentStrategy(
      this,
      id + 'DeploymentStrategy',
      {
        deploymentDurationInMinutes: props.deploymentDurationMinutes,
        growthFactor: props.growthFactor,
        name: `${props.stageName}DeploymentStrategy`,
        description: `${props.stageName} Deployment Strategy`,
        growthType: props.growthType,
        replicateTo: 'NONE',
      }
    );
    this.deploymentStrategy.applyRemovalPolicy(props.removalPolicy);

    // Create a new configuration in the AWS AppConfig hosted configuration store.
    // Configurations must be 1 MB or smaller.
    const featureFlagHostedConfiguration = new CfnHostedConfigurationVersion(
      this,
      id + 'HostedConfiguration',
      {
        applicationId: this.application.ref,
        configurationProfileId: this.applicationConfigurationProfile.ref,
        content: props.content,
        contentType: 'application/json',
        description: props.description,
      }
    );
    featureFlagHostedConfiguration.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Starting a deployment in AWS AppConfig calls the StartDeployment API action.
    // This call includes the IDs of the AWS AppConfig application, the environment, the configuration profile,
    // and (optionally) the configuration data version to deploy.
    this.deployment = new CfnDeployment(this, id + 'Deployment', {
      applicationId: this.application.ref,
      deploymentStrategyId: this.deploymentStrategy.ref,
      configurationProfileId: this.applicationConfigurationProfile.ref,
      environmentId: this.applicationEnvironment.ref,
      description: `${props.stageName} Deployment`,
      configurationVersion: featureFlagHostedConfiguration.ref,
    });
    this.deployment.applyRemovalPolicy(props.removalPolicy);
  }
}
