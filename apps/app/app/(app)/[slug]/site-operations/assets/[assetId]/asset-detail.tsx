"use client";

import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Empty } from "@crm/ui/components/empty";
import { Spinner } from "@crm/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { formatInterval, formatReading } from "@/lib/site-ops/presentation";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { AlertReviewList } from "../../alert-review-list";
import {
	MetricLabel,
	Reading,
	SiteStatusBadge,
	SourceStatusBadge,
} from "../../site-ops-parts";

const TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
};

export function AssetDetail({
	assetId,
	historyLimit,
}: {
	assetId: string;
	historyLimit: number;
}) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const { data, isPending } = useQuery(
		trpc.siteOps.assetDetail.queryOptions({ assetId, historyLimit }),
	);

	if (isPending) return <Spinner />;
	if (!data) return null;

	const { asset, site, policies, observations, openAlerts, sourceHealth } =
		data;

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-2">
				<Link
					href={workspaceUrl(`/site-operations/sites/${site.id}`)}
					className="text-muted-foreground text-xs hover:underline"
				>
					{site.name}
				</Link>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-medium text-xl">{asset.name}</h1>
					<SiteStatusBadge status={asset.operationalStatus} />
					<Badge variant="token">{asset.assetType.replaceAll("_", " ")}</Badge>
					<Badge variant="mono">{asset.code}</Badge>
				</div>
				<p className="text-muted-foreground text-xs">
					{[asset.manufacturer, asset.model, asset.serialNumber]
						.filter(Boolean)
						.join(" · ") || "No nameplate data recorded"}
				</p>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Current state</CardTitle>
				</CardHeader>
				<CardContent>
					{asset.metricStates.length === 0 ? (
						<Empty>No metric is monitored on this asset.</Empty>
					) : (
						<ul className="flex flex-col gap-4">
							{asset.metricStates.map((metric) => (
								<li key={metric.metric} className="flex flex-col gap-2">
									<MetricLabel metric={metric.metric} />
									<Reading metric={metric} />
									<p className="text-muted-foreground text-xs">
										{metric.reason}
									</p>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Monitoring policy</CardTitle>
				</CardHeader>
				<CardContent>
					{policies.length === 0 ? (
						<Empty>
							Nothing is expected from this asset, so nothing can be reported
							missing.
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Metric</TableHead>
									<TableHead>Expected every</TableHead>
									<TableHead>Stale after</TableHead>
									<TableHead>Minimum</TableHead>
									<TableHead>Maximum</TableHead>
									<TableHead>Enabled</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{policies.map((policy) => (
									<TableRow key={policy.id}>
										<TableCell>
											<MetricLabel metric={policy.metric} />
										</TableCell>
										<TableCell>
											{formatInterval(policy.expectedIntervalSeconds)}
										</TableCell>
										<TableCell>
											{formatInterval(policy.staleAfterSeconds)}
										</TableCell>
										<TableCell className="tabular-nums">
											{formatReading(policy.minValue, policy.unit)}
										</TableCell>
										<TableCell className="tabular-nums">
											{formatReading(policy.maxValue, policy.unit)}
										</TableCell>
										<TableCell>{policy.enabled ? "Yes" : "No"}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Open alerts</CardTitle>
				</CardHeader>
				<CardContent>
					<AlertReviewList alerts={openAlerts} siteId={site.id} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Recent readings</CardTitle>
				</CardHeader>
				<CardContent>
					{observations.length === 0 ? (
						<Empty>
							No reading has ever been received for this asset. That is an
							absence, not a value.
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Observed</TableHead>
									<TableHead>Metric</TableHead>
									<TableHead>Value</TableHead>
									<TableHead>Validation</TableHead>
									<TableHead>Source</TableHead>
									<TableHead>Source event</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{observations.map((observation) => (
									<TableRow key={observation.id}>
										<TableCell>
											<LocalDateTime
												date={observation.observedAt}
												options={TIMESTAMP_FORMAT}
											/>
										</TableCell>
										<TableCell>{observation.metric}</TableCell>
										<TableCell className="tabular-nums">
											{formatReading(
												observation.numericValue,
												observation.unit,
											)}
											{observation.textValue
												? ` (${observation.textValue})`
												: ""}
										</TableCell>
										<TableCell>
											{observation.validation}
											{observation.rejectionCode
												? ` · ${observation.rejectionCode}`
												: ""}
										</TableCell>
										<TableCell>
											<Badge variant="mono">{observation.provider}</Badge>
										</TableCell>
										<TableCell>
											<Badge variant="mono">{observation.sourceEventId}</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Service task requests</CardTitle>
				</CardHeader>
				<CardContent>
					{data.serviceTasks.length === 0 ? (
						<Empty>No service task has been requested for this asset.</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Requested</TableHead>
									<TableHead>Lumens OS event</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Attempts</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.serviceTasks.map((task) => (
									<TableRow key={task.eventId}>
										<TableCell>
											<LocalDateTime
												date={task.createdAt}
												options={TIMESTAMP_FORMAT}
											/>
										</TableCell>
										<TableCell>
											<Badge variant="mono">{task.eventId}</Badge>
										</TableCell>
										<TableCell>
											{task.status}
											{task.lastError ? ` · ${task.lastError}` : ""}
										</TableCell>
										<TableCell className="tabular-nums">
											{task.attempts}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Source health</CardTitle>
				</CardHeader>
				<CardContent>
					{sourceHealth.length === 0 ? (
						<Empty>No integration reports into this asset yet.</Empty>
					) : (
						<ul className="flex flex-col gap-3">
							{sourceHealth.map((source) => (
								<li
									key={`${source.provider}-${source.assetId ?? "site"}`}
									className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-4"
								>
									<span className="font-medium text-sm">{source.provider}</span>
									<SourceStatusBadge status={source.status} />
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
