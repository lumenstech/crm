"use client";

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
import { useQueries, useQuery } from "@tanstack/react-query";
import { formatAge, formatInterval } from "@/lib/site-ops/presentation";
import { useTRPC } from "@/lib/trpc/client";
import { SourceStatusBadge } from "../site-ops-parts";

export function SourcesBoard() {
	const trpc = useTRPC();
	const overview = useQuery(trpc.siteOps.overview.queryOptions());
	const siteIds = overview.data?.sites.map((site) => site.id) ?? [];

	const sites = useQueries({
		queries: siteIds.map((siteId) =>
			trpc.siteOps.siteOverview.queryOptions({ siteId }),
		),
	});

	if (overview.isPending) return <Spinner />;
	if (!overview.data) return null;

	const loaded = sites.filter((query) => query.data).map((query) => query.data);
	if (loaded.length === 0 && sites.some((query) => query.isPending)) {
		return <Spinner />;
	}

	const rows = loaded.flatMap((site) =>
		site
			? site.sourceHealth.map((source) => ({
					...source,
					siteName: site.site.name,
				}))
			: [],
	);

	if (rows.length === 0) {
		return <Empty>No integration reports into any site yet.</Empty>;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Integration health</CardTitle>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Source</TableHead>
							<TableHead>Site</TableHead>
							<TableHead>Scope</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Last success</TableHead>
							<TableHead>Expected every</TableHead>
							<TableHead>Last error</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow
								key={`${row.siteId}-${row.provider}-${row.assetId ?? "site"}`}
							>
								<TableCell>{row.provider}</TableCell>
								<TableCell>{row.siteName}</TableCell>
								<TableCell>{row.assetName ?? "Whole site"}</TableCell>
								<TableCell>
									<SourceStatusBadge status={row.status} />
								</TableCell>
								<TableCell>{formatAge(row.secondsSinceSuccess)}</TableCell>
								<TableCell>
									{formatInterval(row.expectedIntervalSeconds)}
								</TableCell>
								<TableCell>{row.lastError ?? "—"}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
