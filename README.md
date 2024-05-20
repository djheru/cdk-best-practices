# Serverless AWS CDK Pipeline Best Practices and Patterns

Notes and example code for this article: https://blog.serverlessadvocate.com/serverless-aws-cdk-pipeline-best-practices-patterns-part-1-ab80962f109d

## Preface

- We should create different stacks per environment within the CDK app
- We should split stateful (DB/S3) and stateless (lambda) resources into separate stacks
- We should allow for different configurations per stack, without the use of environment variables (aside from ephemeral envs)
- We should synthesize the assets once, allowing for a deterministic immutable build to be deployed through all environments

# Part 1 - Setting up the Pipeline

This information is taken from

- [Deployment Pipeline Reference Architecture](https://pipelines.devops.aws.dev/)
- [Best practices for developing cloud applications with AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-apps)
- [The CDK Handbook](https://thecdkbook.com/)

## Example Application

1. Customers use API Gateway to create and retrieve an order
2. The "get order" lambda retruns an order by ID
3. The "create order" lambda creates the order and returns the order ID
4. The order data is stored in DynamoDB
5. An invoice is stored in S3

## Common Vocabulary

- **Workloads** - A workload is a set of components that together deliver business value (_essentially a service or application_). A workload is usually the level of detail that business and technology leaders communicate about. Examples of workloads are marketing websites, e-commerce websites, the back-end of a moble app, analytic platforms, etc.
- **Environment** - An environment is an isolated target for deployment and testing of a workload and its dependencies. Essentially its Region + Account.
- **Cloud Assembly** - This is the output of the synthesis (_build_) operation. It is essentially a set of files including CloudFormation and the `manifest.json` file that defines the set of instructions needed to deploy the assembly.
- **Stage** - An '_abstract application modelling unit_' consisting of one or more stacks that should be deployed together. You can create multiple instances of a stage to model multiple copies of the application which are deployed to different environments _with their own configuration_ as shown below:

![Relationship between pipeline, workload, stage, stack, cloud assembly and environment](./assets/stage.webp)

## Key considerations and code walkthrough

### All environment specific stacks (stages) in code

One of the key differences between AWS CDK and CloudFormation is that AWS CDK should contain each stage/environment with its own configuration in the CDK app, instead of creating a single artifact that can be parameterized.

> In traditional AWS CloudFormation scenarios, your goal is to produce a single artifact that is parameterized so that it can be deployed to various target environments after applying configuration values specific to those environments. In the CDK, you can, and should, build that configuration into your source code. Create a stack for your production environment, and create a separate stack for each of your other stages.

> When you synthesize your application, the cloud assembly created in the cdk.out folder contains a separate template for each environment. Your entire build is deterministic. There are no out-of-band changes to your application, and any given commit always yields the exact same AWS CloudFormation template and accompanying assets. This makes unit testing much more reliable. — [https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)

#### Key Outcome

- Create different stages and therefore stacks for each specific environment i.e. ProdStack, FeatureDevStack, StagingStack etc.

#### Disadvantages

- Although this is best practice, you may find that there is an overhead in the initial creation of the multiple stacks

---

### Configurations should be in code, not using environment variables

Within your CDK apps, you should add your configuration as actual code as opposed to passing through environment variables. This is discussed in the best practices paper also:

> Put the configuration values for each stack in the code. Use services like Secrets Manager and Systems Manager Parameter Store for sensitive values that you don't want to check in to source control, using the names or ARNs of those resources.

> Environment variable lookups inside constructs and stacks are a common anti-pattern. Both constructs and stacks should accept a properties object to allow for full configurability completely in code. Doing otherwise introduces a dependency on the machine that the code will run on, which creates yet more configuration information that you have to track and manage.

> In general, environment variable lookups should be limited to the top level of an AWS CDK app. They should also be used to pass in information that’s needed for running in a development environment

Looking through `pipeline-config.ts` we can see that there's a `feature` stage that does use environment variables, as this is specifically for developers to create their own ephemeral environments.

For develop/staging/production, we have specific configurations for each, which are synthesized into the cloud assembly once as an immutable build.

#### Key Outcome

- As each of our environments (_stages_) may need a differing configuration, we should create an object to pas through as props to the given stack. As discussed, the use of environement variables within stacks is a known anti-pattern. Also, the configuration can be tested using Jest snapshots, as it is deterministic at build time.

#### Disadvantages

- None - Using environment variables is no more or less onerous than using configuration as code; as well as environment variables being an anti-pattern.

---

### Stateless vs Stateful Stacks

When we build our AWS CDK applications, we should ideally split each environment between stateless and stateful stacks.

> Consider keeping stateful resources (like databases) in a separate stack from stateless resources. You can then turn on termination protection on the stateful stack. This way, you can freely destroy or create multiple copies of the stateless stack without risk of data loss.

> Stateful resources are more sensitive to construct renaming — renaming leads to resource replacement. Therefore, don’t nest stateful resources inside constructs that are likely to be moved around or renamed (unless the state can be rebuilt if lost, like a cache). This is another good reason to put stateful resources in their own stack. - [https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)

#### Key Outcome

- Although this means for each stage we have two stacks, it does make sense to split your stacks from both a security perspective, as well as keeping code that changes often away from code that rarely changes. This allows developers to concentrate mainly on one area of the code base, and reduce cognitive load.

#### Disadvantages

- The only disadvantage here is that you initially create two stacks per environment over one which could be argued is more work; however the benefits for developers after this far outweigh this.

---

### Shared Constructs

Shared constructs should be used within your organisation to reduce duplication of effort, make your solutions more secure, and reduce cognitive load on teams.

1. We want to reduce the cognitive load on development teams, and we can easily wrap complex patterns and reference architecture into composable units.
2. They should be deployed as a versioned code artefact to a shared repository
3. Key areas of the business, such as AppSec, can influence the L3/L4 constructs; as well as embedding dashboards for SREs, for example.

> When packages begin to be used in multiple applications, move them to their own repository. This way, the packages can be referenced by application build systems that use them, and they can also be updated on cadences independent of the application lifecycles. However, at first it might make sense to put all shared constructs in one repository.

#### Key Outcome

- Shared constructs should be used within your organization to reduce duplication of effort, make solutions more secure, and reduce cognitive load on teams. They should be versioned and deployed to a shared library/repository

#### Disadvantages

- None - No reason to duplicate code across an organization. The only overheads are versioning and publishing

---

### Build one set of deterministic assets

Once we have split our app into multiple stacks for each environment, we need to consider how we build and deploy the correct version to each environment. CDK Pipelines manages this for us under the hood.

> When you synthesize your application, the cloud assembly created in the cdk.out folder contains a separate template for each environment. Your entire build is deterministic. There are no out-of-band changes to your application, and any given commit always yields the exact same AWS CloudFormation template and accompanying assets. This makes unit testing much more reliable.

We can achieve this when we have our stages modelled as separate stacks, as when we perform a cdk synth we are essentially building one set of immutable deterministic assets (cloud assembly) for all environments.

> The source code should only be built and packaged once. The packaged artifact should then be staged in a registry with appropriate metadata and ready for deployment to any environment. Build artifacts only once and then promote them through the pipeline. The output of the pipeline should be versioned and able to be traced back to the source it was built from and from the business requirements that defined it. - https://pipelines.devops.aws.dev/

- We use pipeline-stack.ts to create all of our stages in code. We add dev, stage, and prod to the pipeline, but not the feature stage

Under the hood, CDK pipeline is doing the following for us:

```
# Synthesize all templates once to the cdk.out as one build
cdk synth

# Deploy our feature-dev stage and reference the assembly folder
cdk deploy --app 'cdk.out/' Development

# Do some tests here and approve stage

# Deploy our staging stage
cdk deploy --app 'cdk.out/' Staging

# Do some tests here and approve stage

# Deploy our prod stage (potentially after a manual approval step)
cdk deploy --app 'cdk.out/' Prod
```

**Note**: Under the hood the CDK Pipeline is performing a 'cdk deploy'
for each of the stages using the --app parameter which allows you
to deploy specific stacks within the 'cdk.out' folder i.e. although
cdk synth is building all environments, we can specifically deploy
one environment at a time.

#### Key Outcome

- We can use the `cdk deploy` command with the `--app` flag to allow us to deploy a given environment with the cloud assembly that contains all of the environments (i.e. development, staging, prod) or we can allow the CDK Pipeline to manage it for us as part of the pipeline process

#### Disadvantages

- You could argue that it's easier to just perform a `cdk deploy` with the given stack names at each stage, as opposed to the initial synth and passing the immutable assets through the pipeline. IMO the benefits outweigh outweigh the extra initial setup, since the best practice is to produce one set of immutable assets at the start of the pipeline.

---

### AWS account per environment, per service

For this one, we will keep high level, but it is standard practice to have an AWS account per environment, per service.

> Best practice is for each environment to run in a separate AWS account. - [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)

This is therefore something we need to consider when deploying our stages, as the configuration values need to be passed through into the stage props as discussed earlier (allowing us to deploy to different accounts):

```
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
}

export const enum Account {
  feature = "11111111111",
  staging = "22222222222",
  prod = "33333333333",
  dev = "44444444444",
}
```

This allows us to use this static configuration when creating the stage specific application configuration to be passed into the pipeline as shown below:

```
const developmentStage: PipelineStage = new PipelineStage(
  this,
  "Development",
  {
    ...environments.dev,
  }
);
```

#### Key Outcome

- We should have a dedicated AWS account per environment for each of our services, which is considered a standard practice in the industry. We should pass in these account details as stage props when deploying to multiple accounts

#### Disadvantages

- None - Accounts are free, it's a best practice

---

### Ephemeral Environments

One of the key tenants of Serverless is that you pay for use, so it makes it easy and quick to deploy temporary ephemeral environments when needed; for example developer testing or within pipelines for e2e tests. How do we manage this if we have environment specific configuration which is static?

We can achieve this by only allowing the use of environment variables for ephemeral environments, whereby the stage can be deployed to an environment direct from the developers machine using dynamic values:

```
    // add the feature stage on its own without being in the pipeline
    // note: this is used purely for developer ephemeral environments
    new PipelineStage(this, `feature-${environments.feature.stageName}`, {
      ...environments.feature,
    });
```

Then, we can pull in the required environment variables at build time within the same `pipeline-config.ts` file as shown below

```
  // allow developers to spin up a quick branch for a given PR they are working on e.g. pr-124
  // this is done with an npm run dev, not through the pipeline, and uses the values in .env
  [Stage.feature]: {
    env: {
      account:
        process.env.ACCOUNT || (process.env.CDK_DEFAULT_ACCOUNT as string),
      region: process.env.REGION || (process.env.CDK_DEFAULT_REGION as string),
    },
    stateful: {
      bucketName:
        `serverless-pro-${process.env.PR_NUMBER}-bucket`.toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: parseInt(process.env.LAMBDA_MEM_SIZE || "128"),
    },
    stageName: process.env.PR_NUMBER || Stage.feature,
  },
```

This pulls in values from a `.env` file

```
PR_NUMBER="PR-123"
LAMBDA_MEM_SIZE="128"
ACCOUNT="1111111111"
REGION="us-west-1"
```

The ephemeral environment can be deployed via the following npm script:

```
"deploy:feature": "cdk deploy ServerlessPro/FeatureIssue123/StatefulStack ServerlessPro/FeatureIssue123/StatefulStack"
```

**TODO:** We could look at a shell script to pull in the Feature label

#### Key Outcome

- We will always need the flexibility of creating one-off ephemeral environments for developers, and this allows us to do it dynamically outside of the pipeline

#### Disadvantages

- Developers need to remember to tear down their environments when they are done with them

---

### `cdk.context.json` used for dynamic lookups only

One of the outputs from a cdk synth is the CDK managedcdk.context.json file, which is described as:

> The CDK Toolkit uses context to cache values retrieved from your AWS account during synthesis. Values include the Availability Zones in your account or the Amazon Machine Image (AMI) IDs currently available for Amazon EC2 instances. Because these values are provided by your AWS account, they can change between runs of your CDK application. This makes them a potential source of unintended change. The CDK Toolkit’s caching behaviour “freezes” these values for your CDK app until you decide to accept the new values.

> The AWS CDK includes a mechanism called context providers to record a snapshot of non-deterministic values. This allows future synthesis operations to produce exactly the same template as they did when first deployed.

> The only changes in the new template are the changes that you made in your code. When you use a construct’s .fromLookup() method, the result of the call is cached in cdk.context.json. You should commit this to version control along with the rest of your code to make sure that future executions of your CDK app use the same value. - [https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-apps](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html#best-practices-apps)

An example of when the cdk.context.json file is populated would be through the following code as this is essentially a lookup on values that _could_ change and **are not deterministic**:

```
const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
  vpcId: 'vpc-id-111111111',
});
```

It would be easy to add all of our environment specific configuration options directly to the cdk.context.json file and read in the values at synth time; however, **the file is automatically generated and managed solely by the CDK**, so the best practice states:

> Cached context values are managed by the AWS CDK and its constructs, including constructs you may write. Do not add or change cached context values by manually editing files. It can be useful, however, to review cdk.context.json occasionally to see what values are being cached.

> Context values that don't represent cached values should be stored under the context key of cdk.json. This way, they won't be cleared when cached values are cleared. - [https://docs.aws.amazon.com/cdk/v2/guide/context.html](https://docs.aws.amazon.com/cdk/v2/guide/context.html)

Based on the above, we could potentially add environment specific context (config) values to the cdk.json file as they don’t represent cached values, and won’t be cleared down with the following command:

```
cdk context --clear
```

There is one big issue for me with using this option: IntelliSense. This is something that you won’t get with using the cdk.json file as you would need to use the following code, or similar, to get a value at synth time in code based on environment:

`app.node.tryGetContext('prod').bucketName`

When we have a large number of configuration properties this could lead to frustration and errors in our stack code, as opposed to having a typed object which can be used in code with Intellisense features.

Another benefit of this approach as discussed earlier is unit testing the configuration using Jest snapshots as shown below:

```
import { environments } from './pipeline-config';

// the config is deterministic so we can test this in our code
describe('pipeline-config', () => {
  it('should return the correct config for feature-dev', () => {
    expect(environments.featureDev).toMatchSnapshot();
  });

  it('should return the correct config for staging', () => {
    expect(environments.staging).toMatchSnapshot();
  });

  it('should return the correct config for prod', () => {
    expect(environments.prod).toMatchSnapshot();
  });
});
```

This is why personally I would go with the approach of the environment specific configuration being typed using TypeScript, which also makes for ease of testing and validation where required too.

#### Key Outcome

- Because they're part of the application state, `cdk.json` and `cdk.context.json` should be committed to source control along with the rest of the source code. Allow the CDK to manage dynamic values.

- We could potentially use the `cdk.json` file to hold our non-dynamic environment configuration values, but then we can't use Intellisense or type safety

#### Disadvantages

- One disadvantage could be having configuration values in two places, i.e. a typed object file as well as the `cdk.json` file. This would be one for coding standards and ways or working in your organisation I would say personally (_agree on one and stick to it!_)

---

---

# Part 2 - Pipeline Testing, Manual Approval, Database Deploys and SAST Tooling

## Example Application Updates

The example application created in part 1 will be updated to add the additional refinements:

1. Developers commit changes to the code and push to GitHub. At this build stage, we run unit testing, linting, formatting, and SAST on pre-commit

2. A webhook in GitHub invokes our CDK Pipeline with the exact commit information

3. The AWS CDK Pipeline is self-mutating, so any changes to pipeline code are deployed during a self-update process.

4. CodePipeline is invoked to run the actual pipeline now that it has been updated. This is across our 3 stages (Development, Staging, and Production). This is where we perform our tests

5. As part of this pipeline, a custom resource invokes a lambda function which seeds our configuration data to DynamoDB (store data configuration)

6. The pipeline performs integration tests using Postman and Newman, as well as load testing with Artillery.

## Key Considerations and Code Walkthrough

In part 2 we will be updating the application, focusing on Build, Test and Staging stages.

### Build Stage

#### Code Quality

> Run various automated static analysis tools that generate reports on code quality, coding standards, security, code coverage, and other aspects according to the team and/or organization’s best practices. AWS recommends that teams fail the build when important practices are violated (e.g., a security violation is discovered in the code). These checks usually run in seconds. Examples of tools to measure code quality include but are not limited to Amazon CodeGuru, SonarQube, black, and ESLint - [https://pipelines.devops.aws.dev/application-pipeline/index.html#build](https://pipelines.devops.aws.dev/application-pipeline/index.html#build)

In this example, we will use eslint, tslint and prettier to ensure that we have code quality standards and a style guide.

```sh
npm install --save-dev \
  prettier@2 \
  eslint@8 \
  @typescript-eslint/parser@5 \
  @typescript-eslint/eslint-plugin@5 \
  eslint-config-prettier@8 \
  eslint-plugin-prettier@4
```

Create ESLint config file `.eslintrc`

```json
{
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "extends": [
    "prettier",
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "plugins": ["prettier", "@typescript-eslint"],
  "rules": {
    "prettier/prettier": ["error"],
    "@typescript-eslint/no-unused-vars": "error"
  }
}
```

Now we can add the following lint commands to the package.json scripts:

```json
{
  "lint": "eslint --ext .ts .",
  "lint:fix": "eslint --fix --ext .ts ."
}
```

Now, add the `.prettierrc.json` and `.prettierignore` files

```json
{
  "trailingComma": "es5",
  "semi": true,
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

```
# Ignore artifacts:
build
coverage
cdk.out
tsconfig.json
```

#### Running the scripts automatically on pre-commit

We will use [Husky](https://www.npmjs.com/package/husky) to automatically run these scripts on pre-commit.

```
npm i --save-dev husky@8
```

Now we can add the commands to the package.json scripts

```json
{
  "prepare": "cd .. && husky install config/.husky",
  "precommit": "npm run synth && npm run test && npm run lint:fix && npm run format",
  "prepush": "npm run lint"
}
```

Now we can run `npm run prepare` to set up husky in the root of the project (inside of the `serverless-pro` application directory)

Then we can run the following (run from the project root)

```
npx husky add config/.husky/pre-commit "npm run precommit"

npx husky add config/.husky/pre-push "npm run prepush"
```

Now when you go to commit or push, the husky hooks will run and prevent you from sending code that does not meet standards

#### SAST - Static application security testing with cdk-nag

> Static application security testing (SAST) is a set of technologies designed to analyze application source code, byte code and binaries for coding and design conditions that are indicative of security vulnerabilities. SAST solutions analyze an application from the “inside out” in a nonrunning state. - [https://www.gartner.com/en/information-technology/glossary/static-application-security-testing-sast](https://www.gartner.com/en/information-technology/glossary/static-application-security-testing-sast)

We can use the `cdk-nag` npm package to accomplish this. The tool will validate our CDK code against a set of industry-recognized compliance NagPacks such as

1. [AWS Solutions](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md#awssolutions)
2. [HIPAA Security](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md#hipaa-security)
3. [NIST 800-53 rev 4](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md#nist-800-53-rev-4)
4. [NIST 800-53 rev 5](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md#nist-800-53-rev-5)
5. [PCI DSS 3.2.1](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md#pci-dss-321)

> Infrastructure as Code (IaC) is an important part of Cloud Applications. Developers rely on various Static Application Security Testing (SAST) tools to identify security/compliance issues and mitigate these issues early on, before releasing their applications to production. Additionally, SAST tools often provide reporting mechanisms that can help developers verify compliance during security reviews. - [https://aws.amazon.com/blogs/devops/manage-application-security-and-compliance-with-the-aws-cloud-development-kit-and-cdk-nag/](https://aws.amazon.com/blogs/devops/manage-application-security-and-compliance-with-the-aws-cloud-development-kit-and-cdk-nag/)

We can implement this in our application by installing the package using `npm i cdk-nag` and then adding the following code to the `stateful-stack.ts` and `stateless-stack.ts`:

```
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { NagSuppressions } from 'cdk-nag';

Aspects.of(this).add(new AwsSolutionsChecks({ verbose: false }));
```

If certain nag rules are triggered, they can be suppressed by adding `NagSuppression` entries such as:

```js
NagSuppressions.addResourceSuppressions(this.bucket, [
  {
    id: "AwsSolutions-S1",
    reason: `Rule suppression for 'The S3 Bucket has server access logs disabled'`,
  },
]);
NagSuppressions.addResourceSuppressions(this.table, [
  {
    id: "AwsSolutions-DDB3",
    reason: `Rule suppression for 'The DynamoDB table does not have Point-in-time Recovery enabled'`,
  },
]);
```

---

### Test Stage

#### Database Deploy

> Apply changes to the beta database using the Database Source Code. Changes should be made in a manner that ensures rollback safety. Best practice is to connect to the beta database through cross-account IAM roles and IAM database authentication for RDS rather than long lived database credentials. If database credentials must be used, then they should be loaded from a secret manager such as AWS Secrets Manager. Changes to the database should be incremental, only applying the changes since the prior deployment. Examples of tools that apply incremental database changes include but are not limited to Liquibase, VS Database Project, and Flyway. - [https://pipelines.devops.aws.dev/application-pipeline/index.html#build](https://pipelines.devops.aws.dev/application-pipeline/index.html#build)

Common Scenarios:

1. Deploying Database Changes (e.g. new indexes, schema changes, populating data)
2. Deploying test data to non-production environments for testing
3. Deploying the base database configuration for the application

We are going to look at the latter for adding some basic database configuration for our ‘store’ data config, and we are going to utilise Custom Resources to deploy into our environment which is detailed fully in the following article:

**[Serverless Custom Resources](https://blog.serverlessadvocate.com/serverless-custom-resources-91c0aea2641a?source=post_page-----5446a417d232--------------------------------)**

We add our custom resources to the stateless-stack.ts file as shown below which runs for all stages:

```ts
const provider: cr.Provider = new cr.Provider(
  this,
  "PopulateTableConfigCustomResource",
  {
    onEventHandler: populateOrdersHandler, // this lambda will be called on cfn deploy
    logRetention: logs.RetentionDays.ONE_DAY,
    providerFunctionName: `populate-orders-${props.stageName}-cr-lambda`,
  }
);

// use the custom resource provider
new CustomResource(this, "DbTableConfigCustomResource", {
  serviceToken: provider.serviceToken,
  properties: {
    tableName: props.table.tableName,
  },
});
```

The custom resource above calls the lambda handler in ‘populate-table-cr.ts’ which performs a batch write to our DynamoDB table of the configuration data

#### Integration Tests

> Run automated tests that verify if the application satisifes business requirements. These tests require the application to be running in the beta environment. Integration tests may come in the form of behavior-driven tests, automated acceptance tests, or automated tests linked to requirements and/or stories in a tracking system. Test results should be published somewhere such as AWS CodeBuild Test Reports. Examples of tools to define integration tests include but are not limited to Cucumber, vRest, and SoapUI. - [https://pipelines.devops.aws.dev/application-pipeline/index.html#build](https://pipelines.devops.aws.dev/application-pipeline/index.html#build)

We are going to be using Newman and a Postman collection to run the integration tests agains our API ([https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman](https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman)). First, we add a shell step to our pipeline stage for development and staging as shown:

```ts

  new pipelines.ShellStep('IntegrationTests', {
    envFromCfnOutputs: {
      API_ENDPOINT: developmentStage.apiEndpointUrl,
    },
    // we run the postman basic api integration tests
    commands: [
      'npm install -g newman',
      'newman run ./tests/integration/integration-collection.json --env-var api-url=$API_ENDPOINT',
    ],
  }),
```

This means we will install Newman, then we'll run a Postman collection suite of tests, whilst passing through the API endpoint as an env var.

The Postman tests are all defined in `./tests/integration/integration-collection.json`. The suite is made up of two tests that run in sequence; `create-order`, which hits the POST endpoint with the following payload:

```json
{
  "quantity": 1,
  "productId": "lee-123-123",
  "storeId": "59b8a675-9bb7-46c7-955d-2566edfba8ea"
}
```

The script included in the `exec` block of the event gets the response and checks for the expected field values. We also set the ID of the created order as an environment variable to be referenced in the next test, `get-order`

#### Performance Tests

> Run longer-running automated capacity tests against environments that simulate production capacity. Measure metrics such as the transaction success rates, response time and throughput. Determine if application meets performance requirements and compare metrics to past performance to look for performance degredation. Examples of tools that can be used for performance tests include but are not limited to JMeter, Locust, and Gatling. - [https://pipelines.devops.aws.dev/application-pipeline/index.html#build](https://pipelines.devops.aws.dev/application-pipeline/index.html#build)

We will use [Artillery](https://www.artillery.io/). We have the load tests in the `./tests/load/load.yml` file. We add a shell step in the staging env:

```ts
  // you can optionally run load tests in staging (gamma) too
  new pipelines.ShellStep('LoadTests', {
    envFromCfnOutputs: {
      API_ENDPOINT: stagingStage.apiEndpointUrl,
    },
    // we run the artillery load tests
    commands: [
      'npm install -g artillery',
      'artillery dino', // ensure that it is installed correctly
      'artillery run -e load ./tests/load/load.yml',
    ],
  }),
```

As you can see from the code snippet above, we install artillery and then perform a load test run based on our load.yml file. This means that if our load test fails in our Staging environment we will fail the pipeline and rollback

In our `load.yml` file we perform two calls (in a similar manner to our integration tests); however, we do this over a period of time with multiple virtual users:

```yml
load:
  target: "{{ $processEnvironment.API_ENDPOINT }}"
  phases:
    - duration: 20
      arrivalRate: 1
      maxVusers: 1
```

> In our basic example, we run for 20 seconds, starting with one virtual user, and only scaling to one. You can change your tests for your needs accordingly, for example, by simulating hundreds of virtual users.

We then check in the same file that our p95 and p99 response times are within suitable boundaries, and if not, we fail the pipeline:

```yml
ensure:
  thresholds:
    - http.response_time.p95: 1000
  conditions:
    - expression: http.response_time.p99 < 500
      strict: true
    - expression: http.response_time.p95 < 1000
      strict: true
  maxErrorRate: 0 # no percentage of error rate i.e. no errors or pipeline fails
```

We pass through our load test data from a CSV file found in `./tests/load/data/data.csv` using the configuration in the `load.yml` file:

```yml
payload:
  path: "./data/data.csv" # pull in the order data csv
```

The full load.yml file for the load testing has some assertions on the requests themselves too (such as ensuring the correct values are returned in the responses)

For a more in-depth video of load testing with Artillery, you can watch the following:

[Load testing with Artillery - https://youtu.be/8pckaEKKvgI](https://youtu.be/8pckaEKKvgI)

---

### Production Stage

#### Manual Approval

One neat thing we can do with CDK Pipelines is to add a manual approval stage before our production deployment, meaning that somebody needs to verify that they are happy before the deployment takes place. Of course, our defacto standard would be continuous deployment, but there are times when you need these manual gates.

This is set up very easily in our CDK code by adding the following:

```ts
pipeline.addStage(prodStage, {
  pre: [
    new pipelines.ManualApprovalStep('PromoteToProd'), // manual approval step
  ],
```
