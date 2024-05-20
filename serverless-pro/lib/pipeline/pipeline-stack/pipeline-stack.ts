import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { pascalCase } from 'change-case';
import { Construct } from 'constructs';
import { environments } from '../pipeline-config/pipeline-config';
import { PipelineStage } from '../pipeline-stage/pipeline-stage';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // we create our pipeline for the given branch and repository,
    // and add the various stages, passing through the config for
    // feature-dev, staging or production (prod with a manual approval step)

    // Source & build Stage - The source stage pulls in various types of code from a distributed version control system
    // https://pipelines.devops.aws.dev/application-pipeline/index.html
    const pipeline: pipelines.CodePipeline = new pipelines.CodePipeline(
      this,
      'PipelineStack',
      {
        crossAccountKeys: true,
        selfMutation: true,
        pipelineName: 'serverless-pro-pipeline',
        synth: new pipelines.ShellStep('Synth', {
          input: pipelines.CodePipelineSource.gitHub(
            'djheru/cdk-best-practices',
            'main'
          ),
          primaryOutputDirectory: './serverless-pro/cdk.out', // these are our immutable build assets
          // source stage
          commands: [
            'cd ./serverless-pro',
            'npm ci',
            'npx cdk synth',
            'npm run lint',
            'npm run test',
          ],
        }),
      }
    );

    // add the feature stage on its own without being in the pipeline
    // note: this is used purely for developer ephemeral environments
    new PipelineStage(
      this,
      pascalCase(`Feature-${environments.feature.stageName}`),
      {
        ...environments.feature,
      }
    );

    // add the development stage with the relevant environment config to the pipeline
    // this is the test stage (beta)
    const developmentStage: PipelineStage = new PipelineStage(
      this,
      'Development',
      {
        ...environments.dev,
      }
    );
    pipeline.addStage(developmentStage, {
      post: [
        new pipelines.ShellStep('HealthCheck', {
          envFromCfnOutputs: {
            HEALTH_CHECK_ENDPOINT: developmentStage.healthCheckUrl,
          },
          commands: ['curl -Ssf $HEALTH_CHECK_ENDPOINT'], // demo only basic sanity check
        }),
        new pipelines.ShellStep('IntegrationTests', {
          envFromCfnOutputs: {
            API_ENDPOINT: developmentStage.apiEndpointUrl,
          },
          // we run the postman basic api integration tests
          commands: [
            'npm install -g newman',
            'newman run ./tests/integration/integration-collection.json --env-var api-url=$API_ENDPOINT',
          ],
        }),
      ],
    });

    // add the staging stage with the relevant environment config
    // this is the test stage (gamma)
    const stagingStage: PipelineStage = new PipelineStage(this, 'Staging', {
      ...environments.staging,
    });
    pipeline.addStage(stagingStage, {
      post: [
        new pipelines.ShellStep('HealthCheck', {
          envFromCfnOutputs: {
            HEALTH_CHECK_ENDPOINT: stagingStage.healthCheckUrl,
          },
          commands: ['curl -Ssf $HEALTH_CHECK_ENDPOINT'], // demo only basic sanity check
        }),
        // you can optionally run integration tests in staging (gamma) too
        new pipelines.ShellStep('IntegrationTests', {
          envFromCfnOutputs: {
            API_ENDPOINT: stagingStage.apiEndpointUrl,
          },
          commands: [
            'npm install -g newman',
            'newman run ./tests/integration/integration-collection.json --env-var api-url=$API_ENDPOINT',
          ],
        }),
        // you can optionally run load tests in staging (gamma) too
        new pipelines.ShellStep('LoadTests', {
          envFromCfnOutputs: {
            API_ENDPOINT: stagingStage.apiEndpointUrl,
          },
          // we run the artillery load tests
          commands: [
            'npm install -g artillery',
            'artillery dino', // ensure that it is installed correctly
            'artillery run -e load ./tests/load/load.yml',
          ],
        }),
      ],
    });

    // add the prod stage with a manual approval step to the pipeline
    const prodStage: PipelineStage = new PipelineStage(this, 'Production', {
      ...environments.prod,
    });
    pipeline.addStage(prodStage, {
      pre: [
        new pipelines.ManualApprovalStep('PromoteToProd'), // manual approval step
      ],
      post: [
        new pipelines.ShellStep('HealthCheck', {
          envFromCfnOutputs: {
            HEALTH_CHECK_ENDPOINT: prodStage.healthCheckUrl,
          },
          commands: ['curl -Ssf $HEALTH_CHECK_ENDPOINT'], // demo only basic sanity check
        }),
      ],
    });
  }
}
