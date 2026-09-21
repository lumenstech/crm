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
import { SourcesBoard } from "./sources-board";

export const metadata: Metadata = {
	title: "Sources",
};

export default function SourcesPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Sources</PageShellTitle>
					<PageShellDescription>
						Whether each integration is delivering. This answers "is the pipe
						working", separately from what came down it.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Sources />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Sources() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(trpc.siteOps.overview.queryOptions());

	return (
		<HydrateClient>
			<SourcesBoard />
		</HydrateClient>
	);
}
