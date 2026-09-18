import { loadRootEnv } from "@crm/env";
import type { LeasedTask } from "./tasks";

loadRootEnv();

export async function runGauzyOperation(task: LeasedTask): Promise<void> {
	if (!task.payload || typeof task.payload !== "object" || Array.isArray(task.payload)) throw new Error("Gauzy operation task has no valid payload.");
	const payload = task.payload as Record<string, unknown>;
	const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
	if (!eventId) throw new Error("Gauzy operation task has no eventId.");

	const baseUrl = process.env.API_URL?.replace(/\/$/, "");
	const secret = process.env.CRON_SECRET;
	if (!baseUrl || !secret) throw new Error("API_URL and CRON_SECRET are required for Gauzy task execution.");

	const response = await fetch(`${baseUrl}/internal/lumens-os/gauzy/operate/${encodeURIComponent(eventId)}`, {
		method: "POST",
		headers: { authorization: `Bearer ${secret}` },
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status === 409) return;
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`Gauzy operation API returned ${response.status}: ${body.slice(0, 300)}`);
	}
}
