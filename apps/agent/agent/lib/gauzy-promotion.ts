import { db } from "@crm/db";
import type { LeasedTask } from "./tasks";

export async function runGauzyPromotion(task: LeasedTask): Promise<void> {
	if (!task.payload || typeof task.payload !== "object" || Array.isArray(task.payload)) {
		throw new Error("Gauzy promotion task has no valid payload.");
	}
	const payload = task.payload as Record<string, unknown>;
	const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
	if (!eventId) throw new Error("Gauzy promotion task has no eventId.");

	// The API owns the Gauzy adapter and promotion transaction. Agent dispatch only
	// owns durable claiming/retry. Keep this boundary explicit rather than importing
	// API internals into the agent package.
	const event = await db.lumensOsEvent.findUnique({ where: { id: eventId }, select: { status: true } });
	if (!event) throw new Error(`Lumens OS event ${eventId} no longer exists.`);
	if (event.status === "processed") return;

	throw new Error("Gauzy promotion execution requires the API promotion boundary.");
}
