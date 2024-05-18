import * as cdk from "aws-cdk-lib";
import * as pipelines from "aws-cdk-lib/pipelines";

import { Construct } from "constructs";
import { environments } from "../pipeline-config/pipeline-config";
import { PipelineStage } from "../pipeline-stage/pipeline-stage";

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
      "PipelineStack",
      {
        crossAccountKeys: true,
        selfMutation: true,
        pipelineName: "serverless-pro-pipeline",
        synth: new pipelines.ShellStep("Synth", {
          input: pipelines.CodePipelineSource.gitHub(
            "leegilmorecode/Serverless-AWS-CDK-Best-Practices-Patterns",
            "main"
          ),
          primaryOutputDirectory: "./serverless-pro/cdk.out", // these are our immutable build assets
          // source stage
          commands: [
            "cd ./serverless-pro",
            "npm ci",
            "npx cdk synth",
            "npm run test",
          ],
        }),
      }
    );

    // add the develop stage on its own without being in the pipeline
    // note: this is used purely for developer ephemeral environments
    new PipelineStage(this, `Develop-${environments.develop.stageName}`, {
      ...environments.develop,
    });

    // add the feature-dev stage with the relevant environment config to the pipeline
    // this is the test stage (beta)
    const featureStage: PipelineStage = new PipelineStage(this, "feature", {
      ...environments.feature,
    });
    pipeline.addStage(featureStage, {
      post: [
        new pipelines.ShellStep("HealthCheck", {
          envFromCfnOutputs: {
            HEALTH_CHECK_ENDPOINT: featureStage.healthCheckUrl,
          },
          commands: ["curl -Ssf $HEALTH_CHECK_ENDPOINT"], // demo only basic sanity check
        }),
      ],
    });

    // add the staging stage with the relevant environment config
    // this is the test stage (gamma)
    const stagingStage: PipelineStage = new PipelineStage(this, "Staging", {
      ...environments.staging,
    });
    pipeline.addStage(stagingStage, {
      post: [
        new pipelines.ShellStep("HealthCheck", {
          envFromCfnOutputs: {
            HEALTH_CHECK_ENDPOINT: stagingStage.healthCheckUrl,
          },
          commands: ["curl -Ssf $HEALTH_CHECK_ENDPOINT"], // demo only basic sanity check
        }),
      ],
    });

    // add the prod stage with a manual approval step to the pipeline
    const prodStage: PipelineStage = new PipelineStage(this, "Prod", {
      ...environments.prod,
    });
    pipeline.addStage(prodStage, {
      pre: [
        new pipelines.ManualApprovalStep("PromoteToProd"), // manual approval step
      ],
      post: [
        new pipelines.ShellStep("HealthCheck", {
          envFromCfnOutputs: {
            HEALTH_CHECK_ENDPOINT: prodStage.healthCheckUrl,
          },
          commands: ["curl -Ssf $HEALTH_CHECK_ENDPOINT"], // demo only basic sanity check
        }),
      ],
    });
  }
}
