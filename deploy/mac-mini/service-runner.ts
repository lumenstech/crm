import { constants } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

type ServiceName = "app" | "api" | "agent" | "mcp";

type ServiceConfig = {
  packageFilter: string;
  portName: "PORT" | "AGENT_PORT";
  port: string;
};

const services: Record<ServiceName, ServiceConfig> = {
  app: { packageFilter: "app", portName: "PORT", port: "3100" },
  api: { packageFilter: "api", portName: "PORT", port: "3101" },
  agent: { packageFilter: "agent", portName: "AGENT_PORT", port: "3102" },
  mcp: { packageFilter: "@crm/mcp", portName: "PORT", port: "3103" },
};

const service = process.argv[2] as ServiceName | undefined;

if (!service || !(service in services)) {
  console.error(
    "Usage: bun deploy/mac-mini/service-runner.ts <app|api|agent|mcp>",
  );
  process.exit(1);
}

const selected = services[service];
const runnerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(runnerDir, "../..");

const child = spawn(
  process.execPath,
  ["run", `--filter=${selected.packageFilter}`, "start"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      [selected.portName]: selected.port,
    },
  },
);

let settled = false;

const finish = (code: number) => {
  if (settled) return;
  settled = true;
  process.exit(code);
};

const forwardSignal = (signal: NodeJS.Signals) => {
  if (child.killed) return;
  child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (typeof code === "number") {
    finish(code);
    return;
  }

  if (signal) {
    finish(128 + constants.signals[signal]);
    return;
  }

  finish(1);
});

child.on("error", (error) => {
  console.error(`[${service}] could not start: ${error.message}`);
  finish(1);
});
