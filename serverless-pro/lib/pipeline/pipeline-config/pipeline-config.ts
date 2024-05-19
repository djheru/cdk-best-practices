import { pascalCase } from "change-case";
import * as dotenv from "dotenv";
import {
  Account,
  EnvironmentConfig,
  Region,
  Stage,
} from "../pipeline-types/pipeline-types";

dotenv.config();

export const environments: Record<Stage, EnvironmentConfig> = {
  // allow developers to spin up a quick branch for a given PR they are working on e.g. pr-124
  // this is done with an npm run dev, not through the pipeline, and uses the values in .env
  [Stage.feature]: {
    env: {
      account:
        process.env.ACCOUNT || (process.env.CDK_DEFAULT_ACCOUNT as string),
      region: process.env.REGION || (process.env.CDK_DEFAULT_REGION as string),
    },
    stateful: {
      bucketName: `serverless-pro-${process.env.FEATURE}-bucket`.toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: parseInt(process.env.LAMBDA_MEM_SIZE || "128"),
    },
    stageName: pascalCase(process.env.FEATURE || Stage.feature),
  },
  [Stage.dev]: {
    env: {
      account: Account.dev,
      region: Region.california,
    },
    stateful: {
      bucketName: "serverless-pro-feature-dev-bucket-" + Account.dev,
    },
    stateless: {
      lambdaMemorySize: 128,
    },
    stageName: Stage.dev,
  },
  [Stage.staging]: {
    env: {
      account: Account.staging,
      region: Region.ohio,
    },
    stateful: {
      bucketName: "serverless-pro-staging-bucket-" + Account.staging,
    },
    stateless: {
      lambdaMemorySize: 512,
    },
    stageName: Stage.staging,
  },
  [Stage.prod]: {
    env: {
      account: Account.prod,
      region: Region.virginia,
    },
    stateful: {
      bucketName: "serverless-pro-prod-bucket-" + Account.prod,
    },
    stateless: {
      lambdaMemorySize: 1024,
    },
    stageName: Stage.prod,
  },
  [Stage.cicd]: {
    env: {
      account: Account.cicd,
      region: Region.virginia,
    },
    stateful: {
      bucketName: "serverless-pro-cicd-bucket-" + Account.cicd,
    },
    stateless: {
      lambdaMemorySize: 1024,
    },
    stageName: Stage.cicd,
  },
};
