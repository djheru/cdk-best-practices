import { RemovalPolicy } from 'aws-cdk-lib';
import { OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { Bucket, BucketProps } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface WebBucketProps
  extends Pick<BucketProps, 'removalPolicy' | 'bucketName'> {
  stageName: string;
  removalPolicy: RemovalPolicy;
  bucketName: string;
}

type FixedWebBucketProps = Omit<BucketProps, 'removalPolicy' | 'bucketName'>;

export class WebBucket extends Construct {
  public readonly bucket: Bucket;
  public readonly originAccessIdentity: OriginAccessIdentity;

  constructor(scope: Construct, id: string, props: WebBucketProps) {
    super(scope, id);

    const fixedProps: FixedWebBucketProps = {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
    };

    this.bucket = new Bucket(this, id, {
      // fixed props
      ...fixedProps,
      // custom props
      ...props,
    });

    this.originAccessIdentity = new OriginAccessIdentity(this, id + 'OAI', {
      comment: `${id} WebBucket OAI`,
    });
    this.bucket.grantRead(this.originAccessIdentity);
  }
}
