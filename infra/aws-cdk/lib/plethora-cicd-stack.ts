import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface PlethoraCicdStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  deployBucket: s3.Bucket;
  appAsg: autoscaling.AutoScalingGroup;
  dbSecret: rds.DatabaseSecret;
  dbInstance: rds.DatabaseInstance;
  codeBuildSecurityGroup: ec2.SecurityGroup;
  githubOwner: string;
  githubRepo: string;
  enableCodeBuildWebhook?: boolean;
  apiDomain: string;
}

export class PlethoraCicdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PlethoraCicdStackProps) {
    super(scope, id, props);

    const codeDeployApp = new codedeploy.ServerApplication(this, "PlethoraCodeDeployApp", {
      applicationName: "plethora-app",
    });

    const deploymentGroup = new codedeploy.ServerDeploymentGroup(this, "PlethoraCodeDeployGroup", {
      application: codeDeployApp,
      deploymentGroupName: "plethora-app-dg",
      autoScalingGroups: [props.appAsg],
      deploymentConfig: codedeploy.ServerDeploymentConfig.ONE_AT_A_TIME,
      installAgent: false,
    });

    const githubOidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHubOidcProvider",
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`
    );

    const githubActionsRole = new iam.Role(this, "GitHubActionsRole", {
      roleName: "plethora-github-actions-role",
      assumedBy: new iam.WebIdentityPrincipal(githubOidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": `repo:${props.githubOwner}/${props.githubRepo}:*`,
        },
      }),
    });

    const githubSource = codebuild.Source.gitHub({
      owner: props.githubOwner,
      repo: props.githubRepo,
      webhook: props.enableCodeBuildWebhook ?? false,
      ...(props.enableCodeBuildWebhook
        ? {
            webhookFilters: [
              codebuild.FilterGroup.inEventOf(
                codebuild.EventAction.PULL_REQUEST_CREATED,
                codebuild.EventAction.PULL_REQUEST_UPDATED,
                codebuild.EventAction.PULL_REQUEST_REOPENED
              ),
            ],
          }
        : {}),
    });

    const prVerifyProject = new codebuild.Project(this, "PlethoraPrVerifyProject", {
      projectName: "plethora-pr-verify",
      description: "Runs Plethora PR tests, DB migrations, data audit, and CDK synth without Docker",
      source: githubSource,
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.ci.yml"),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
      },
      timeout: cdk.Duration.minutes(30),
    });

    const mainDeploySource = codebuild.Source.gitHub({
      owner: props.githubOwner,
      repo: props.githubRepo,
      branchOrRef: "main",
      webhook: false,
    });

    const deployProject = new codebuild.Project(this, "PlethoraMainDeployProject", {
      projectName: "plethora-main-deploy",
      description: "Builds Plethora ERP, runs RDS migration gate, and deploys via CodeDeploy",
      source: mainDeploySource,
      vpc: props.vpc,
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.codeBuildSecurityGroup],
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.deploy.yml"),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
      },
      environmentVariables: {
        DEPLOY_BUCKET: { value: props.deployBucket.bucketName },
        CODEDEPLOY_APP: { value: codeDeployApp.applicationName },
        CODEDEPLOY_GROUP: { value: deploymentGroup.deploymentGroupName },
        DB_SECRET_ARN: { value: props.dbSecret.secretArn },
        DB_INSTANCE_ID: { value: props.dbInstance.instanceIdentifier },
        API_HEALTH_URL: { value: `https://${props.apiDomain}/health/ready` },
      },
      timeout: cdk.Duration.minutes(30),
    });

    props.deployBucket.grantReadWrite(deployProject);
    props.dbSecret.grantRead(deployProject);
    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "rds:CreateDBSnapshot",
          "rds:DescribeDBSnapshots",
          "codedeploy:CreateDeployment",
          "codedeploy:GetDeployment",
          "codedeploy:GetApplicationRevision",
          "codedeploy:RegisterApplicationRevision",
        ],
        resources: ["*"],
      })
    );

    githubActionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["codebuild:StartBuild", "codebuild:BatchGetBuilds", "logs:GetLogEvents"],
        resources: [deployProject.projectArn, prVerifyProject.projectArn, "*"],
      })
    );

    new cdk.CfnOutput(this, "GitHubActionsRoleArn", { value: githubActionsRole.roleArn });
    new cdk.CfnOutput(this, "PrVerifyProjectName", { value: prVerifyProject.projectName });
    new cdk.CfnOutput(this, "MainDeployProjectName", { value: deployProject.projectName });
  }
}
