import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { MAX_ATTEMPTS } from "@crm/db/agent-tasks";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { GauzyAdapter } from "./gauzy.adapter";
import { GauzyHttpError } from "./gauzy-http.adapter";
import type { OperationalEventV1 } from "./operational-events";
import { OPERATIONAL_EVENT_TYPES } from "./operational-events";

function assertOperationalPayload(value: unknown): asserts value is OperationalEventV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PermanentOperationError("Invalid Lumens OS operational payload.");
	const payload = value as Partial<OperationalEventV1>;
	if (
		payload.version !== 1 ||
		typeof payload.eventType !== "string" ||
		!OPERATIONAL_EVENT_TYPES.includes(payload.eventType as OperationalEventV1["eventType"]) ||
		typeof payload.canonicalId !== "string" ||
		typeof payload.canonicalType !== "string" ||
		typeof payload.businessUnitId !== "string" ||
		!payload.data ||
		typeof payload.data !== "object" ||
		Array.isArray(payload.data)
	) throw new PermanentOperationError("Invalid Lumens OS operational v1 payload.");
}

function stringField(data: Record<string, unknown>, key: string): string {
	const value = data[key];
	if (typeof value !== "string" || !value) throw new PermanentOperationError(`Operational event requires ${key}.`);
	return value;
}

function dateField(data: Record<string, unknown>, key: string): Date {
	const value = stringField(data, key);
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new PermanentOperationError(`Operational event has invalid ${key}.`);
	return date;
}

function optionalDateField(data: Record<string, unknown>, key: string): Date | null {
	if (data[key] == null) return null;
	return dateField(data, key);
}

type GauzyExternalType = "organization" | "customer" | "contact" | "project" | "task" | "employee";

async function resolveGauzyIdentity(db: Db, canonicalType: string, canonicalId: string, externalType: GauzyExternalType): Promise<string> {
	const identity = await db.externalIdentity.findUnique({
		where: {
			canonicalType_canonicalId_provider_externalType: {
				canonicalType,
				canonicalId,
				provider: "gauzy",
				externalType,
			},
		},
		select: { externalId: true },
	});
	if (!identity) throw new PermanentOperationError(`No Gauzy ${externalType} identity for ${canonicalType} ${canonicalId}.`);
	return identity.externalId;
}

@Injectable()
export class GauzyOperationService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async execute(eventId: string, gauzy: GauzyAdapter) {
		const event = await this.db.lumensOsEvent.findUnique({ where: { id: eventId } });
		if (!event) throw new PermanentOperationError(`No Lumens OS event with id ${eventId}.`);
		try {
			assertOperationalPayload(event.payload);
			const payload = event.payload;
			const data = payload.data;

			if (event.status === "processed" && (payload.eventType === "project.sync" || payload.eventType === "task.sync")) {
			const existing = await this.db.externalIdentity.findUnique({
				where: { canonicalType_canonicalId_provider_externalType: { canonicalType: payload.canonicalType, canonicalId: payload.canonicalId, provider: "gauzy", externalType: payload.eventType === "project.sync" ? "project" : "task" } },
				select: { externalId: true },
			});
				if (existing) return { id: existing.externalId };
			}

		await this.markAttempt(eventId);
		const organizationId = await resolveGauzyIdentity(this.db, "business_unit", payload.businessUnitId, "organization");
		let result: { id: string };
		switch (payload.eventType) {
			case "project.sync":
				result = await gauzy.findOrCreateProject({
					canonicalOpportunityId: payload.canonicalId,
					customerId: await resolveGauzyIdentity(this.db, "company", stringField(data, "companyId"), "customer"),
					organizationId,
					name: stringField(data, "name"),
				});
				break;
			case "task.sync":
				result = await gauzy.findOrCreateTask({
					canonicalTaskId: payload.canonicalId,
					projectId: await resolveGauzyIdentity(this.db, "opportunity", stringField(data, "opportunityId"), "project"),
					organizationId,
					title: stringField(data, "title"),
					description: typeof data.description === "string" ? data.description : null,
				});
				break;
			case "task.assign":
				result = await gauzy.assignTask({
					canonicalAssignmentId: payload.canonicalId,
					taskId: await resolveGauzyIdentity(this.db, "task", stringField(data, "taskId"), "task"),
					organizationId,
					employeeId: await resolveGauzyIdentity(this.db, "person", stringField(data, "personId"), "employee"),
				});
				break;
			case "task.schedule":
				result = await gauzy.upsertSchedule({
					canonicalScheduleId: payload.canonicalId,
					taskId: await resolveGauzyIdentity(this.db, "task", stringField(data, "taskId"), "task"),
					organizationId,
					startAt: dateField(data, "startAt"),
					endAt: optionalDateField(data, "endAt"),
				});
				break;
			case "task.create":
				throw new Error(
					"Lumens OS task.create has no Gauzy execution path yet. The event stays durable until ServiceFixes work-order execution lands.",
				);
		}

		const now = new Date();
		const writes = [];
		if (payload.eventType === "project.sync" || payload.eventType === "task.sync") {
			const externalType = payload.eventType === "project.sync" ? "project" : "task";
			writes.push(this.db.externalIdentity.upsert({
				where: {
					canonicalType_canonicalId_provider_externalType: {
						canonicalType: payload.canonicalType,
						canonicalId: payload.canonicalId,
						provider: "gauzy",
						externalType,
					},
				},
				create: {
					id: randomUUID(),
					canonicalType: payload.canonicalType,
					canonicalId: payload.canonicalId,
					provider: "gauzy",
					externalType,
					externalId: result.id,
				},
				update: { externalId: result.id, updatedAt: now },
			}));
		}
		writes.push(
			this.db.lumensOsEvent.update({
				where: { id: eventId },
				data: { status: "processed", processedAt: now, leasedUntil: null, lastError: null, updatedAt: now },
			}),
			this.db.agentTask.updateMany({
				where: { kind: "gauzy_operation", subject: eventId, finishedAt: null },
				data: { finishedAt: now, outcome: "completed" },
			}),
		);
		await this.db.$transaction(writes);
		return result;
		} catch (error) {
			await this.recordFailure(eventId, error);
			throw error;
		}
	}

	private async markAttempt(eventId: string) {
		const now = new Date();
		await this.db.lumensOsEvent.update({
			where: { id: eventId },
			data: { status: "processing", attempts: { increment: 1 }, leasedUntil: new Date(now.getTime() + 5 * 60_000), lastError: null, updatedAt: now },
		});
	}

	private async recordFailure(eventId: string, error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const now = new Date();
		const task = await this.db.agentTask.findFirst({ where: { kind: "gauzy_operation", subject: eventId, finishedAt: null }, select: { attempts: true } });
		const exhausted = (task?.attempts ?? 0) >= MAX_ATTEMPTS;
		const permanent = error instanceof PermanentOperationError || exhausted || (error instanceof GauzyHttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409 && error.status !== 429);
		const retryAt = new Date(now.getTime() + 60_000);
		await this.db.$transaction([
			this.db.lumensOsEvent.update({
				where: { id: eventId },
				data: { status: permanent ? "failed" : "pending", lastError: message, leasedUntil: null, availableAt: permanent ? now : retryAt, updatedAt: now },
			}),
			this.db.agentTask.updateMany({
				where: { kind: "gauzy_operation", subject: eventId, finishedAt: null },
				data: permanent ? { finishedAt: now, outcome: `failed: ${message}` } : { dueAt: retryAt, outcome: `retry: ${message}` },
			}),
		]);
	}
}

export class PermanentOperationError extends Error {}
