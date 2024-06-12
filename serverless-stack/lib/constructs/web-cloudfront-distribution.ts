import { RemovalPolicy } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  CloudFrontWebDistribution,
  CloudFrontWebDistributionProps,
  HttpVersion,
  OriginAccessIdentity,
  PriceClass,
  SSLMethod,
  SecurityPolicyProtocol,
  ViewerCertificate,
} from 'aws-cdk-lib/aws-cloudfront';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface WebCloudFrontDistributionProps
  extends Pick<CloudFrontWebDistributionProps, 'enabled'> {
  stageName: string;
  removalPolicy: RemovalPolicy;
  enabled: boolean;
  certificate: Certificate;
  originAccessIdentity: OriginAccessIdentity;
  bucket: Bucket;
  subDomain: string;
}

type FixedWebCloudFrontDistributionProps = Omit<
  CloudFrontWebDistributionProps,
  'enabled'
>;

export class WebCloudFrontDistribution extends Construct {
  public readonly distribution: CloudFrontWebDistribution;
  private readonly bucket: Bucket;
  private readonly originAccessIdentity: OriginAccessIdentity;

  constructor(
    scope: Construct,
    id: string,
    props: WebCloudFrontDistributionProps
  ) {
    super(scope, id);

    this.bucket = props.bucket;
    this.originAccessIdentity = props.originAccessIdentity;

    const fixedProps: FixedWebCloudFrontDistributionProps = {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: this.bucket,
            originAccessIdentity: this.originAccessIdentity,
          },
          behaviors: [{ isDefaultBehavior: true }],
        },
      ],
      comment: `${props.stageName} client web distribution`,
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      // we need to pull in the certificate you have already created for your own domain
      viewerCertificate: ViewerCertificate.fromAcmCertificate(
        props.certificate,
        {
          securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
          sslMethod: SSLMethod.SNI,
          aliases: [props.subDomain],
        }
      ),
      httpVersion: HttpVersion.HTTP3,
    };

    this.distribution = new CloudFrontWebDistribution(this, id, {
      // fixed props
      ...fixedProps,
      // custom props
      ...props,
    });
  }
}
