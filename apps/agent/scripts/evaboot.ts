import "@crm/env/load";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createEvabootClient } from "../agent/lib/evaboot.ts";
import { EVABOOT } from "../agent/lib/evaboot-config.ts";
import {
	planEvabootProfiles,
	previewEvabootExtraction,
} from "../agent/lib/evaboot-preview.ts";

async function main() {
	const { values, positionals } = parseArgs({
		options: {
			output: { type: "string" },
			start: { type: "string", default: "0" },
			"max-records": { type: "string", default: String(EVABOOT.previewLimit) },
			profiles: { type: "string" },
			"max-credits": { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});
	const [command, extractionId] = positionals;
	if (
		!["quota", "plan", "preview"].includes(command ?? "") ||
		positionals.length > 2
	) {
		console.error(
			"Use quota, plan --profiles N --max-credits N, or preview ID --output PATH.",
		);
		process.exitCode = 1;
		return;
	}
	const client = createEvabootClient(process.env.EVABOOT_API_KEY);
	if (!client) {
		console.log(
			JSON.stringify({
				configured: false,
				reason: "Set EVABOOT_API_KEY on the agent server.",
			}),
		);
		return;
	}
	if (command === "quota" || command === "plan") {
		const result = await client.quota();
		if (!result.ok) {
			console.log(JSON.stringify(result));
			process.exitCode = 1;
			return;
		}
		const output =
			command === "plan"
				? planEvabootProfiles(
						result.value,
						Number(values.profiles),
						Number(values["max-credits"]),
					)
				: result;
		console.log(JSON.stringify(output, null, 2));
		if (!output.ok) process.exitCode = 1;
		return;
	}
	const outputPath = z.string().trim().min(1).safeParse(values.output);
	if (!outputPath.success || !extractionId) {
		console.error("Preview requires an extraction ID and --output PATH.");
		process.exitCode = 1;
		return;
	}
	const result = await previewEvabootExtraction(client, {
		extractionId,
		start: Number(values.start),
		maxRecords: Number(values["max-records"]),
	});
	if (!result.ok) {
		console.log(JSON.stringify(result));
		process.exitCode = 1;
		return;
	}
	await writeFile(
		outputPath.data,
		`${JSON.stringify(result.value, null, 2)}\n`,
		{
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		},
	);
	console.log(
		JSON.stringify({
			ok: true,
			extractionId,
			returnedCount: result.value.returnedCount,
			hasMore: result.value.hasMore,
			nextStart: result.value.nextStart,
			crmWrites: 0,
		}),
	);
}

main().catch(() => {
	console.error(
		"Evaboot command failed. Check arguments and the output path. Existing files are not overwritten.",
	);
	process.exitCode = 1;
});
