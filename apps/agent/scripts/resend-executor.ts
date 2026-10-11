import { pollAndRun } from "../agent/lib/resend-executor";

try {
	const result = await pollAndRun();
	console.log(JSON.stringify(result));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
