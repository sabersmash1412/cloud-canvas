# @cloudcanvas/mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude Code build AWS infrastructure through the
Cloud Canvas deterministic engine (approved Terraform modules, topology validation, compliance checks), and
shows the result live in the Cloud Canvas browser app.

No AI runs inside the server. Claude Code supplies the model; this server validates and compiles.

## Tools

| Tool | What it does |
|---|---|
| `list_templates_and_blocks` | The templates, every building block (fields, defaults, placement rules), the allowed connections and the `canvas.json` format. Pass `template=<id>` for a ready-made graph. |
| `validate_and_compile` | Validates a `canvas.json`, runs the compliance rules, and compiles `main.tf`, `versions.tf`, `azure-pipelines.yml` and a formatted `canvas.json`. Invalid graphs come back as structured problems naming each node, so the agent can correct and retry. `strict: true` also rejects high-severity findings; `outputDir` writes the files. |
| `show_on_canvas` | Pushes a work-in-progress graph to the live browser view without compiling it. |
| `sync_terraform_folder` | Imports a folder of Terraform (module-based code becomes diagram nodes), shows it live, and keeps it updated as files change. |

## Use it from this repo

Open Claude Code in the repo root. It reads `.mcp.json` and asks you to approve the `cloud-canvas` server once.

## Use it from any other repo

1. Run the app: `pnpm dev` (in the Cloud Canvas repo).
2. Register the server once, using the absolute path to your Cloud Canvas checkout:

   ```sh
   claude mcp add cloud-canvas --scope user -- \
     /ABS/PATH/cloud-canvas/packages/mcp/node_modules/.bin/tsx \
     /ABS/PATH/cloud-canvas/packages/mcp/src/server.ts
   ```
3. In the Cloud Canvas app choose **Create project → Connect to Claude Code**. The browser finds the server by itself.
4. In Claude Code, in any repo, ask for infrastructure, or ask it to show the repo's Terraform:
   > "Set up an internal microservice on ECS Fargate with a private Postgres database and an S3 audit bucket. Use cloud-canvas and write the Terraform to infra/audit-service."
   > "Use cloud-canvas to show the Terraform in ./infra on the canvas and keep it updated."

## Live view

The server listens on `127.0.0.1` only (first free port from 7777) and sends the architecture graph over
Server-Sent Events. Only the Cloud Canvas dev origins (`http://localhost:5173`, `http://127.0.0.1:5173`, and the
preview port 4173) may read it. It is one-way: the browser cannot send anything back.

## Compliance rules

The rules are private and are not in this repository. If `packages/compiler/private/rules/index.ts` exists the
server loads it; otherwise results say `complianceChecked: false` so "compiled" never silently means "compliant".
Set `CLOUD_CANVAS_RULES` to point at another rules module.

## Environment

| Variable | Meaning |
|---|---|
| `CLOUD_CANVAS_LIVE=0` | Do not start the live view server. |
| `CLOUD_CANVAS_PORT` | First port to try (default 7777). |
| `CLOUD_CANVAS_RULES` | Path to a rules module. |

Logs go to stderr (stdout carries the MCP protocol).

## Tests

`pnpm --filter @cloudcanvas/mcp test` starts the real server over stdio and drives it with the MCP SDK's own client.
