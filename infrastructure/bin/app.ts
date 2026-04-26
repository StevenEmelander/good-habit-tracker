#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CertStack } from '../lib/cert-stack';
import { GoodHabitTrackerStack } from '../lib/stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;

// ACM cert + Lambda@Edge auth must live in us-east-1 (CloudFront requirement)
const certStack = new CertStack(app, 'GoodHabitTrackerCert', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
});

// Data layer and CDN in us-west-2
const mainStack = new GoodHabitTrackerStack(app, 'GoodHabitTracker', {
  env: { account, region: 'us-west-2' },
  crossRegionReferences: true,
  cert: certStack.cert,
  authFnVersion: certStack.authFnVersion,
});
mainStack.addDependency(certStack);
