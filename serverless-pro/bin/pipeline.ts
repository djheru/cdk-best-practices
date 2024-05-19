#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";

import { PipelineStack } from "../lib/pipeline/pipeline-stack/pipeline-stack";
import { environments } from "../lib/pipeline/pipeline-config/pipeline-config";

const app = new cdk.App();

// this is the main pipeline entry point
// including the environment where the pipeline itself will be created
new PipelineStack(app, "ServerlessPro", {
  env: {
    region: environments.cicd.env.region,
    account: environments.cicd.env.account,
  },
});

app.synth();
