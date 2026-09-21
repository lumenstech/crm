"use client";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Empty } from "@crm/ui/components/empty";
import { Spinner } from "@crm/ui/components/spinner";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";
import { AlertReviewList } from "../alert-review-list";

export function AlertsBoard() {
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

	const anyAlerts = loaded.some((site) => (site?.activeAlerts.length ?? 0) > 0);
	if (!anyAlerts) return <Empty>No active alerts across any site.</Empty>;

	return (
		<div className="flex flex-col gap-6">
			{loaded.map((site) =>
				site && site.activeAlerts.length > 0 ? (
					<Card key={site.site.id}>
						<CardHeader>
							<CardTitle>{site.site.name}</CardTitle>
						</CardHeader>
						<CardContent>
							<AlertReviewList
								alerts={site.activeAlerts}
								siteId={site.site.id}
							/>
						</CardContent>
					</Card>
				) : null,
			)}
		</div>
	);
}
