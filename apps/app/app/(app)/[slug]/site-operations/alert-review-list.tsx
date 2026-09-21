"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Empty } from "@crm/ui/components/empty";
import {
	acknowledgeCommandId,
	createTaskCommandId,
} from "@crm/validation/site-operations";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatAge } from "@/lib/site-ops/presentation";
import { useTRPC } from "@/lib/trpc/client";
import {
	AlertSeverityBadge,
	AlertStateBadge,
	MetricLabel,
} from "./site-ops-parts";

/**
 * Nothing downstream executes a site service task yet, so the UI reports what
 * Lumens OS actually holds. It never says dispatched, created or assigned, because
 * no technician has been sent.
 */
const SERVICE_TASK_LABEL = {
	pending: "Requested, awaiting a work-order executor",
	processing: "Requested, executor running",
	processed: "Accepted downstream",
	failed: "Request failed downstream",
} as const;

function serviceTaskLabel(status: string): string {
	return status in SERVICE_TASK_LABEL
		? SERVICE_TASK_LABEL[status as keyof typeof SERVICE_TASK_LABEL]
		: `Requested (${status})`;
}

export type AlertRow = {
	id: string;
	siteId: string;
	siteName: string;
	assetId: string;
	assetName: string;
	observationId: string | null;
	severity: "info" | "warning" | "critical";
	state: "open" | "acknowledged" | "closed";
	reason: string;
	provider: string | null;
	metric: string | null;
	observedValue: number | null;
	thresholdKind: "min" | "max" | null;
	thresholdValue: number | null;
	openedAt: string;
	ageSeconds: number;
	acknowledgedByName: string | null;
	lumensOsEventId: string | null;
	serviceTaskStatus: string | null;
};

export function AlertReviewList({
	alerts,
	siteId,
}: {
	alerts: AlertRow[];
	siteId?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	async function refresh() {
		await queryClient.invalidateQueries({
			queryKey: trpc.siteOps.overview.queryKey(),
		});
		if (siteId) {
			await queryClient.invalidateQueries({
				queryKey: trpc.siteOps.siteOverview.queryKey({ siteId }),
			});
		}
	}

	const acknowledge = useMutation(
		trpc.siteOps.acknowledgeAlert.mutationOptions({
			onSuccess: async () => {
				toast.success("Alert acknowledged.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const createTask = useMutation(
		trpc.siteOps.createTaskFromAlert.mutationOptions({
			onSuccess: async (result) => {
				toast.success(
					result.created
						? "Service task requested. Lumens OS holds the command until a work-order executor runs it."
						: "That service task is already requested. Nothing was duplicated.",
				);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (alerts.length === 0) {
		return <Empty>No active alerts.</Empty>;
	}

	return (
		<ul className="flex flex-col gap-3">
			{alerts.map((alert) => (
				<li
					key={alert.id}
					className="flex flex-col gap-3 rounded-lg border border-border p-4"
				>
					<div className="flex flex-wrap items-center gap-3">
						<AlertSeverityBadge severity={alert.severity} />
						<AlertStateBadge state={alert.state} />
						<span className="text-muted-foreground text-xs">
							opened {formatAge(alert.ageSeconds)}
						</span>
					</div>

					<p className="font-medium text-sm">{alert.reason}</p>

					<dl className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<div className="flex gap-1">
							<dt>Site</dt>
							<dd className="text-foreground">{alert.siteName}</dd>
						</div>
						<div className="flex gap-1">
							<dt>Asset</dt>
							<dd className="text-foreground">{alert.assetName}</dd>
						</div>
						{alert.metric ? (
							<div className="flex items-center gap-1">
								<dt>Metric</dt>
								<dd>
									<MetricLabel metric={alert.metric} />
								</dd>
							</div>
						) : null}
						{alert.provider ? (
							<div className="flex items-center gap-1">
								<dt>Source</dt>
								<dd>
									<Badge variant="mono">{alert.provider}</Badge>
								</dd>
							</div>
						) : null}
						{alert.observedValue !== null && alert.thresholdValue !== null ? (
							<div className="flex gap-1">
								<dt>Reading</dt>
								<dd className="text-foreground tabular-nums">
									{alert.observedValue} vs {alert.thresholdKind}{" "}
									{alert.thresholdValue}
								</dd>
							</div>
						) : null}
						<div className="flex gap-1">
							<dt>Observation</dt>
							<dd>
								{alert.observationId ? (
									<Badge variant="mono">{alert.observationId}</Badge>
								) : (
									"not retained"
								)}
							</dd>
						</div>
						{alert.acknowledgedByName ? (
							<div className="flex gap-1">
								<dt>Reviewed by</dt>
								<dd className="text-foreground">{alert.acknowledgedByName}</dd>
							</div>
						) : null}
						{alert.serviceTaskStatus ? (
							<div className="flex gap-1">
								<dt>Service task</dt>
								<dd className="text-foreground">
									{serviceTaskLabel(alert.serviceTaskStatus)}
								</dd>
							</div>
						) : null}
					</dl>

					{alert.state !== "acknowledged" && !alert.lumensOsEventId ? (
						<p className="text-muted-foreground text-xs">
							Acknowledge this alert to request a service task.
						</p>
					) : null}

					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							disabled={alert.state === "acknowledged" || acknowledge.isPending}
							onClick={() =>
								acknowledge.mutate({
									alertId: alert.id,
									commandId: acknowledgeCommandId(alert.id),
									note: null,
								})
							}
						>
							Acknowledge
						</Button>
						<Button
							size="sm"
							disabled={
								createTask.isPending ||
								alert.state !== "acknowledged" ||
								Boolean(alert.lumensOsEventId)
							}
							onClick={() =>
								createTask.mutate({
									alertId: alert.id,
									commandId: createTaskCommandId(alert.id),
									title: `Inspect ${alert.assetName}`,
									description: alert.reason,
								})
							}
						>
							{alert.lumensOsEventId
								? "Service task requested"
								: "Request service task"}
						</Button>
					</div>
				</li>
			))}
		</ul>
	);
}
