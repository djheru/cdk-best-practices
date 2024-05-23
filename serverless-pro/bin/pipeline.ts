#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { cicdEnvironment } from '../lib/pipeline/pipeline-config/pipeline-config';
import { PipelineStack } from '../lib/pipeline/pipeline-stack/pipeline-stack';

const app = new cdk.App();

// this is the main pipeline entry point
// including the environment where the pipeline itself will be created
new PipelineStack(app, 'ServerlessPro', {
  env: {
    region: cicdEnvironment.env.region,
    account: cicdEnvironment.env.account,
  },
});

app.synth();
