import { inSubnetPos, subnetId, subnetNodes, vpcSize } from './layout';
import type { Graph, GraphEdge, GraphNode, ProjectMeta, Props, Tier } from './types';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  /** Build a fresh graph (new object each call) for the given project metadata. */
  build: (project: ProjectMeta) => Graph;
}


type N = Omit<GraphNode, 'properties'> & { properties: Props };
const vpc = (name = 'main'): N[] => [
  { id: 'vpc1', type: 'aws.vpc', position: { x: 0, y: 0 }, size: vpcSize(2), properties: { name, cidr: '10.20.0.0/16', nat: 'single' } },
  ...subnetNodes('vpc1', '10.20.0.0/16', 2),
];
const inVpc = (id: string, type: string, tier: Tier, properties: Props): N => ({ id, type, parentId: subnetId('vpc1', tier, 'a'), position: inSubnetPos(), properties });
const free = (id: string, type: string, x: number, y: number, properties: Props): N => ({ id, type, position: { x, y }, properties });
const e = (source: string, target: string): GraphEdge => ({ id: `${source}-${target}`, source, target });
const graph = (project: ProjectMeta, nodes: N[], edges: GraphEdge[]): Graph => ({ schemaVersion: '1.0.0', project, nodes, edges });

const lambda = (name: string): Props => ({ name, runtime: 'nodejs20.x', handler: 'index.handler', sourcePath: './src/handler', memory: 256, timeout: 10 });
const ecs = (name: string): Props => ({ name, image: 'public.ecr.aws/nginx/nginx:stable', containerPort: 8080, cpu: 512, memory: 1024, desiredCount: 2, healthCheckPath: '/health' });
const pg = (): Props => ({ name: 'db', engineVersion: '16.4', instanceClass: 'db.t4g.medium', storage: 50, dbName: 'app', multiAz: true, backupDays: 7 });
const mysql = (): Props => ({ name: 'db', engineVersion: '8.0.40', instanceClass: 'db.t4g.medium', storage: 50, dbName: 'app', multiAz: true, backupDays: 7 });
const bucket = (name: string): Props => ({ name, versioning: true, forceDestroy: false });

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'static-website',
    name: 'Static Website',
    description:
      'Create a secure, scalable, and performant static website using AWS services. This template leverages S3 for storage and CloudFront for global content delivery. A static website is ideal for presenting fixed content, ensuring fast loading times, cost-effective hosting, and simplified maintenance.',
    recommended: true,
    build: (p) => graph(p, [free('cf', 'aws.cloudfront', 0, 40, { name: 'cdn', priceClass: 'PriceClass_200', rootObject: 'index.html' }), free('site', 'aws.s3', 260, 40, bucket('site'))], [e('cf', 'site')]),
  },
  {
    id: 'serverless-api',
    name: 'Serverless API',
    description:
      'This template leverages AWS Lambda for compute, Amazon API Gateway for the HTTP front door and DynamoDB for storage. Pay only for what you use, scale automatically, and keep IAM permissions scoped to exactly what the function needs.',
    recommended: true,
    build: (p) =>
      graph(
        p,
        [free('gw', 'aws.apigw', 0, 60, { name: 'api-gw', route: 'ANY /{proxy+}' }), free('fn', 'aws.lambda', 240, 60, lambda('handler')), free('tbl', 'aws.dynamodb', 480, 60, { name: 'items', hashKey: 'id', hashKeyType: 'S', billing: 'PAY_PER_REQUEST' })],
        [e('gw', 'fn'), e('fn', 'tbl')],
      ),
  },
  {
    id: 'static-website-dns',
    name: 'Static Website with DNS',
    description:
      'A static website served from S3 through CloudFront, with a TLS certificate from ACM and a Route 53 alias record for your own domain. Requires an existing public hosted zone.',
    build: (p) =>
      graph(
        p,
        [
          free('dns', 'aws.route53_record', 0, 40, { name: 'dns', zoneName: 'example.gov.sg', recordName: 'www' }),
          free('cf', 'aws.cloudfront', 240, 40, { name: 'cdn', priceClass: 'PriceClass_200', rootObject: 'index.html' }),
          free('site', 'aws.s3', 480, 40, bucket('site')),
          free('cert', 'aws.acm', 240, 220, { name: 'cert', domainName: 'www.example.gov.sg', hostedZone: 'example.gov.sg' }),
        ],
        [e('dns', 'cf'), e('cf', 'site'), e('cert', 'cf')],
      ),
  },
  {
    id: 'rds-postgres-secure',
    name: 'RDS for PostgreSQL with a secure network',
    description:
      'Deploy an AWS RDS for PostgreSQL instance within a secure, private database subnet of a multi-AZ VPC. The database has no public route; only the application tier can reach it through a dedicated security group.',
    build: (p) => graph(p, [...vpc(), inVpc('app', 'aws.ecs_fargate', 'private', ecs('app')), inVpc('db', 'aws.rds_postgres', 'database', pg())], [e('app', 'db')]),
  },
  {
    id: 'rds-mysql-secure',
    name: 'RDS for MySQL with a secure network',
    description:
      'Deploy an AWS RDS for MySQL instance within a secure, private database subnet of a multi-AZ VPC. Storage is encrypted, credentials live in Secrets Manager, and only the application tier is allowed in.',
    build: (p) => graph(p, [...vpc(), inVpc('app', 'aws.ecs_fargate', 'private', ecs('app')), inVpc('db', 'aws.rds_mysql', 'database', mysql())], [e('app', 'db')]),
  },
  {
    id: 'serverless-api-mysql',
    name: 'Serverless API with RDS MySQL',
    description:
      'API Gateway invokes a Lambda function running inside your VPC, which talks to a private RDS for MySQL instance. Use this when a serverless front end needs a relational database.',
    build: (p) =>
      graph(
        p,
        [free('gw', 'aws.apigw', -300, 280, { name: 'api-gw', route: 'ANY /{proxy+}' }), ...vpc(), inVpc('fn', 'aws.lambda', 'private', lambda('handler')), inVpc('db', 'aws.rds_mysql', 'database', mysql())],
        [e('gw', 'fn'), e('fn', 'db')],
      ),
  },
  {
    id: 'ecs-cluster',
    name: 'ECS Cluster with ALB, RDS and SQS',
    description:
      'A classic three-tier container platform: an internet-facing Application Load Balancer in front of an ECS Fargate service, backed by a private RDS PostgreSQL database and an SQS queue for background work.',
    build: (p) =>
      graph(
        p,
        [...vpc(), inVpc('alb', 'aws.alb', 'public', { name: 'web', internal: false, https: false, idleTimeout: 60 }), inVpc('svc', 'aws.ecs_fargate', 'private', ecs('api')), inVpc('db', 'aws.rds_postgres', 'database', pg()), free('q', 'aws.sqs', 900, 238, { name: 'jobs', fifo: false, visibility: 30, dlq: true })],
        [e('alb', 'svc'), e('svc', 'db'), e('svc', 'q')],
      ),
  },
];

export const SCRATCH_TEMPLATE_ID = 'scratch';

export function buildTemplate(id: string, project: ProjectMeta): Graph {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? t.build(project) : { schemaVersion: '1.0.0', project, nodes: [], edges: [] };
}
