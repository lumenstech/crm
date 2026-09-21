import type { Db } from "@crm/db";
import type {
	AlertSeverity,
	SignalState,
	SiteAssetType,
	SiteOperationalStatus,
	SourceHealthStatus,
	ThresholdKind,
} from "@crm/validation/site-operations";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { GAUZY_OPERATION_TASK } from "../lumens-os/operational-events";
import {
	assetStatusFrom,
	deriveSignalState,
	deriveSourceHealthStatus,
	isUnhealthy,
	type MetricState,
	type ObservationFacts,
	type PolicyFacts,
	type SourceHealthFacts,
	siteStatusFrom,
} from "./monitoring";
import type {
	AlertSummary,
	AssetDetailInput,
	AssetDetailOutput,
	AssetSummary,
	MetricStateDto,
	OperationsOverviewOutput,
	SiteOverviewInput,
	SiteOverviewOutput,
	SiteSummary,
	SourceHealthSummary,
} from "./site-ops.contracts";
import { SITE_OPS } from "./site-ops-config";

type LatestObservationRow = {
	id: string;
	assetId: string;
	metric: string;
	provider: string;
	sourceEventId: string;
	numericValue: number | null;
	textValue: string | null;
	unit: string | null;
	observedAt: Date;
	receivedAt: Date;
	validation: string;
	rejectionCode: string | null;
};

function key(assetId: string, metric: string): string {
	return `${assetId}::${metric}`;
}

function toFacts(row: LatestObservationRow): ObservationFacts {
	return {
		id: row.id,
		observedAt: row.observedAt,
		receivedAt: row.receivedAt,
		numericValue: row.numericValue,
		textValue: row.textValue,
		unit: row.unit,
		provider: row.provider,
		sourceEventId: row.sourceEventId,
		validation: row.validation,
		rejectionCode: row.rejectionCode,
	};
}

function toMetricStateDto(state: MetricState): MetricStateDto {
	return {
		metric: state.metric,
		state: state.state,
		reason: state.reason,
		value: state.value,
		unit: state.unit,
		observedAt: state.observedAt?.toISOString() ?? null,
		receivedAt: state.receivedAt?.toISOString() ?? null,
		ageSeconds: state.ageSeconds,
		provider: state.provider,
		sourceEventId: state.sourceEventId,
		observationId: state.observationId,
		validation: state.validation,
		staleAfterSeconds: state.staleAfterSeconds,
	};
}

function secondsBetween(from: Date | null, now: Date): number | null {
	if (!from) return null;
	return Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
}

@Injectable()
export class SiteOpsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async operationsOverview(
		now = new Date(),
	): Promise<OperationsOverviewOutput> {
		const sites = await this.db.siteOpsSite.findMany({
			select: { id: true },
			orderBy: { name: "asc" },
		});

		const summaries: SiteSummary[] = [];
		for (const site of sites) {
			summaries.push(await this.siteSummary(site.id, now));
		}

		const alerts = await this.db.siteOpsAlert.groupBy({
			by: ["severity"],
			where: { state: { in: ["open", "acknowledged"] } },
			_count: { _all: true },
		});
		const activeAlertCount = alerts.reduce(
			(total, row) => total + row._count._all,
			0,
		);
		const criticalAlertCount =
			alerts.find((row) => row.severity === "critical")?._count._all ?? 0;

		const healthRows = await this.db.siteOpsSourceHealth.findMany({
			select: {
				status: true,
				lastSuccessAt: true,
				expectedIntervalSeconds: true,
			},
		});
		let failedSourceCount = 0;
		let staleSourceCount = 0;
		for (const row of healthRows) {
			const status = deriveSourceHealthStatus({
				stored: row.status as SourceHealthStatus,
				lastSuccessAt: row.lastSuccessAt,
				expectedIntervalSeconds: row.expectedIntervalSeconds,
				now,
			});
			if (status === "failed") failedSourceCount += 1;
			if (status === "degraded" || status === "unknown") staleSourceCount += 1;
		}

		const openServiceTaskCount = await this.db.lumensOsEvent.count({
			where: {
				eventType: "task.create",
				aggregateType: "alert",
				status: { in: ["pending", "processing"] },
			},
		});

		return {
			siteCount: summaries.length,
			sitesNeedingAttention: summaries.filter(
				(site) => site.status !== "normal",
			).length,
			activeAlertCount,
			criticalAlertCount,
			failedSourceCount,
			staleSourceCount,
			openServiceTaskCount,
			sites: summaries,
		};
	}

	async siteList(
		status: SiteOperationalStatus | null,
		now = new Date(),
	): Promise<{ sites: SiteSummary[] }> {
		const sites = await this.db.siteOpsSite.findMany({
			select: { id: true },
			orderBy: { name: "asc" },
		});
		const summaries: SiteSummary[] = [];
		for (const site of sites) {
			const summary = await this.siteSummary(site.id, now);
			if (!status || summary.status === status) summaries.push(summary);
		}
		return { sites: summaries };
	}

	async siteOverview(
		input: SiteOverviewInput,
		now = new Date(),
	): Promise<SiteOverviewOutput> {
		const site = await this.loadSite(input.siteId);
		const assets = await this.assetSummaries(site.id, now);
		const activeAlerts = await this.alertSummaries({
			where: { siteId: site.id, state: { in: ["open", "acknowledged"] } },
			now,
		});
		const sourceHealth = await this.sourceHealthSummaries(site.id, now);

		return {
			site: await this.siteSummary(site.id, now, {
				assets,
				activeAlerts,
				sourceHealth,
			}),
			assets,
			activeAlerts,
			sourceHealth,
		};
	}

	async assetDetail(
		input: AssetDetailInput,
		now = new Date(),
	): Promise<AssetDetailOutput> {
		const asset = await this.db.siteOpsAsset.findUnique({
			where: { id: input.assetId },
			select: { id: true, siteId: true },
		});
		if (!asset) {
			throw new NotFoundException(`No site asset with id ${input.assetId}.`);
		}

		const assets = await this.assetSummaries(asset.siteId, now, asset.id);
		const summary = assets[0];
		if (!summary) {
			throw new NotFoundException(`No site asset with id ${input.assetId}.`);
		}

		const policies = await this.db.siteOpsMonitoringPolicy.findMany({
			where: { assetId: asset.id },
			orderBy: { metric: "asc" },
		});

		const observations = await this.db.siteOpsObservation.findMany({
			where: { assetId: asset.id },
			orderBy: { observedAt: "desc" },
			take: input.historyLimit,
		});

		const openAlerts = await this.alertSummaries({
			where: { assetId: asset.id, state: { in: ["open", "acknowledged"] } },
			now,
		});

		const alertIds = await this.db.siteOpsAlert.findMany({
			where: { assetId: asset.id },
			select: { id: true },
		});
		const events = await this.db.lumensOsEvent.findMany({
			where: {
				eventType: "task.create",
				aggregateType: "alert",
				aggregateId: { in: alertIds.map((row) => row.id) },
			},
			orderBy: { createdAt: "desc" },
			take: SITE_OPS.alert.recentTaskLimit,
			select: {
				id: true,
				aggregateId: true,
				status: true,
				attempts: true,
				lastError: true,
				createdAt: true,
				processedAt: true,
			},
		});

		return {
			asset: summary,
			site: await this.siteSummary(asset.siteId, now),
			policies: policies.map((policy) => ({
				id: policy.id,
				metric: policy.metric,
				unit: policy.unit,
				enabled: policy.enabled,
				expectedIntervalSeconds: policy.expectedIntervalSeconds,
				staleAfterSeconds: policy.staleAfterSeconds,
				minValue: policy.minValue,
				maxValue: policy.maxValue,
				alertSeverity: policy.alertSeverity as AlertSeverity,
			})),
			observations: observations.map((observation) => ({
				id: observation.id,
				provider: observation.provider,
				sourceEventId: observation.sourceEventId,
				metric: observation.metric,
				numericValue: observation.numericValue,
				textValue: observation.textValue,
				unit: observation.unit,
				observedAt: observation.observedAt.toISOString(),
				receivedAt: observation.receivedAt.toISOString(),
				validation: observation.validation as
					| "accepted"
					| "invalid"
					| "rejected",
				rejectionCode: observation.rejectionCode,
				evidenceRef: observation.evidenceRef,
			})),
			openAlerts,
			sourceHealth: (
				await this.sourceHealthSummaries(asset.siteId, now)
			).filter((row) => row.assetId === null || row.assetId === asset.id),
			serviceTasks: events.map((event) => ({
				eventId: event.id,
				alertId: event.aggregateId,
				status: event.status,
				attempts: event.attempts,
				lastError: event.lastError,
				createdAt: event.createdAt.toISOString(),
				processedAt: event.processedAt?.toISOString() ?? null,
			})),
		};
	}

	async loadSite(siteId: string) {
		const site = await this.db.siteOpsSite.findUnique({
			where: { id: siteId },
		});
		if (!site) throw new NotFoundException(`No site with id ${siteId}.`);
		return site;
	}

	async metricStatesFor(
		siteId: string,
		now: Date,
		assetId?: string,
	): Promise<Map<string, MetricState[]>> {
		const policyWhere = assetId
			? { asset: { siteId }, assetId }
			: { asset: { siteId } };
		const policies = await this.db.siteOpsMonitoringPolicy.findMany({
			where: policyWhere,
			orderBy: { metric: "asc" },
		});

		const [latest, latestAccepted, health] = await Promise.all([
			this.latestObservations(siteId, false),
			this.latestObservations(siteId, true),
			this.db.siteOpsSourceHealth.findMany({ where: { siteId } }),
		]);

		const byAsset = new Map<string, MetricState[]>();
		for (const policy of policies) {
			const facts: PolicyFacts = {
				metric: policy.metric,
				unit: policy.unit,
				enabled: policy.enabled,
				expectedIntervalSeconds: policy.expectedIntervalSeconds,
				staleAfterSeconds: policy.staleAfterSeconds,
				minValue: policy.minValue,
				maxValue: policy.maxValue,
				alertSeverity: policy.alertSeverity,
			};
			const latestRow = latest.get(key(policy.assetId, policy.metric));
			const acceptedRow = latestAccepted.get(
				key(policy.assetId, policy.metric),
			);
			const provider = latestRow?.provider ?? acceptedRow?.provider ?? null;
			const healthRow =
				health.find(
					(row) => row.assetId === policy.assetId && row.provider === provider,
				) ??
				health.find((row) => row.assetId === policy.assetId) ??
				health.find(
					(row) => row.assetId === null && row.provider === provider,
				) ??
				health.find((row) => row.assetId === null);

			const sourceHealth: SourceHealthFacts | null = healthRow
				? {
						provider: healthRow.provider,
						status: deriveSourceHealthStatus({
							stored: healthRow.status as SourceHealthStatus,
							lastSuccessAt: healthRow.lastSuccessAt,
							expectedIntervalSeconds: healthRow.expectedIntervalSeconds,
							now,
						}),
						lastAttemptAt: healthRow.lastAttemptAt,
						lastSuccessAt: healthRow.lastSuccessAt,
						lastError: healthRow.lastError,
						expectedIntervalSeconds: healthRow.expectedIntervalSeconds,
					}
				: null;

			const state = deriveSignalState({
				policy: facts,
				latest: latestRow ? toFacts(latestRow) : null,
				latestAccepted: acceptedRow ? toFacts(acceptedRow) : null,
				sourceHealth,
				now,
			});

			const list = byAsset.get(policy.assetId) ?? [];
			list.push(state);
			byAsset.set(policy.assetId, list);
		}

		return byAsset;
	}

	private async latestObservations(
		siteId: string,
		acceptedOnly: boolean,
	): Promise<Map<string, LatestObservationRow>> {
		const rows = acceptedOnly
			? await this.db.$queryRaw<LatestObservationRow[]>`
					SELECT DISTINCT ON (asset_id, metric)
						id, asset_id AS "assetId", metric, provider,
						source_event_id AS "sourceEventId", numeric_value AS "numericValue",
						text_value AS "textValue", unit, observed_at AS "observedAt",
						received_at AS "receivedAt", validation,
						rejection_code AS "rejectionCode"
					FROM site_ops_observation
					WHERE site_id = ${siteId} AND validation = 'accepted'
					ORDER BY asset_id, metric, observed_at DESC
				`
			: await this.db.$queryRaw<LatestObservationRow[]>`
					SELECT DISTINCT ON (asset_id, metric)
						id, asset_id AS "assetId", metric, provider,
						source_event_id AS "sourceEventId", numeric_value AS "numericValue",
						text_value AS "textValue", unit, observed_at AS "observedAt",
						received_at AS "receivedAt", validation,
						rejection_code AS "rejectionCode"
					FROM site_ops_observation
					WHERE site_id = ${siteId}
					ORDER BY asset_id, metric, observed_at DESC
				`;

		return new Map(rows.map((row) => [key(row.assetId, row.metric), row]));
	}

	private async assetSummaries(
		siteId: string,
		now: Date,
		assetId?: string,
	): Promise<AssetSummary[]> {
		const assetWhere = assetId ? { siteId, id: assetId } : { siteId };
		const assets = await this.db.siteOpsAsset.findMany({
			where: assetWhere,
			orderBy: { name: "asc" },
		});
		const states = await this.metricStatesFor(siteId, now, assetId);
		const openAlerts = await this.db.siteOpsAlert.groupBy({
			by: ["assetId", "severity"],
			where: { siteId, state: { in: ["open", "acknowledged"] } },
			_count: { _all: true },
		});

		return assets.map((asset) => {
			const metricStates = states.get(asset.id) ?? [];
			const severities = openAlerts
				.filter((row) => row.assetId === asset.id)
				.flatMap((row) =>
					Array.from<AlertSeverity>({ length: row._count._all }).fill(
						row.severity as AlertSeverity,
					),
				);
			return {
				id: asset.id,
				siteId: asset.siteId,
				code: asset.code,
				name: asset.name,
				assetType: asset.assetType as SiteAssetType,
				manufacturer: asset.manufacturer,
				model: asset.model,
				serialNumber: asset.serialNumber,
				externalReference: asset.externalReference,
				operationalStatus: assetStatusFrom({
					metricStates: metricStates.map((state) => state.state),
					openAlertSeverities: severities,
				}),
				metricStates: metricStates.map(toMetricStateDto),
				openAlertCount: severities.length,
			};
		});
	}

	private async sourceHealthSummaries(
		siteId: string,
		now: Date,
	): Promise<SourceHealthSummary[]> {
		const rows = await this.db.siteOpsSourceHealth.findMany({
			where: { siteId },
			include: { asset: { select: { name: true } } },
			orderBy: { provider: "asc" },
		});
		return rows.map((row) => ({
			provider: row.provider,
			siteId: row.siteId,
			assetId: row.assetId,
			assetName: row.asset?.name ?? null,
			status: deriveSourceHealthStatus({
				stored: row.status as SourceHealthStatus,
				lastSuccessAt: row.lastSuccessAt,
				expectedIntervalSeconds: row.expectedIntervalSeconds,
				now,
			}),
			lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
			lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
			lastError: row.lastError,
			expectedIntervalSeconds: row.expectedIntervalSeconds,
			secondsSinceSuccess: secondsBetween(row.lastSuccessAt, now),
		}));
	}

	async alertSummaries(args: {
		where: Parameters<Db["siteOpsAlert"]["findMany"]>[0] extends
			| { where?: infer W }
			| undefined
			? W
			: never;
		now: Date;
	}): Promise<AlertSummary[]> {
		const alerts = await this.db.siteOpsAlert.findMany({
			where: args.where,
			orderBy: [{ severity: "desc" }, { openedAt: "desc" }],
			include: {
				site: { select: { name: true } },
				asset: { select: { name: true } },
			},
		});

		const events = await this.db.lumensOsEvent.findMany({
			where: {
				eventType: "task.create",
				aggregateType: "alert",
				aggregateId: { in: alerts.map((alert) => alert.id) },
			},
			select: { aggregateId: true, status: true },
		});
		const statusByAlert = new Map(
			events.map((event) => [event.aggregateId, event.status]),
		);

		const acknowledgerIds = alerts
			.map((alert) => alert.acknowledgedBy)
			.filter((value): value is string => Boolean(value));
		const users = acknowledgerIds.length
			? await this.db.user.findMany({
					where: { id: { in: acknowledgerIds } },
					select: { id: true, name: true },
				})
			: [];
		const nameById = new Map(users.map((user) => [user.id, user.name]));

		return alerts.map((alert) => ({
			id: alert.id,
			siteId: alert.siteId,
			siteName: alert.site.name,
			assetId: alert.assetId,
			assetName: alert.asset.name,
			observationId: alert.observationId,
			alertType: alert.alertType as "threshold_breach",
			severity: alert.severity as AlertSeverity,
			state: alert.state as "open" | "acknowledged" | "closed",
			reason: alert.reason,
			provider: alert.provider,
			metric: alert.metric,
			observedValue: alert.observedValue,
			thresholdKind: alert.thresholdKind as ThresholdKind | null,
			thresholdValue: alert.thresholdValue,
			openedAt: alert.openedAt.toISOString(),
			ageSeconds: secondsBetween(alert.openedAt, args.now) ?? 0,
			acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
			acknowledgedBy: alert.acknowledgedBy,
			acknowledgedByName: alert.acknowledgedBy
				? (nameById.get(alert.acknowledgedBy) ?? null)
				: null,
			closedAt: alert.closedAt?.toISOString() ?? null,
			lumensOsEventId: alert.lumensOsEventId,
			serviceTaskStatus: statusByAlert.get(alert.id) ?? null,
		}));
	}

	private async siteSummary(
		siteId: string,
		now: Date,
		preloaded?: {
			assets: AssetSummary[];
			activeAlerts: AlertSummary[];
			sourceHealth: SourceHealthSummary[];
		},
	): Promise<SiteSummary> {
		const site = await this.db.siteOpsSite.findUnique({
			where: { id: siteId },
			include: { company: { select: { name: true } } },
		});
		if (!site) throw new NotFoundException(`No site with id ${siteId}.`);

		const assets =
			preloaded?.assets ?? (await this.assetSummaries(siteId, now));
		const activeAlerts =
			preloaded?.activeAlerts ??
			(await this.alertSummaries({
				where: { siteId, state: { in: ["open", "acknowledged"] } },
				now,
			}));
		const sourceHealth =
			preloaded?.sourceHealth ??
			(await this.sourceHealthSummaries(siteId, now));

		const metricStates: SignalState[] = assets.flatMap((asset) =>
			asset.metricStates.map((state) => state.state),
		);

		const latest = await this.db.siteOpsObservation.findFirst({
			where: { siteId, validation: "accepted" },
			orderBy: { observedAt: "desc" },
			select: { observedAt: true },
		});

		return {
			id: site.id,
			code: site.code,
			name: site.name,
			timezone: site.timezone,
			status: siteStatusFrom({
				metricStates,
				openAlertSeverities: activeAlerts.map((alert) => alert.severity),
			}),
			addressLine: site.addressLine,
			locality: site.locality,
			region: site.region,
			countryCode: site.countryCode,
			companyId: site.companyId,
			companyName: site.company?.name ?? null,
			assetCount: assets.length,
			openAlertCount: activeAlerts.length,
			unhealthySourceCount: sourceHealth.filter((row) => row.status !== "ok")
				.length,
			lastObservationAt: latest?.observedAt.toISOString() ?? null,
		};
	}

	unhealthyStates(states: readonly SignalState[]): SignalState[] {
		return states.filter(isUnhealthy);
	}

	gauzyOperationTaskKind(): string {
		return GAUZY_OPERATION_TASK;
	}
}
