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
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatAge, formatInterval } from "@/lib/site-ops/presentation";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { AlertReviewList } from "../../alert-review-list";
import {
	MetricLabel,
	Reading,
	SiteStatusBadge,
	SourceStatusBadge,
} from "../../site-ops-parts";

export function SiteDetail({ siteId }: { siteId: string }) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const { data, isPending } = useQuery(
		trpc.siteOps.siteOverview.queryOptions({ siteId }),
	);

	if (isPending) return <Spinner />;
	if (!data) return null;

	const { site, assets, activeAlerts, sourceHealth } = data;

	return (
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-medium text-xl">{site.name}</h1>
					<SiteStatusBadge status={site.status} />
					<Badge variant="mono">{site.code}</Badge>
				</div>
				<p className="text-muted-foreground text-sm">
					{[site.addressLine, site.locality, site.region, site.countryCode]
						.filter(Boolean)
						.join(", ") || "Location not recorded"}
				</p>
				<p className="text-muted-foreground text-xs">
					{site.timezone} · last accepted reading{" "}
					{formatAge(
						site.lastObservationAt
							? Math.round(
									(Date.now() - new Date(site.lastObservationAt).getTime()) /
										1000,
								)
							: null,
					)}{" "}
					· {activeAlerts.length} active alert
					{activeAlerts.length === 1 ? "" : "s"}
				</p>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Assets</CardTitle>
				</CardHeader>
				<CardContent>
					{assets.length === 0 ? (
						<Empty>No assets are registered at this site.</Empty>
					) : (
						<ul className="grid gap-3 md:grid-cols-2">
							{assets.map((asset) => (
								<li key={asset.id}>
									<Link
										href={workspaceUrl(`/site-operations/assets/${asset.id}`)}
										className="flex h-full flex-col gap-3 rounded-lg border border-border p-4 hover:bg-muted"
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<span className="font-medium text-sm">{asset.name}</span>
											<SiteStatusBadge status={asset.operationalStatus} />
										</div>
										<div className="flex flex-wrap gap-2">
											<Badge variant="token">
												{asset.assetType.replaceAll("_", " ")}
											</Badge>
											<Badge variant="mono">{asset.code}</Badge>
										</div>
										{asset.metricStates.length === 0 ? (
											<p className="text-muted-foreground text-xs">
												No metric is monitored on this asset.
											</p>
										) : (
											<dl className="flex flex-col gap-3">
												{asset.metricStates.map((metric) => (
													<div
														key={metric.metric}
														className="flex flex-col gap-1"
													>
														<dt>
															<MetricLabel metric={metric.metric} />
														</dt>
														<dd>
															<Reading metric={metric} />
														</dd>
														<dd className="text-muted-foreground text-xs">
															{metric.reason}
														</dd>
													</div>
												))}
											</dl>
										)}
									</Link>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active alerts</CardTitle>
				</CardHeader>
				<CardContent>
					<AlertReviewList alerts={activeAlerts} siteId={siteId} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Source health</CardTitle>
				</CardHeader>
				<CardContent>
					{sourceHealth.length === 0 ? (
						<Empty>No integration reports into this site yet.</Empty>
					) : (
						<ul className="flex flex-col gap-3">
							{sourceHealth.map((source) => (
								<li
									key={`${source.provider}-${source.assetId ?? "site"}`}
									className="flex flex-col gap-2 rounded-lg border border-border p-4"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<span className="font-medium text-sm">
											{source.provider}
										</span>
										<SourceStatusBadge status={source.status} />
									</div>
									<p className="text-muted-foreground text-xs">
										{source.assetName ?? "Whole site"} · last success{" "}
										{formatAge(source.secondsSinceSuccess)} · expected every{" "}
										{formatInterval(source.expectedIntervalSeconds)}
									</p>
									{source.lastError ? (
										<p className="text-muted-foreground text-xs">
											{source.lastError}
										</p>
									) : null}
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
