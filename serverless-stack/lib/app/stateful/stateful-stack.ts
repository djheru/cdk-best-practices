import * as cdk from 'aws-cdk-lib';
import { Aspects, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { SimpleTable } from '../../constructs';

export interface StatefulStackProps extends cdk.StackProps {
  assetsBucketName: string;
  stageName: string;
  bucketName: string;
}

export class StatefulStack extends cdk.Stack {
  public readonly assetsBucket: s3.Bucket;
  public readonly bucket: s3.Bucket;
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StatefulStackProps) {
    super(scope, id, props);

    // create the s3 bucket for invoices
    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: props.bucketName, // this is passed through per env from config
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // create the bucket for the canary outputs
    this.assetsBucket = new s3.Bucket(this, 'CanaryAssetsBucket', {
      bucketName: props.assetsBucketName,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // create the dynamodb table
    this.table = new SimpleTable(this, 'Table', {
      stageName: props.stageName,
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
    }).table;

    // add the global secondary index which allows us to query
    // all stores based on the record type
    this.table.addGlobalSecondaryIndex({
      indexName: 'recordTypeIndex',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    Aspects.of(this).add(new AwsSolutionsChecks({ verbose: true }));
    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-S1',
          reason: `Rule suppression for 'The S3 Bucket has server access logs disabled'`,
        },
        {
          id: 'AwsSolutions-S2',
          reason: `Rule suppression for 'The S3 Bucket does not have public access restricted and blocked. The bucket should have public access restricted and blocked to prevent unauthorized access'`,
        },
        {
          id: 'AwsSolutions-S10',
          reason: `Rule suppression for 'The S3 Bucket or bucket policy does not require requests to use SSL'`,
        },
        {
          id: 'AwsSolutions-DDB3',
          reason: `Rule suppression for 'The DynamoDB table does not have Point-in-time Recovery enabled'`,
        },
        {
          id: 'AwsSolutions-DDB3',
          reason: `Rule suppression for 'The DynamoDB table does not have Point-in-time Recovery enabled'`,
        },
      ],
      true
    );
  }
}
