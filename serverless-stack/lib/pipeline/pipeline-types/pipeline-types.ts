export interface EnvironmentConfig {
  env: {
    account: string;
    region: string;
  };
  stageName: string;
  stateful: {
    bucketName: string;
    assetsBucketName: string;
  };
  stateless: {
    lambdaMemorySize: number;
    canaryNotificationEmail: string;
    randomErrorsEnabled: string;
  };
  client: {
    bucketName: string;
  };
  shared: {
    domainName: string;
    appConfigLambdaLayerArn: string;
    powerToolsMetricsNamespace: string;
    powerToolServiceName: string;
  };
}

export interface CiCdEnvironmentConfig {
  codestarConnectionArn: string;
  env: {
    account: string;
    region: string;
  };
}

export const enum Region {
  virginia = 'us-east-1',
  ohio = 'us-east-2',
  california = 'us-west-1',
}

export const enum Stage {
  feature = 'feature',
  staging = 'staging',
  prod = 'prod',
  dev = 'dev',
}

export const enum Account {
  feature = '190423078218',
  staging = '228708224037',
  prod = '276541279630',
  dev = '190423078218',
  cicd = '083171692404',
}
