import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { GauzyAdapter } from "./gauzy.adapter";
import type { OperationalEventV1 } from "./operational-events";
import { OPERATIONAL_EVENT_TYPES } from "./operational-events";

function assertOperationalPayload(value: unknown): asserts value is OperationalEventV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Lumens OS operational payload.");
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
	) throw new Error("Invalid Lumens OS operational v1 payload.");
}

function stringField(data: Record<string, unknown>, key: string): string {
	const value = data[key];
	if (typeof value !== "string" || !value) throw new Error(`Operational event requires ${key}.`);
	return value;
}

@Injectable()
export class GauzyOperationService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async execute(eventId: string, gauzy: GauzyAdapter) {
		const event = await this.db.lumensOsEvent.findUnique({ where: { id: eventId } });
		if (!event) throw new Error(`No Lumens OS event with id ${eventId}.`);
		assertOperationalPayload(event.payload);
		const payload = event.payload;
		const data = payload.data;

		if (event.status === "processed") {
			const existing = await this.db.externalIdentity.findUnique({
				where: { canonicalType_canonicalId_provider_externalType: { canonicalType: payload.canonicalType, canonicalId: payload.canonicalId, provider: "gauzy", externalType: payload.eventType } },
				select: { externalId: true },
			});
			if (existing) return { id: existing.externalId };
		}

		await this.markAttempt(eventId);
		try {
		let result: { id: string };
		switch (payload.eventType) {
			case "project.sync":
				result = await gauzy.findOrCreateProject({
					canonicalOpportunityId: payload.canonicalId,
					customerId: stringField(data, "customerId"),
					organizationId: stringField(data, "organizationId"),
					name: stringField(data, "name"),
				});
				break;
			case "task.sync":
				result = await gauzy.findOrCreateTask({
					canonicalTaskId: payload.canonicalId,
					projectId: stringField(data, "projectId"),
					organizationId: stringField(data, "organizationId"),
					title: stringField(data, "title"),
					description: typeof data.description === "string" ? data.description : null,
				});
				break;
			case "task.assign":
				result = await gauzy.assignTask({
					canonicalAssignmentId: payload.canonicalId,
					taskId: stringField(data, "taskId"),
					organizationId: stringField(data, "organizationId"),
					employeeId: stringField(data, "employeeId"),
				});
				break;
			case "task.schedule":
				result = await gauzy.upsertSchedule({
					canonicalScheduleId: payload.canonicalId,
					taskId: stringField(data, "taskId"),
					organizationId: stringField(data, "organizationId"),
					startAt: new Date(stringField(data, "startAt")),
					endAt: typeof data.endAt === "string" ? new Date(data.endAt) : null,
				});
				break;
		}

		const now = new Date();
		await this.db.$transaction([
			this.db.externalIdentity.upsert({
				where: {
					canonicalType_canonicalId_provider_externalType: {
						canonicalType: payload.canonicalType,
						canonicalId: payload.canonicalId,
						provider: "gauzy",
						externalType: payload.eventType,
					},
				},
				create: {
					id: randomUUID(),
					canonicalType: payload.canonicalType,
					canonicalId: payload.canonicalId,
					provider: "gauzy",
					externalType: payload.eventType,
					externalId: result.id,
				},
				update: { externalId: result.id, updatedAt: now },
			}),
			this.db.lumensOsEvent.update({
				where: { id: eventId },
				data: { status: "processed", processedAt: now, leasedUntil: null, lastError: null, updatedAt: now },
			}),
			this.db.agentTask.updateMany({
				where: { kind: "gauzy_operation", subject: eventId, finishedAt: null },
				data: { finishedAt: now, outcome: "completed" },
			}),
		]);
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
		const retryAt = new Date(now.getTime() + 60_000);
		await this.db.$transaction([
			this.db.lumensOsEvent.update({
				where: { id: eventId },
				data: { status: "pending", lastError: message, leasedUntil: null, availableAt: retryAt, updatedAt: now },
			}),
			this.db.agentTask.updateMany({
				where: { kind: "gauzy_operation", subject: eventId, finishedAt: null },
				data: { dueAt: retryAt, outcome: `retry: ${message}` },
			}),
		]);
	}
}
