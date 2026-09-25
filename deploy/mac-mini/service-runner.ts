import { spawn } from "node:child_process";
import { constants } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ServiceName = "app" | "api" | "agent" | "mcp";

const services: Record<
	ServiceName,
	{ portName: "PORT" | "AGENT_PORT"; port: string }
> = {
	app: { portName: "PORT", port: "3100" },
	api: { portName: "PORT", port: "3101" },
	agent: { portName: "AGENT_PORT", port: "3102" },
	mcp: { portName: "PORT", port: "3103" },
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

function required(name: "COMP_CRM_API_KEY" | "MCP_CALLER_TOKENS"): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

const childArguments =
	service === "mcp"
		? [resolve(repoRoot, "apps/mcp/dist/index.js")]
		: ["run", `--filter=${service}`, "start"];

const childEnvironment =
	service === "mcp"
		? {
				NODE_ENV: "production",
				PATH:
					process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
				HOST: "127.0.0.1",
				PORT: selected.port,
				COMP_CRM_BASE_URL: "http://127.0.0.1:3101",
				COMP_CRM_API_KEY: required("COMP_CRM_API_KEY"),
				MCP_CALLER_TOKENS: required("MCP_CALLER_TOKENS"),
			}
		: {
				...process.env,
				NODE_ENV: "production",
				[selected.portName]: selected.port,
			};

const child = spawn(process.execPath, childArguments, {
	cwd: repoRoot,
	stdio: "inherit",
	env: childEnvironment,
});

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
