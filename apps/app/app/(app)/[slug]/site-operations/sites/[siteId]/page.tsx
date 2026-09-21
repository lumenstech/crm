import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellLoading,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { SiteDetail } from "./site-detail";

export const metadata: Metadata = {
	title: "Site",
};

export default function SiteDetailPage({
	params,
}: PageProps<"/[slug]/site-operations/sites/[siteId]">) {
	return (
		<PageShell>
			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Detail params={params} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Detail({
	params,
}: Pick<PageProps<"/[slug]/site-operations/sites/[siteId]">, "params">) {
	const [, { siteId }] = await Promise.all([requireSession(), params]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.siteOps.siteOverview.queryOptions({ siteId }),
	);

	return (
		<HydrateClient>
			<SiteDetail siteId={siteId} />
		</HydrateClient>
	);
}
