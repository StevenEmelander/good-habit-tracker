import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as crypto from 'crypto';
import * as path from 'path';

interface GoodHabitTrackerStackProps extends cdk.StackProps {
  cert: acm.Certificate;
  authFnVersion: lambda.Version;
}

export class GoodHabitTrackerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GoodHabitTrackerStackProps) {
    super(scope, id, props);

    const unlockToken = this.node.tryGetContext('unlock_token') as string;
    if (!unlockToken) {
      throw new Error('Required: --context unlock_token=<your-secret-token>');
    }
    const cfSecret = crypto.createHash('sha256').update('cf-secret:' + unlockToken).digest('hex').slice(0, 32);

    // ── DynamoDB ──────────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'StateTable', {
      tableName: 'good-habit-tracker-state',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Sync Lambda (us-west-2) ───────────────────────────────────────────────
    const syncFn = new lambda.Function(this, 'SyncFn', {
      functionName: 'good-habit-tracker-sync',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas/sync')),
      environment: { TABLE_NAME: table.tableName, CF_SECRET: cfSecret },
      timeout: cdk.Duration.seconds(10),
    });
    table.grantReadWriteData(syncFn);

    const syncUrl = syncFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    const syncDomain = cdk.Fn.select(2, cdk.Fn.split('/', syncUrl.url));

    // ── S3 bucket (us-west-2) ─────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'AppBucket', {
      bucketName: `good-habit-tracker-app-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');
    bucket.grantRead(oai);

    // ── CloudFront ────────────────────────────────────────────────────────────
    const authEdge: cloudfront.EdgeLambda = {
      functionVersion: props.authFnVersion,
      eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
    };

    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiORP', {
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Content-Type'),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.none(),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: ['ght.vexom.io'],
      certificate: props.cert,
      defaultRootObject: 'tracker.html',
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        edgeLambdas: [authEdge],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(syncDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: { 'X-CF-Secret': cfSecret },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequestPolicy,
          edgeLambdas: [authEdge],
        },
      },
    });

    // ── Deploy app to S3 ──────────────────────────────────────────────────────
    new s3deploy.BucketDeployment(this, 'AppDeploy', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../app'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ── Route53 ───────────────────────────────────────────────────────────────
    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: 'vexom.io' });
    new route53.ARecord(this, 'ARecord', {
      zone,
      recordName: 'ght',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new cdk.CfnOutput(this, 'URL', { value: 'https://ght.vexom.io' });
  }
}
