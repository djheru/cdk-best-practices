export interface EnvironmentConfig {
  env: {
    account: string;
    region: string;
  };
  stageName: string;
  stateful: {
    bucketName: string;
  };
  stateless: {
    lambdaMemorySize: number;
  };
}

export const enum Region {
  virginia = "us-east-1",
  ohio = "us-east-2",
  california = "us-west-1",
}

export const enum Stage {
  feature = "feature",
  staging = "staging",
  prod = "prod",
  dev = "dev",
  cicd = "cicd",
}

export const enum Account {
  feature = "11111111111",
  staging = "22222222222",
  prod = "33333333333",
  dev = "44444444444",
  cicd = "55555555555",
}
