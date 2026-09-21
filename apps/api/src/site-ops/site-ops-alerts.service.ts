import type { Db } from "@crm/db";
import {
	thresholdActiveKey,
	thresholdOccurrenceKey,
} from "@crm/validation/site-operations";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	evaluateThresholds,
	type PolicyFacts,
	type ThresholdEvaluation,
} from "./monitoring";
import { SiteOpsService } from "./site-ops.service";

export type EvaluationResult = {
	openedAlertIds: string[];
	closedAlertIds: string[];
	unprovenAssetMetrics: string[];
};

@Injectable()
export class SiteOpsAlertsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly sites: SiteOpsService,
	) {}

	/**
	 * Detection is automatic. Dispatch is not: this opens and closes alerts and
	 * never creates a service task. A human does that through
	 * `siteOps.createTaskFromAlert`, and only after acknowledging.
	 *
	 * A threshold alert closes only when a fresh accepted reading proves the
	 * condition is over. Losing telemetry is not recovery, so stale, missing,
	 * source_failed, invalid and not_configured leave every alert untouched.
	 */
	async evaluateSite(
		siteId: string,
		now = new Date(),
	): Promise<EvaluationResult> {
		const states = await this.sites.metricStatesFor(siteId, now);
		const policies = await this.db.siteOpsMonitoringPolicy.findMany({
			where: { asset: { siteId }, enabled: true },
		});
		const policyByKey = new Map(
			policies.map((policy) => [`${policy.assetId}::${policy.metric}`, policy]),
		);

		const openedAlertIds: string[] = [];
		const closedAlertIds: string[] = [];
		const unprovenAssetMetrics: string[] = [];

		for (const [assetId, metricStates] of states) {
			for (const state of metricStates) {
				const policy = policyByKey.get(`${assetId}::${state.metric}`);
				if (!policy) continue;

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

				const evaluations = evaluateThresholds({ state, policy: facts });
				if (!evaluations) {
					unprovenAssetMetrics.push(`${assetId}::${state.metric}`);
					continue;
				}

				for (const evaluation of evaluations) {
					const activeKey = thresholdActiveKey(
						assetId,
						state.metric,
						evaluation.kind,
					);
					const active = await this.db.siteOpsAlert.findUnique({
						where: { activeKey },
						select: { id: true },
					});

					if (evaluation.violated) {
						if (active) continue;
						const opened = await this.openAlert({
							siteId,
							assetId,
							observationId: state.observationId,
							provider: state.provider,
							metric: state.metric,
							activeKey,
							evaluation,
							now,
						});
						if (opened) openedAlertIds.push(opened);
						continue;
					}

					if (!active) continue;
					await this.db.siteOpsAlert.update({
						where: { id: active.id },
						data: { state: "closed", closedAt: now, activeKey: null },
					});
					closedAlertIds.push(active.id);
				}
			}
		}

		return { openedAlertIds, closedAlertIds, unprovenAssetMetrics };
	}

	private async openAlert(input: {
		siteId: string;
		assetId: string;
		observationId: string | null;
		provider: string | null;
		metric: string;
		activeKey: string;
		evaluation: ThresholdEvaluation;
		now: Date;
	}): Promise<string | null> {
		const occurrenceKey = thresholdOccurrenceKey(
			input.assetId,
			input.metric,
			input.evaluation.kind,
			input.observationId ?? `t${input.now.getTime()}`,
		);

		const existing = await this.db.siteOpsAlert.findUnique({
			where: { occurrenceKey },
			select: { id: true },
		});
		if (existing) return null;

		const created = await this.db.siteOpsAlert.create({
			data: {
				siteId: input.siteId,
				assetId: input.assetId,
				observationId: input.observationId,
				alertType: "threshold_breach",
				severity: input.evaluation.severity,
				state: "open",
				reason: input.evaluation.reason,
				provider: input.provider,
				metric: input.metric,
				observedValue: input.evaluation.observedValue,
				thresholdKind: input.evaluation.kind,
				thresholdValue: input.evaluation.thresholdValue,
				occurrenceKey,
				activeKey: input.activeKey,
				openedAt: input.now,
			},
			select: { id: true },
		});
		return created.id;
	}
}
