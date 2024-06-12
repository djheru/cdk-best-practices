import {
  Cors,
  EndpointType,
  MethodLoggingLevel,
  RestApi,
  RestApiProps,
} from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

interface ApiProps extends Pick<RestApiProps, 'description' | 'deploy'> {
  stageName: string;
  description?: string;
  deploy?: boolean;
}

type FixedApiProps = Omit<RestApiProps, 'description' | 'deploy'>;

export class Api extends Construct {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const fixedProps: FixedApiProps = {
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowCredentials: true,
        allowMethods: ['OPTIONS', 'POST', 'GET'],
        allowHeaders: ['*'],
      },
      endpointTypes: [EndpointType.REGIONAL],
      cloudWatchRole: true,
      deployOptions: {
        stageName: props.stageName,
        loggingLevel: MethodLoggingLevel.INFO,
      },
    };

    this.api = new RestApi(this, id + 'Api', {
      // fixed props
      ...fixedProps,
      // custom props (stageName, description, deploy only)
      description: props.description
        ? props.description
        : `Serverless Stack API ${props.stageName}`,
      deploy: props.deploy !== undefined ? props.deploy : true,
    });
  }
}
