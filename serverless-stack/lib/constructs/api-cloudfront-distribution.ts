import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  DistributionProps,
  HttpVersion,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  PriceClass,
  SSLMethod,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { RestApiOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

interface ApiCloudFrontDistributionProps
  extends Pick<DistributionProps, 'comment' | 'priceClass' | 'enabled'> {
  stageName: string;
  certificate: Certificate;
  api: RestApi;
  apiSubDomain: string;
  priceClass: PriceClass;
  enabled: boolean;
  comment: string;
}

type FixedApiCloudFrontDistributionProps = Omit<
  DistributionProps,
  'comment' | 'priceClass' | 'enabled'
>;

export class ApiCloudFrontDistribution extends Construct {
  public readonly distribution: Distribution;
  private readonly api: RestApi;

  constructor(
    scope: Construct,
    id: string,
    props: ApiCloudFrontDistributionProps
  ) {
    super(scope, id);

    this.api = props.api;

    const fixedProps: FixedApiCloudFrontDistributionProps = {
      httpVersion: HttpVersion.HTTP3,
      defaultBehavior: {
        origin: new RestApiOrigin(this.api),
        allowedMethods: AllowedMethods.ALLOW_ALL,
        compress: true,
        cachePolicy: new CachePolicy(this, id + 'CachePolicy', {
          comment: 'Policy with caching disabled',
          enableAcceptEncodingGzip: false,
          enableAcceptEncodingBrotli: false,
          defaultTtl: Duration.seconds(0),
          maxTtl: Duration.seconds(0),
          minTtl: Duration.seconds(0),
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: new OriginRequestPolicy(
          this,
          id + 'RequestPolicy',
          {
            comment: 'Policy to forward all query parameters but no headers',
            headerBehavior: OriginRequestHeaderBehavior.none(),
            queryStringBehavior: OriginRequestQueryStringBehavior.all(),
          }
        ),
      },
      domainNames: [props.apiSubDomain],
      sslSupportMethod: SSLMethod.SNI,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      certificate: props.certificate,
    };

    this.distribution = new Distribution(this, id, {
      //fixed props
      ...fixedProps,
      //custom props
      priceClass: props.priceClass
        ? props.priceClass
        : PriceClass.PRICE_CLASS_100,
      enabled: props.enabled ? props.enabled : true,
    });

    this.distribution.applyRemovalPolicy(RemovalPolicy.DESTROY);
  }
}
