import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { PlethoraAwsStack } from "../lib/plethora-aws-stack.js";
import { PlethoraCicdStack } from "../lib/plethora-cicd-stack.js";

describe("Plethora AWS CDK Stacks (Zero-Docker)", () => {
  it("synthesizes core and CI/CD stacks without ECS or ECR", () => {
    const app = new cdk.App();
    const env = { account: "123456789012", region: "af-south-1" };

    const core = new PlethoraAwsStack(app, "TestPlethoraAwsStack", {
      env,
      apiDomain: "api.quickbophasecurity.co.za",
      webDomain: "plethora.quickbophasecurity.co.za",
    });

    const cicd = new PlethoraCicdStack(app, "TestPlethoraCicdStack", {
      env,
      vpc: core.vpc,
      deployBucket: core.deployBucket,
      appAsg: core.appAsg,
      dbSecret: core.dbSecret,
      dbInstance: core.dbInstance,
      codeBuildSecurityGroup: core.codeBuildSecurityGroup,
      githubOwner: "quickbopa",
      githubRepo: "Plethora",
      apiDomain: "api.quickbophasecurity.co.za",
    });

    const coreTemplate = Template.fromStack(core);
    coreTemplate.resourceCountIs("AWS::RDS::DBInstance", 1);
    coreTemplate.resourceCountIs("AWS::S3::Bucket", 2);
    coreTemplate.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
    coreTemplate.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 1);
    coreTemplate.resourceCountIs("AWS::ECS::Cluster", 0);
    coreTemplate.resourceCountIs("AWS::ECR::Repository", 0);

    const cicdTemplate = Template.fromStack(cicd);
    cicdTemplate.resourceCountIs("AWS::CodeBuild::Project", 2);
    cicdTemplate.resourceCountIs("AWS::CodeDeploy::DeploymentGroup", 1);
  });
});
