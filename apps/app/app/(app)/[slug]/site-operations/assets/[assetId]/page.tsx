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
import { AssetDetail } from "./asset-detail";

export const metadata: Metadata = {
	title: "Asset",
};

const HISTORY_LIMIT = 50;

export default function AssetDetailPage({
	params,
}: PageProps<"/[slug]/site-operations/assets/[assetId]">) {
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
}: Pick<PageProps<"/[slug]/site-operations/assets/[assetId]">, "params">) {
	const [, { assetId }] = await Promise.all([requireSession(), params]);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.siteOps.assetDetail.queryOptions({
			assetId,
			historyLimit: HISTORY_LIMIT,
		}),
	);

	return (
		<HydrateClient>
			<AssetDetail assetId={assetId} historyLimit={HISTORY_LIMIT} />
		</HydrateClient>
	);
}
