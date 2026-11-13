import type { Graph } from '@cloudcanvas/compiler';

export const THREE_TIER: Graph = {
  schemaVersion: '1.0.0',
  project: { name: 'member-portal', squad: 'digital-services', environment: 'dev', region: 'ap-southeast-1' },
  nodes: [
    { id: 'vpc1', type: 'aws.vpc', position: { x: 0, y: 0 }, size: { w: 880, h: 540 }, properties: { name: 'main', cidr: '10.20.0.0/16', azCount: 2, nat: 'single' } },
    { id: 'alb1', type: 'aws.alb', parentId: 'vpc1', position: { x: 120, y: 78 }, properties: { name: 'web', internal: false, https: false, idleTimeout: 60 } },
    { id: 'svc1', type: 'aws.ecs_fargate', parentId: 'vpc1', position: { x: 380, y: 238 }, properties: { name: 'api', image: 'public.ecr.aws/nginx/nginx:stable', containerPort: 8080, cpu: 512, memory: 1024, desiredCount: 2, healthCheckPath: '/health' } },
    { id: 'db1', type: 'aws.rds_postgres', parentId: 'vpc1', position: { x: 620, y: 398 }, properties: { name: 'db', engineVersion: '16.4', instanceClass: 'db.t4g.medium', storage: 50, dbName: 'app', multiAz: true, backupDays: 7 } },
    { id: 's31', type: 'aws.s3', position: { x: 960, y: 238 }, properties: { name: 'assets', versioning: true, forceDestroy: false } },
  ],
  edges: [
    { id: 'e1', source: 'alb1', target: 'svc1' },
    { id: 'e2', source: 'svc1', target: 'db1' },
    { id: 'e3', source: 'svc1', target: 's31' },
  ],
};

export const SERVERLESS: Graph = {
  schemaVersion: '1.0.0',
  project: { name: 'orders', squad: 'digital-services', environment: 'dev', region: 'ap-southeast-1' },
  nodes: [
    { id: 'gw', type: 'aws.apigw', position: { x: 0, y: 120 }, properties: { name: 'api-gw', route: 'ANY /{proxy+}' } },
    { id: 'fn', type: 'aws.lambda', position: { x: 260, y: 120 }, properties: { name: 'handler', runtime: 'nodejs20.x', handler: 'index.handler', sourcePath: './src/handler', memory: 256, timeout: 10 } },
    { id: 'tbl', type: 'aws.dynamodb', position: { x: 520, y: 20 }, properties: { name: 'orders', hashKey: 'id', hashKeyType: 'S', billing: 'PAY_PER_REQUEST' } },
    { id: 'q', type: 'aws.sqs', position: { x: 520, y: 220 }, properties: { name: 'jobs', fifo: false, visibility: 30, dlq: true } },
  ],
  edges: [
    { id: 'e1', source: 'gw', target: 'fn' },
    { id: 'e2', source: 'fn', target: 'tbl' },
    { id: 'e3', source: 'fn', target: 'q' },
  ],
};
