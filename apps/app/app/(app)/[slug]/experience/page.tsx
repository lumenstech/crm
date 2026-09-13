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
import { projectExperienceSearchParams } from "./project-experience-search-params";
import { ProjectExperienceTable } from "./project-experience-table";

export const metadata: Metadata = {
	title: "Project experience",
};

export default function ProjectExperiencePage({
	searchParams,
}: PageProps<"/[slug]/experience">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Project experience</PageShellTitle>
					<PageShellDescription>
						Verified delivery history for proposals, qualification, and
						opportunity matching.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<ProjectExperience searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function ProjectExperience({
	searchParams,
}: Pick<PageProps<"/[slug]/experience">, "searchParams">) {
	const [, values] = await Promise.all([
		requireSession(),
		projectExperienceSearchParams.load(searchParams),
	]);
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(
			trpc.projectExperience.list.queryOptions(
				projectExperienceSearchParams.toInput(values),
			),
		),
		queryClient.prefetchQuery(trpc.projectExperience.summary.queryOptions()),
	]);

	return (
		<HydrateClient>
			<ProjectExperienceTable />
		</HydrateClient>
	);
}
