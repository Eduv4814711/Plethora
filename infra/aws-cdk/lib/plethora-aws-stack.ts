import * as fs from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rds from "aws-cdk-lib/aws-rds";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface PlethoraAwsStackProps extends cdk.StackProps {
  acmCertificateArn?: string;
  apiDomain: string;
  webDomain: string;
}

export class PlethoraAwsStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly uploadsBucket: s3.Bucket;
  public readonly deployBucket: s3.Bucket;
  public readonly dbSecret: rds.DatabaseSecret;
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly appSecret: secretsmanager.Secret;
  public readonly appAsg: autoscaling.AutoScalingGroup;
  public readonly codeBuildSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: PlethoraAwsStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "PlethoraVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "PrivateApp", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "PrivateData", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.vpc.addGatewayEndpoint("S3GatewayEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    new route53.PrivateHostedZone(this, "PlethoraPrivateZone", {
      vpc: this.vpc,
      zoneName: "plethora.local",
    });

    this.uploadsBucket = new s3.Bucket(this, "PlethoraUploadsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.deployBucket = new s3.Bucket(this, "PlethoraDeployBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.dbSecret = new rds.DatabaseSecret(this, "PlethoraDbSecret", {
      username: "plethora_admin",
      secretName: "plethora-prod-db-secret",
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "PlethoraDbSg", {
      vpc: this.vpc,
      description: "PostgreSQL access from Plethora app instances and VPC CodeBuild",
      allowAllOutbound: false,
    });

    const appSecurityGroup = new ec2.SecurityGroup(this, "PlethoraAppSg", {
      vpc: this.vpc,
      description: "Plethora EC2 application instances behind ALB",
      allowAllOutbound: true,
    });

    this.codeBuildSecurityGroup = new ec2.SecurityGroup(this, "PlethoraCodeBuildSg", {
      vpc: this.vpc,
      description: "CodeBuild VPC runner for pre-deploy RDS migrations",
      allowAllOutbound: true,
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, "PlethoraAlbSg", {
      vpc: this.vpc,
      description: "Public HTTPS and HTTP ingress to Plethora ALB",
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS ingress");
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP redirect ingress");

    appSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), "ALB to Web");
    appSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3001), "ALB to API");
    dbSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.tcp(5432), "App to RDS Postgres");
    dbSecurityGroup.addIngressRule(this.codeBuildSecurityGroup, ec2.Port.tcp(5432), "CodeBuild migrations to RDS");

    this.dbInstance = new rds.DatabaseInstance(this, "PlethoraPostgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      allocatedStorage: 30,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      databaseName: "plethora",
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    this.appSecret = new secretsmanager.Secret(this, "PlethoraAppSecrets", {
      secretName: "plethora-prod-app-secrets",
      description: "Runtime secrets for Plethora ERP API, WhatsApp Cloud API, and Cron",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          AI_ENABLED: "true",
          AI_PROVIDER: "bedrock",
          AI_REGION: "af-south-1",
          AI_MODEL: "global.moonshotai.kimi-k3.1",
          AI_TIMEOUT_MS: "15000",
          CORS_ORIGIN: `https://${props.webDomain}`,
          FRONTEND_URL: `https://${props.webDomain}`,
          NEXT_PUBLIC_API_URL: `https://${props.apiDomain}`,
          WHATSAPP_ENABLED: "false",
          WHATSAPP_API_VERSION: "v26.0",
          WHATSAPP_PHONE_NUMBER_ID: "",
          WHATSAPP_WABA_ID: "",
          WHATSAPP_ACCESS_TOKEN: "",
          WHATSAPP_VERIFY_TOKEN: "",
          WHATSAPP_APP_SECRET: "",
        }),
        generateStringKey: "CRON_SECRET",
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    const ubuntuArmAmi = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id",
      { os: ec2.OperatingSystemType.LINUX }
    );

    const appRole = new iam.Role(this, "PlethoraAppInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    this.uploadsBucket.grantReadWrite(appRole);
    this.deployBucket.grantRead(appRole);
    this.appSecret.grantRead(appRole);
    this.dbSecret.grantRead(appRole);
    appRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowBedrockKimiInference",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:GetInferenceProfile",
          "bedrock:GetFoundationModel",
        ],
        resources: [
          `arn:aws:bedrock:*:${this.account}:inference-profile/*moonshotai*`,
          `arn:aws:bedrock:*:${this.account}:application-inference-profile/*`,
          "arn:aws:bedrock:*::foundation-model/moonshot*",
        ],
      })
    );

    const appUserDataScript = fs.readFileSync(
      path.resolve(__dirname, "../../ec2/user-data-app.sh"),
      "utf8"
    );
    const appUserData = ec2.UserData.forLinux();
    appUserData.addCommands(appUserDataScript);
    appUserData.addCommands(
      "mkdir -p /etc/plethora",
      `cat <<'EOF' > /etc/plethora/instance.env`,
      `AWS_REGION=${this.region}`,
      `PLETHORA_APP_SECRET_ID=${this.appSecret.secretName}`,
      `PLETHORA_DB_SECRET_ID=${this.dbSecret.secretName}`,
      `PLETHORA_UPLOADS_BUCKET=${this.uploadsBucket.bucketName}`,
      "EOF"
    );

    const appLaunchTemplate = new ec2.LaunchTemplate(this, "PlethoraAppLaunchTemplate", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      machineImage: ubuntuArmAmi,
      role: appRole,
      securityGroup: appSecurityGroup,
      userData: appUserData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(30, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    this.appAsg = new autoscaling.AutoScalingGroup(this, "PlethoraAppAsg", {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      launchTemplate: appLaunchTemplate,
      minCapacity: 1,
      maxCapacity: 3,
      healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.minutes(5) }),
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, "PlethoraAlb", {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const webTargetGroup = new elbv2.ApplicationTargetGroup(this, "PlethoraWebTg", {
      vpc: this.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.appAsg],
      healthCheck: {
        path: "/",
        healthyHttpCodes: "200-399",
        interval: cdk.Duration.seconds(30),
      },
    });

    const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, "PlethoraApiTg", {
      vpc: this.vpc,
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.appAsg],
      healthCheck: {
        path: "/health/ready",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
      },
    });

    if (props.acmCertificateArn) {
      const cert = certificatemanager.Certificate.fromCertificateArn(
        this,
        "PlethoraTlsCert",
        props.acmCertificateArn
      );
      const httpsListener = alb.addListener("HttpsListener", {
        port: 443,
        certificates: [cert],
        defaultTargetGroups: [webTargetGroup],
      });
      httpsListener.addTargetGroups("ApiHostRule", {
        priority: 10,
        conditions: [elbv2.ListenerCondition.hostHeaders([props.apiDomain])],
        targetGroups: [apiTargetGroup],
      });
      alb.addListener("HttpListener", {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
          permanent: true,
        }),
      });
    } else {
      const httpListener = alb.addListener("HttpListener", {
        port: 80,
        defaultTargetGroups: [webTargetGroup],
      });
      httpListener.addTargetGroups("ApiHostRuleHttp", {
        priority: 10,
        conditions: [elbv2.ListenerCondition.hostHeaders([props.apiDomain])],
        targetGroups: [apiTargetGroup],
      });
    }

    const cronConnection = new events.Connection(this, "AutoRosterCronConnection", {
      authorization: events.Authorization.apiKey(
        "Authorization",
        cdk.SecretValue.secretsManager(this.appSecret.secretArn, {
          jsonField: "CRON_SECRET",
        })
      ),
      description: "Bearer token connection for Plethora daily auto-roster endpoint",
    });

    const autoRosterDest = new events.ApiDestination(this, "AutoRosterDestination", {
      connection: cronConnection,
      endpoint: `https://${props.apiDomain}/internal/cron/auto-roster`,
      httpMethod: events.HttpMethod.POST,
      description: "Daily automatic rostering endpoint",
    });

    new events.Rule(this, "DailyAutoRosterRule", {
      schedule: events.Schedule.cron({ minute: "0", hour: "2" }),
      targets: [new targets.ApiDestination(autoRosterDest)],
      description: "Triggers Plethora daily auto-roster at 02:00 UTC",
    });

    new cdk.CfnOutput(this, "AlbDnsName", { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "UploadsBucketName", { value: this.uploadsBucket.bucketName });
    new cdk.CfnOutput(this, "DeployBucketName", { value: this.deployBucket.bucketName });
  }
}
