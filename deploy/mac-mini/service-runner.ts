import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ServiceName = "app" | "api" | "agent";

const service = process.argv[2] as ServiceName | undefined;

if (!service || !["app", "api", "agent"].includes(service)) {
	console.error("Usage: bun deploy/mac-mini/service-runner.ts <app|api|agent>");
	process.exit(64);
}

const servicePorts: Record<ServiceName, string> = {
	app: "3100",
	api: "3101",
	agent: "3102",
};

const runnerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(runnerDir, "../..");

const env: Record<string, string> = {
	...process.env,
};

if (service === "agent") {
	env.AGENT_PORT = servicePorts.agent;
} else {
	env.PORT = servicePorts[service];
}

const child = Bun.spawn(
	["bun", "run", `--filter=${service}`, "start"],
	{
		cwd: repoRoot,
		env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	},
);

let shuttingDown = false;

const forwardSignal = (signal: NodeJS.Signals) => {
	if (shuttingDown) return;
	shuttingDown = true;

	try {
		child.kill(signal);
	} catch (error) {
		console.error(`Failed to forward ${signal} to ${service} service:`, error);
		process.exit(1);
	}
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

try {
	const exitCode = await child.exited;
	process.exit(exitCode);
} catch (error) {
	console.error(`${service} service failed:`, error);
	process.exit(1);
}
