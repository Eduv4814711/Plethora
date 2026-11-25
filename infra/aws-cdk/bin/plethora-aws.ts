#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { PlethoraAwsStack } from "../lib/plethora-aws-stack.js";
import { PlethoraCicdStack } from "../lib/plethora-cicd-stack.js";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "af-south-1",
};

const githubOwner = app.node.tryGetContext("githubOwner") ?? "Eduv4814711";
const githubRepo = app.node.tryGetContext("githubRepo") ?? "Plethora";
const enableCodeBuildWebhook = app.node.tryGetContext("enableCodeBuildWebhook") !== "false";
const acmCertificateArn = app.node.tryGetContext("acmCertificateArn") as string | undefined;
const apiDomain = app.node.tryGetContext("apiDomain") ?? "api.quickbophasecurity.co.za";
const webDomain = app.node.tryGetContext("webDomain") ?? "plethora.quickbophasecurity.co.za";

const coreStack = new PlethoraAwsStack(app, "PlethoraAwsStack", {
  env,
  description: "Plethora ERP core AWS infrastructure in af-south-1 (Zero-Docker EC2, RDS, S3, Ollama)",
  acmCertificateArn,
  apiDomain,
  webDomain,
});

new PlethoraCicdStack(app, "PlethoraCicdStack", {
  env,
  description: "Plethora ERP GitHub OIDC, AWS CodeBuild, and AWS CodeDeploy CI/CD pipeline",
  vpc: coreStack.vpc,
  deployBucket: coreStack.deployBucket,
  appAsg: coreStack.appAsg,
  dbSecret: coreStack.dbSecret,
  dbInstance: coreStack.dbInstance,
  codeBuildSecurityGroup: coreStack.codeBuildSecurityGroup,
  githubOwner,
  githubRepo,
  enableCodeBuildWebhook,
  apiDomain,
  webDomain,
});
