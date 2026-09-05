import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { SignalReview } from "./signal-review";

export const metadata: Metadata = { title: "Signal Review" };

export default async function SignalReviewPage() {
	await requireSession();
	const trpc = getServerTrpc();
	await getServerQueryClient().prefetchQuery(
		trpc.resolution.listReviews.queryOptions({ limit: 50, status: "pending" }),
	);
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Signal review</PageShellTitle>
					<PageShellDescription>
						Resolve ambiguous identity matches before they enter the CRM.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<SignalReview />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
