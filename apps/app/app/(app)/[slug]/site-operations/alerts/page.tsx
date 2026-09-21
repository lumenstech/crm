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
import { AlertsBoard } from "./alerts-board";

export const metadata: Metadata = {
	title: "Site alerts",
};

export default function SiteAlertsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Alerts</PageShellTitle>
					<PageShellDescription>
						Every open alert, with the site, asset, reading and source that
						produced it. An operator reviews before a task is raised.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Alerts />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Alerts() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.siteOps.overview.queryOptions());

	return (
		<HydrateClient>
			<AlertsBoard />
		</HydrateClient>
	);
}
