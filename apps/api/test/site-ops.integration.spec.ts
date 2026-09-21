import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	acknowledgeCommandId,
	createTaskCommandId,
	parseSiteTaskCommandEvent,
	sourceHealthId,
} from "@crm/validation/site-operations";
import {
	buildPilotFixture,
	createAsset,
	createBatteryPolicy,
	PILOT,
	setSourceHealth,
} from "../src/site-ops/site-ops.fixtures";
import { SiteOpsService } from "../src/site-ops/site-ops.service";
import { SiteOpsAlertsService } from "../src/site-ops/site-ops-alerts.service";
import { SiteOpsCommandService } from "../src/site-ops/site-ops-command.service";
import { SiteOpsIngestService } from "../src/site-ops/site-ops-ingest.service";

const suffix = process.env.TEST_RUN_ID ?? "site-ops-spec";
const adminId = `user-admin-${suffix}`;
const memberId = `user-member-${suffix}`;
const strangerId = `user-stranger-${suffix}`;

const sites = new SiteOpsService(db);
const ingest = new SiteOpsIngestService(db);
const alerts = new SiteOpsAlertsService(db, sites);
const commands = new SiteOpsCommandService(db, sites);

const NOW = new Date("2026-09-21T12:00:00.000Z");
const MINUTE = 60_000;

function at(minutesFromNow: number): Date {
	return new Date(NOW.getTime() + minutesFromNow * MINUTE);
}

let fixture: { businessUnitId: string; siteId: string; assetId: string };
let otherSiteId: string;
let otherAssetId: string;
const assetIds: Record<string, string> = {};

async function seedUser(id: string, role: string | null) {
	await db.user.upsert({
		where: { id },
		create: {
			id,
			name: `Test ${id}`,
			email: `${id}@example.test`,
			updatedAt: NOW,
		},
		update: {},
	});
	if (!role) return;
	await db.member.upsert({
		where: {
			organizationId_userId: { organizationId: WORKSPACE_ID, userId: id },
		},
		create: {
			id: `member-${id}`,
			organizationId: WORKSPACE_ID,
			userId: id,
			role,
			createdAt: NOW,
		},
		update: { role },
	});
}

async function reading(
	assetId: string,
	tag: string,
	value: number | null,
	observedAt: Date,
	options: {
		validation?: "accepted" | "rejected";
		rejectionCode?: string;
	} = {},
) {
	return ingest.recordObservation({
		assetId,
		provider: PILOT.provider,
		sourceEventId: `${tag}-${suffix}`,
		metric: PILOT.metric,
		numericValue: value,
		unit: PILOT.unit,
		observedAt,
		receivedAt: observedAt,
		validation: options.validation ?? "accepted",
		rejectionCode: options.rejectionCode ?? null,
	});
}

async function freshSource(assetId: string, when: Date) {
	await setSourceHealth(ingest, {
		siteId: fixture.siteId,
		assetId,
		status: "ok",
		lastSuccessAt: when,
	});
}

async function activeAlerts(assetId: string) {
	return db.siteOpsAlert.findMany({
		where: { assetId, state: { in: ["open", "acknowledged"] } },
		orderBy: { openedAt: "asc" },
	});
}

async function stateOf(assetId: string, now: Date) {
	const detail = await sites.assetDetail({ assetId, historyLimit: 50 }, now);
	return detail.asset.metricStates[0];
}

beforeAll(async () => {
	await db.organization.upsert({
		where: { id: WORKSPACE_ID },
		create: {
			id: WORKSPACE_ID,
			name: "Test Workspace",
			slug: `test-workspace-${suffix}`,
			createdAt: NOW,
		},
		update: {},
	});
	await seedUser(adminId, "admin");
	await seedUser(memberId, "member");
	await seedUser(strangerId, null);

	fixture = await buildPilotFixture(db, { suffix });
	await createBatteryPolicy(db, { assetId: fixture.assetId });

	for (const name of [
		"fresh",
		"stale",
		"missing",
		"failed",
		"invalid",
		"lifecycle",
		"holdStale",
		"holdFailed",
		"holdInvalid",
		"direction",
		"concurrent",
		"shared",
	]) {
		assetIds[name] = await createAsset(db, {
			siteId: fixture.siteId,
			code: `SCN-${name.toUpperCase()}`,
			name: `Scenario ${name}`,
			assetType: "battery",
		});
		await createBatteryPolicy(db, { assetId: assetIds[name] as string });
	}

	const other = await db.siteOpsSite.create({
		data: {
			businessUnitId: fixture.businessUnitId,
			name: "Second Site",
			code: `GEO-02-${suffix}`,
			timezone: PILOT.timezone,
			status: "unknown",
		},
		select: { id: true },
	});
	otherSiteId = other.id;
	otherAssetId = await createAsset(db, {
		siteId: otherSiteId,
		code: "GEN-01",
		name: "Other generator",
		assetType: "generator",
	});

	await setSourceHealth(ingest, {
		siteId: fixture.siteId,
		assetId: null,
		status: "ok",
		lastSuccessAt: at(-1),
	});
});

afterAll(async () => {
	if (fixture) {
		await db.lumensOsEvent.deleteMany({
			where: { businessUnitId: fixture.businessUnitId },
		});
		await db.agentTask.deleteMany({
			where: { businessUnitId: fixture.businessUnitId },
		});
		await db.siteOpsSite.deleteMany({ where: { id: otherSiteId } });
		await db.siteOpsSite.deleteMany({ where: { id: fixture.siteId } });
		await db.businessUnit.deleteMany({ where: { id: fixture.businessUnitId } });
	}
	await db.member.deleteMany({
		where: { userId: { in: [adminId, memberId, strangerId] } },
	});
	await db.user.deleteMany({
		where: { id: { in: [adminId, memberId, strangerId] } },
	});
});

describe("observation ingestion", () => {
	test("a duplicate source event id does not create a second observation", async () => {
		const first = await reading(assetIds.fresh as string, "dup", 12.6, at(-2));
		const second = await reading(assetIds.fresh as string, "dup", 12.6, at(-2));

		expect(first.deduplicated).toBe(false);
		expect(second.deduplicated).toBe(true);
		expect(second.observationId).toBe(first.observationId);
	});

	test("concurrent duplicate deliveries create one observation and leak no P2002", async () => {
		const deliver = () =>
			ingest.recordObservation({
				assetId: assetIds.concurrent as string,
				provider: PILOT.provider,
				sourceEventId: `race-${suffix}`,
				metric: PILOT.metric,
				numericValue: 12.6,
				unit: PILOT.unit,
				observedAt: at(-2),
				receivedAt: at(-2),
			});

		const results = await Promise.all([deliver(), deliver(), deliver()]);
		const ids = new Set(results.map((result) => result.observationId));

		expect(ids.size).toBe(1);
		expect(results.filter((result) => !result.deduplicated).length).toBe(1);

		const count = await db.siteOpsObservation.count({
			where: {
				provider: PILOT.provider,
				assetId: assetIds.concurrent as string,
				sourceEventId: `race-${suffix}`,
			},
		});
		expect(count).toBe(1);
	});

	test("the same source event id from a different asset is a different reading", async () => {
		const a = await reading(
			assetIds.fresh as string,
			"shared-id",
			12.6,
			at(-3),
		);
		const b = await ingest.recordObservation({
			assetId: assetIds.shared as string,
			provider: PILOT.provider,
			sourceEventId: `shared-id-${suffix}`,
			metric: PILOT.metric,
			numericValue: 12.7,
			unit: PILOT.unit,
			observedAt: at(-3),
			receivedAt: at(-3),
		});
		expect(b.deduplicated).toBe(false);
		expect(b.observationId).not.toBe(a.observationId);
	});

	test("no code path writes an observation to represent absent telemetry", async () => {
		const before = await db.siteOpsObservation.count({
			where: { assetId: assetIds.stale as string },
		});
		await sites.siteOverview({ siteId: fixture.siteId }, NOW);
		await alerts.evaluateSite(fixture.siteId, NOW);
		const after = await db.siteOpsObservation.count({
			where: { assetId: assetIds.stale as string },
		});
		expect(after).toBe(before);
	});
});

describe("source health integrity", () => {
	test("an asset from another site is rejected", async () => {
		expect(
			ingest.recordSourceHealth({
				provider: PILOT.provider,
				siteId: fixture.siteId,
				assetId: otherAssetId,
				status: "ok",
				lastSuccessAt: at(-1),
				expectedIntervalSeconds: PILOT.expectedIntervalSeconds,
			}),
		).rejects.toThrow(/belongs to site/i);
	});

	test("an unknown asset is rejected", async () => {
		expect(
			ingest.recordSourceHealth({
				provider: PILOT.provider,
				siteId: fixture.siteId,
				assetId: `missing-${suffix}`,
				status: "ok",
				lastSuccessAt: null,
				expectedIntervalSeconds: PILOT.expectedIntervalSeconds,
			}),
		).rejects.toThrow(/No site asset/i);
	});

	test("the database blocks a second site-scoped row for one provider", async () => {
		expect(
			(async () => {
				await db.siteOpsSourceHealth.create({
					data: {
						id: `duplicate-site-scope-${suffix}`,
						provider: PILOT.provider,
						siteId: fixture.siteId,
						assetId: null,
						status: "ok",
						expectedIntervalSeconds: PILOT.expectedIntervalSeconds,
					},
				});
			})(),
		).rejects.toThrow();
	});

	test("the database blocks a second asset-scoped row for one provider", async () => {
		await setSourceHealth(ingest, {
			siteId: fixture.siteId,
			assetId: assetIds.fresh as string,
			status: "ok",
			lastSuccessAt: at(-1),
		});
		expect(
			(async () => {
				await db.siteOpsSourceHealth.create({
					data: {
						id: `duplicate-asset-scope-${suffix}`,
						provider: PILOT.provider,
						siteId: fixture.siteId,
						assetId: assetIds.fresh as string,
						status: "ok",
						expectedIntervalSeconds: PILOT.expectedIntervalSeconds,
					},
				});
			})(),
		).rejects.toThrow();
	});

	test("the deterministic id matches the scope it describes", async () => {
		const id = await setSourceHealth(ingest, {
			siteId: fixture.siteId,
			assetId: assetIds.fresh as string,
			status: "ok",
			lastSuccessAt: at(-1),
		});
		expect(id).toBe(
			sourceHealthId(PILOT.provider, fixture.siteId, assetIds.fresh as string),
		);
	});
});

describe("the five signal states", () => {
	test("fresh", async () => {
		const state = await stateOf(assetIds.fresh as string, NOW);
		expect(state?.state).toBe("fresh");
		expect(state?.value).toBe(12.6);
	});

	test("stale", async () => {
		await reading(assetIds.stale as string, "stale", 12.6, at(-45));
		const state = await stateOf(assetIds.stale as string, NOW);
		expect(state?.state).toBe("stale");
	});

	test("missing", async () => {
		const state = await stateOf(assetIds.missing as string, at(-2));
		expect(state?.state).toBe("missing");
		expect(state?.value).toBeNull();
	});

	test("source_failed", async () => {
		await setSourceHealth(ingest, {
			siteId: fixture.siteId,
			assetId: assetIds.failed as string,
			status: "failed",
			lastSuccessAt: at(-90),
			lastError: "energybms poll timed out",
		});
		await reading(assetIds.failed as string, "failed", 12.6, at(-1));
		const state = await stateOf(assetIds.failed as string, NOW);
		expect(state?.state).toBe("source_failed");
		expect(state?.reason).toContain("timed out");
	});

	test("invalid", async () => {
		await reading(assetIds.invalid as string, "invalid", null, at(-2), {
			validation: "rejected",
			rejectionCode: "non_numeric_payload",
		});
		const state = await stateOf(assetIds.invalid as string, NOW);
		expect(state?.state).toBe("invalid");
	});

	test("a site with any unhealthy asset is never normal", async () => {
		const overview = await sites.siteOverview({ siteId: fixture.siteId }, NOW);
		expect(overview.site.status).not.toBe("normal");
	});
});

describe("threshold alerts open only on proof", () => {
	test("a fresh reading below the minimum opens one alert with provenance", async () => {
		const observation = await reading(
			assetIds.lifecycle as string,
			"low-1",
			11.2,
			at(-3),
		);
		await freshSource(assetIds.lifecycle as string, at(-1));
		const first = await alerts.evaluateSite(fixture.siteId, NOW);
		expect(first.openedAlertIds.length).toBeGreaterThanOrEqual(1);

		const open = await activeAlerts(assetIds.lifecycle as string);
		expect(open.length).toBe(1);
		expect(open[0]?.observationId).toBe(observation.observationId);
		expect(open[0]?.observedValue).toBe(11.2);
		expect(open[0]?.thresholdKind).toBe("min");
		expect(open[0]?.thresholdValue).toBe(PILOT.minVoltage);
		expect(open[0]?.activeKey).toBeTruthy();
	});

	test("re-evaluating the same breach does not open a second alert", async () => {
		await alerts.evaluateSite(fixture.siteId, NOW);
		const open = await activeAlerts(assetIds.lifecycle as string);
		expect(open.length).toBe(1);
	});

	test("detection never creates a service task on its own", async () => {
		const events = await db.lumensOsEvent.count({
			where: {
				eventType: "task.create",
				businessUnitId: fixture.businessUnitId,
			},
		});
		expect(events).toBe(0);
	});
});

describe("losing telemetry never resolves an alert", () => {
	async function openHold(asset: string, tag: string) {
		await reading(asset, tag, 11.2, at(-3));
		await freshSource(asset, at(-1));
		await alerts.evaluateSite(fixture.siteId, NOW);
		const open = await activeAlerts(asset);
		expect(open.length).toBe(1);
		return open[0];
	}

	test("a stale reading leaves the alert open", async () => {
		const asset = assetIds.holdStale as string;
		const alert = await openHold(asset, "hold-stale");
		const later = at(16);
		await freshSource(asset, at(15));
		expect((await stateOf(asset, later))?.state).toBe("stale");

		await alerts.evaluateSite(fixture.siteId, later);
		const still = await activeAlerts(asset);
		expect(still.length).toBe(1);
		expect(still[0]?.id).toBe(alert?.id);
		expect(still[0]?.closedAt).toBeNull();
	});

	test("a failed source leaves the alert open", async () => {
		const asset = assetIds.holdFailed as string;
		const alert = await openHold(asset, "hold-failed");
		await setSourceHealth(ingest, {
			siteId: fixture.siteId,
			assetId: asset,
			status: "failed",
			lastSuccessAt: at(-120),
			lastError: "sensor offline",
		});
		expect((await stateOf(asset, NOW))?.state).toBe("source_failed");

		await alerts.evaluateSite(fixture.siteId, NOW);
		const still = await activeAlerts(asset);
		expect(still.length).toBe(1);
		expect(still[0]?.id).toBe(alert?.id);
		expect(still[0]?.closedAt).toBeNull();
	});

	test("an invalid reading leaves the alert open", async () => {
		const asset = assetIds.holdInvalid as string;
		const alert = await openHold(asset, "hold-invalid");
		await reading(asset, "hold-invalid-bad", null, at(-1), {
			validation: "rejected",
			rejectionCode: "checksum",
		});
		await freshSource(asset, at(-1));
		expect((await stateOf(asset, NOW))?.state).toBe("invalid");

		await alerts.evaluateSite(fixture.siteId, NOW);
		const still = await activeAlerts(asset);
		expect(still.length).toBe(1);
		expect(still[0]?.id).toBe(alert?.id);
		expect(still[0]?.closedAt).toBeNull();
	});
});

type AlertSnapshot = {
	observationId: string | null;
	observedValue: number | null;
	thresholdValue: number | null;
	reason: string;
	openedAt: Date;
	acknowledgedBy: string | null;
};

describe("alert history is immutable across breach episodes", () => {
	let firstAlertId: string;
	let firstSnapshot: AlertSnapshot;

	test("an acknowledged alert closes when a fresh in-range reading arrives", async () => {
		const asset = assetIds.lifecycle as string;
		const open = await activeAlerts(asset);
		firstAlertId = open[0]?.id as string;

		await commands.acknowledgeAlert(
			memberId,
			{
				alertId: firstAlertId,
				commandId: acknowledgeCommandId(firstAlertId),
				note: "Checked on the morning round.",
			},
			NOW,
		);

		const acknowledged = await db.siteOpsAlert.findUniqueOrThrow({
			where: { id: firstAlertId },
		});
		firstSnapshot = {
			observationId: acknowledged.observationId,
			observedValue: acknowledged.observedValue,
			thresholdValue: acknowledged.thresholdValue,
			reason: acknowledged.reason,
			openedAt: acknowledged.openedAt,
			acknowledgedBy: acknowledged.acknowledgedBy,
		};
		expect(acknowledged.activeKey).toBeTruthy();

		await reading(asset, "recovered", 12.8, at(10));
		await freshSource(asset, at(10));
		await alerts.evaluateSite(fixture.siteId, at(11));

		const closed = await db.siteOpsAlert.findUniqueOrThrow({
			where: { id: firstAlertId },
		});
		expect(closed.state).toBe("closed");
		expect(closed.closedAt).not.toBeNull();
		expect(closed.activeKey).toBeNull();
	});

	test("a later breach creates a new alert and leaves the old one untouched", async () => {
		const asset = assetIds.lifecycle as string;
		await reading(asset, "low-2", 11.1, at(20));
		await freshSource(asset, at(20));
		await alerts.evaluateSite(fixture.siteId, at(21));

		const open = await activeAlerts(asset);
		expect(open.length).toBe(1);
		const second = open[0];
		expect(second?.id).not.toBe(firstAlertId);
		expect(second?.observedValue).toBe(11.1);

		const original = await db.siteOpsAlert.findUniqueOrThrow({
			where: { id: firstAlertId },
		});
		expect(original.observationId).toBe(firstSnapshot.observationId);
		expect(original.observedValue).toBe(firstSnapshot.observedValue);
		expect(original.thresholdValue).toBe(firstSnapshot.thresholdValue);
		expect(original.reason).toBe(firstSnapshot.reason);
		expect(original.openedAt.getTime()).toBe(firstSnapshot.openedAt.getTime());
		expect(original.acknowledgedBy).toBe(firstSnapshot.acknowledgedBy);
	});

	test("the new alert inherits no acknowledgement history", async () => {
		const open = await activeAlerts(assetIds.lifecycle as string);
		const second = open[0];
		expect(second?.state).toBe("open");
		expect(second?.acknowledgedAt).toBeNull();
		expect(second?.acknowledgedBy).toBeNull();
		expect(second?.closedAt).toBeNull();
		expect(second?.metadata).toEqual({});
	});
});

describe("threshold direction changes", () => {
	test("a fresh low reading resolves the open high alert and opens a low alert", async () => {
		const asset = assetIds.direction as string;

		await reading(asset, "high", 15.9, at(-3));
		await freshSource(asset, at(-1));
		await alerts.evaluateSite(fixture.siteId, NOW);
		const high = await activeAlerts(asset);
		expect(high.length).toBe(1);
		expect(high[0]?.thresholdKind).toBe("max");
		const highId = high[0]?.id as string;

		await reading(asset, "low-after-high", 11.2, at(5));
		await freshSource(asset, at(5));
		await alerts.evaluateSite(fixture.siteId, at(6));

		const now = await activeAlerts(asset);
		expect(now.length).toBe(1);
		expect(now[0]?.thresholdKind).toBe("min");
		expect(now[0]?.id).not.toBe(highId);

		const closedHigh = await db.siteOpsAlert.findUniqueOrThrow({
			where: { id: highId },
		});
		expect(closedHigh.state).toBe("closed");
		expect(closedHigh.activeKey).toBeNull();
		expect(closedHigh.observedValue).toBe(15.9);
	});
});

describe("authorization and the dispatch gate", () => {
	async function openAlertId(): Promise<string> {
		const open = await activeAlerts(assetIds.lifecycle as string);
		return open[0]?.id as string;
	}

	test("a non-member cannot read site operations", async () => {
		expect(commands.assertCanView(strangerId)).rejects.toThrow(/membership/i);
	});

	test("an open alert cannot create a service task", async () => {
		const alertId = await openAlertId();
		expect(
			commands.createTaskFromAlert(adminId, {
				alertId,
				commandId: createTaskCommandId(alertId),
				title: "Inspect generator battery",
				description: "",
			}),
		).rejects.toThrow(/Acknowledge this alert/i);
	});

	test("a member may acknowledge an alert", async () => {
		const alertId = await openAlertId();
		const result = await commands.acknowledgeAlert(
			memberId,
			{
				alertId,
				commandId: acknowledgeCommandId(alertId),
				note: "Reviewed on shift handover.",
			},
			NOW,
		);
		expect(result.changed).toBe(true);
		expect(result.alert.state).toBe("acknowledged");
		expect(result.alert.acknowledgedBy).toBe(memberId);
	});

	test("a member may NOT create a service task", async () => {
		const alertId = await openAlertId();
		expect(
			commands.createTaskFromAlert(memberId, {
				alertId,
				commandId: createTaskCommandId(alertId),
				title: "Inspect generator battery",
				description: "",
			}),
		).rejects.toThrow(/owner or admin/i);
	});

	test("a mismatched commandId is rejected", async () => {
		const alertId = await openAlertId();
		expect(
			commands.createTaskFromAlert(adminId, {
				alertId,
				commandId: createTaskCommandId("some-other-alert"),
				title: "Inspect generator battery",
				description: "",
			}),
		).rejects.toThrow(/commandId/i);
	});

	test("an unauthorized or premature attempt leaves no event behind", async () => {
		const events = await db.lumensOsEvent.count({
			where: {
				eventType: "task.create",
				businessUnitId: fixture.businessUnitId,
			},
		});
		expect(events).toBe(0);
	});

	test("a closed alert cannot create a service task", async () => {
		const closed = await db.siteOpsAlert.findFirstOrThrow({
			where: { assetId: assetIds.lifecycle as string, state: "closed" },
			select: { id: true },
		});
		expect(
			commands.createTaskFromAlert(adminId, {
				alertId: closed.id,
				commandId: createTaskCommandId(closed.id),
				title: "Inspect generator battery",
				description: "",
			}),
		).rejects.toThrow(/closed alert/i);
	});
});

describe("create service task", () => {
	let alertId: string;

	beforeAll(async () => {
		const open = await activeAlerts(assetIds.lifecycle as string);
		alertId = open[0]?.id as string;
	});

	test("an acknowledged alert creates one event carrying full provenance", async () => {
		const result = await commands.createTaskFromAlert(adminId, {
			alertId,
			commandId: createTaskCommandId(alertId),
			title: "Inspect generator battery",
			description: "Battery voltage alert requires field review.",
		});

		expect(result.accepted).toBe(true);
		expect(result.created).toBe(true);

		const event = await db.lumensOsEvent.findUniqueOrThrow({
			where: { id: result.eventId },
		});
		expect(event.eventType).toBe("task.create");
		expect(event.aggregateType).toBe("alert");
		expect(event.aggregateId).toBe(alertId);
		expect(event.businessUnitId).toBe(fixture.businessUnitId);

		const payload = parseSiteTaskCommandEvent(event.payload);
		expect(payload.commandId).toBe(createTaskCommandId(alertId));
		expect(payload.data.siteId).toBe(fixture.siteId);
		expect(payload.data.assetId).toBe(assetIds.lifecycle as string);
		expect(payload.data.requestedBy).toBe(adminId);
		expect(payload.data.origin).toEqual({
			provider: "lumens",
			surface: "lumens-site-operations",
		});
	});

	test("replaying the same commandId returns the same event and creates nothing", async () => {
		const replay = await commands.createTaskFromAlert(adminId, {
			alertId,
			commandId: createTaskCommandId(alertId),
			title: "Inspect generator battery",
			description: "Battery voltage alert requires field review.",
		});
		expect(replay.created).toBe(false);

		const count = await db.lumensOsEvent.count({
			where: { eventType: "task.create", aggregateId: alertId },
		});
		expect(count).toBe(1);
	});

	test("concurrent duplicate commands resolve to one event and never leak P2002", async () => {
		const second = await db.siteOpsAlert.create({
			data: {
				siteId: fixture.siteId,
				assetId: fixture.assetId,
				alertType: "threshold_breach",
				severity: "warning",
				state: "acknowledged",
				reason: "Concurrency probe.",
				provider: PILOT.provider,
				metric: PILOT.metric,
				occurrenceKey: `concurrency-${suffix}`,
				acknowledgedAt: NOW,
				acknowledgedBy: adminId,
			},
			select: { id: true },
		});

		const command = {
			alertId: second.id,
			commandId: createTaskCommandId(second.id),
			title: "Inspect generator battery",
			description: "",
		};

		const results = await Promise.all([
			commands.createTaskFromAlert(adminId, command),
			commands.createTaskFromAlert(adminId, command),
			commands.createTaskFromAlert(adminId, command),
		]);

		const ids = new Set(results.map((result) => result.eventId));
		expect(ids.size).toBe(1);
		expect(results.filter((result) => result.created).length).toBe(1);

		const count = await db.lumensOsEvent.count({
			where: { eventType: "task.create", aggregateId: second.id },
		});
		expect(count).toBe(1);
	});

	test("task.create queues no Gauzy execution task while no downstream exists", async () => {
		const tasks = await db.agentTask.count({
			where: {
				kind: "gauzy_operation",
				businessUnitId: fixture.businessUnitId,
			},
		});
		expect(tasks).toBe(0);
	});

	test("the alert keeps its link to the durable event, still pending", async () => {
		const alert = await db.siteOpsAlert.findUniqueOrThrow({
			where: { id: alertId },
			select: { lumensOsEventId: true },
		});
		expect(alert.lumensOsEventId).toBeTruthy();

		const detail = await sites.assetDetail(
			{ assetId: assetIds.lifecycle as string, historyLimit: 50 },
			NOW,
		);
		const task = detail.serviceTasks.find((row) => row.alertId === alertId);
		expect(task?.status).toBe("pending");
	});
});
