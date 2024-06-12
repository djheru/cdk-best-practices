import { RemovalPolicy } from 'aws-cdk-lib';
import {
  Attribute,
  BillingMode,
  Table,
  TableEncryption,
  TableProps,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface SimpleTableProps
  extends Pick<TableProps, 'removalPolicy' | 'partitionKey'> {
  stageName: string;
  partitionKey: Attribute;
  removalPolicy: RemovalPolicy;
}

type FixedSimpleTableProps = Omit<TableProps, 'removalPolicy' | 'partitionKey'>;

export class SimpleTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: SimpleTableProps) {
    super(scope, id);

    const fixedProps: FixedSimpleTableProps = {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      contributorInsightsEnabled: true,
    };

    this.table = new Table(this, id, {
      // fixed props
      ...fixedProps,
      // custom props
      ...props,
    });
  }
}
