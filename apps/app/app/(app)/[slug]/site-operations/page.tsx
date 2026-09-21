import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { SiteOperationsOverview } from "./site-operations-overview";

export const metadata: Metadata = {
	title: "Site Operations",
};

export default function SiteOperationsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Site Operations</PageShellTitle>
					<PageShellDescription>
						Live operational state for physical sites and equipment. Missing
						telemetry is never reported as healthy.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Overview />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Overview() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.siteOps.overview.queryOptions());

	return (
		<HydrateClient>
			<SiteOperationsOverview />
		</HydrateClient>
	);
}
