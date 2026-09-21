"use client";

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
import { formatAge } from "@/lib/site-ops/presentation";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { SiteStatusBadge } from "./site-ops-parts";

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-normal text-muted-foreground text-xs">
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="font-medium text-2xl tabular-nums">{value}</p>
			</CardContent>
		</Card>
	);
}

export function SiteOperationsOverview() {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const { data, isPending } = useQuery(trpc.siteOps.overview.queryOptions());

	if (isPending) return <Spinner />;
	if (!data) return null;

	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
				<Stat label="Sites" value={data.siteCount} />
				<Stat label="Need attention" value={data.sitesNeedingAttention} />
				<Stat label="Active alerts" value={data.activeAlertCount} />
				<Stat label="Critical alerts" value={data.criticalAlertCount} />
				<Stat label="Failed sources" value={data.failedSourceCount} />
				<Stat
					label="Service tasks requested"
					value={data.openServiceTaskCount}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Sites</CardTitle>
				</CardHeader>
				<CardContent>
					{data.sites.length === 0 ? (
						<Empty>No sites are configured yet.</Empty>
					) : (
						<ul className="flex flex-col gap-3">
							{data.sites.map((site) => (
								<li key={site.id}>
									<Link
										href={workspaceUrl(`/site-operations/sites/${site.id}`)}
										className="flex flex-col gap-2 rounded-lg border border-border p-4 hover:bg-muted"
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<span className="font-medium text-sm">{site.name}</span>
											<SiteStatusBadge status={site.status} />
										</div>
										<p className="text-muted-foreground text-xs">
											{[site.locality, site.region, site.countryCode]
												.filter(Boolean)
												.join(", ") || "Location not recorded"}
										</p>
										<dl className="flex flex-wrap gap-4 text-muted-foreground text-xs">
											<div className="flex gap-1">
												<dt>Assets</dt>
												<dd className="tabular-nums">{site.assetCount}</dd>
											</div>
											<div className="flex gap-1">
												<dt>Active alerts</dt>
												<dd className="tabular-nums">{site.openAlertCount}</dd>
											</div>
											<div className="flex gap-1">
												<dt>Unhealthy sources</dt>
												<dd className="tabular-nums">
													{site.unhealthySourceCount}
												</dd>
											</div>
											<div className="flex gap-1">
												<dt>Last reading</dt>
												<dd>
													{formatAge(
														site.lastObservationAt
															? Math.round(
																	(Date.now() -
																		new Date(
																			site.lastObservationAt,
																		).getTime()) /
																		1000,
																)
															: null,
													)}
												</dd>
											</div>
										</dl>
									</Link>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
