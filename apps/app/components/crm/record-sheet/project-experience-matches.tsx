"use client";

import Document from "@carbon/icons-react/es/Document";
import Renew from "@carbon/icons-react/es/Renew";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetSection,
} from "@/components/detail-sheet";
import { LocalRelativeTime } from "@/components/local-date-time";
import { PROJECT_MATCH_POLL_MS } from "@/lib/project-experience";
import { useTRPC } from "@/lib/trpc/client";

export function ProjectExperienceMatches({ dealId }: { dealId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const matches = useQuery({
		...trpc.projectExperience.matches.queryOptions({ dealId }),
		refetchInterval: (query) =>
			query.state.data?.status === "queued" ||
			query.state.data?.status === "running"
				? PROJECT_MATCH_POLL_MS
				: false,
	});
	const refresh = useMutation(
		trpc.projectExperience.refreshMatches.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.projectExperience.matches.queryKey({ dealId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const data = matches.data;
	const working =
		refresh.isPending ||
		data?.status === "queued" ||
		data?.status === "running";
	const action = (
		<Button
			variant="outline"
			size="sm"
			disabled={working}
			onClick={() => refresh.mutate({ dealId })}
		>
			{working ? (
				<Spinner data-icon="inline-start" />
			) : (
				<Renew data-icon="inline-start" />
			)}
			{data?.rows.length ? "Refresh matches" : "Find matches"}
		</Button>
	);

	if (!data || data.rows.length === 0) {
		const failed = data?.status === "failed";
		return (
			<DetailSheetEmpty
				icon={Document}
				title={
					working
						? "Matching project experience"
						: failed
							? "Project matching failed"
							: "No project matches yet"
				}
				description={
					working
						? "The agent compares this opportunity with verified project evidence."
						: failed
							? "Run the matcher again. The agent keeps the prior CRM data unchanged."
							: "Run the matcher after the deal name and description describe the required work."
				}
				action={action}
			/>
		);
	}

	return (
		<DetailSheetBody>
			<DetailSheetSection
				title={`${data.rows.length} relevant projects`}
				action={action}
			>
				{data.computedAt ? (
					<p className="text-muted-foreground text-xs">
						Updated <LocalRelativeTime date={data.computedAt} />
					</p>
				) : null}
			</DetailSheetSection>

			{data.rows.map((row) => (
				<DetailSheetSection key={row.sourceRecordId} title={row.projectName}>
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="secondary">{row.score}% fit</Badge>
						<Badge variant={row.salesEligible ? "secondary" : "outline"}>
							{row.salesEligible ? "Sales-ready" : "Review evidence"}
						</Badge>
						{row.evidenceStrength ? (
							<Badge variant="outline">{row.evidenceStrength} evidence</Badge>
						) : null}
					</div>
					<p className="font-medium text-sm">{row.clientLabel}</p>
					{row.portfolioLanguage || row.scopeSummary ? (
						<p className="text-pretty text-muted-foreground text-sm/6">
							{row.portfolioLanguage ?? row.scopeSummary}
						</p>
					) : null}
					<p className="text-muted-foreground text-xs/5">{row.rationale}</p>
					{row.matchedSignals.length > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							{row.matchedSignals.map((signal) => (
								<Badge key={signal} variant="outline">
									{signal}
								</Badge>
							))}
						</div>
					) : null}
				</DetailSheetSection>
			))}
		</DetailSheetBody>
	);
}
