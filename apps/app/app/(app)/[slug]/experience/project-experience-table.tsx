"use client";

import Launch from "@carbon/icons-react/es/Launch";
import { Badge } from "@crm/ui/components/badge";
import {
	DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@crm/ui/components/data-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Icon } from "@crm/ui/components/icon";
import { formatMoney } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { projectExperienceSearchParams } from "./project-experience-search-params";

type ProjectRow = RouterOutputs["projectExperience"]["list"]["rows"][number];

function location(row: ProjectRow) {
	return [row.city, row.state].filter(Boolean).join(", ");
}

const COLUMNS: DataTableColumn<ProjectRow>[] = [
	{
		id: "projectName",
		header: "Project",
		sortable: true,
		hideable: false,
		width: "w-[24%]",
		cell: (row) => (
			<span className="flex min-w-0 items-center gap-2">
				<span className="truncate font-medium">{row.projectName}</span>
				{row.sourceUrl ? (
					<Link
						href={row.sourceUrl}
						target="_blank"
						rel="noreferrer"
						aria-label={`Open source for ${row.projectName}`}
						className="shrink-0 text-muted-foreground hover:text-foreground"
					>
						<Icon icon={Launch} />
					</Link>
				) : null}
			</span>
		),
	},
	{
		id: "client",
		header: "Client",
		sortable: true,
		width: "w-[16%]",
		cell: (row) => (
			<span className="truncate">
				{row.canonicalCompanyName ?? row.clientLabel}
			</span>
		),
	},
	{
		id: "sector",
		header: "Sector",
		sortable: true,
		width: "w-[11%]",
		hideBelow: "md",
		cell: (row) => row.sector ?? <EmptyCellValue />,
	},
	{
		id: "projectType",
		header: "Type",
		sortable: true,
		width: "w-[15%]",
		hideBelow: "lg",
		cell: (row) => row.projectType ?? <EmptyCellValue />,
	},
	{
		id: "location",
		header: "Location",
		width: "w-[12%]",
		hideBelow: "lg",
		cell: (row) => location(row) || <EmptyCellValue />,
	},
	{
		id: "amount",
		header: "Amount",
		align: "right",
		width: "w-[10%]",
		defaultHidden: true,
		cell: (row) =>
			row.amountUsd === null ? (
				<EmptyCellValue />
			) : (
				<span className="tabular-nums">
					{formatMoney(Math.round(row.amountUsd * 100), "USD")}
				</span>
			),
	},
	{
		id: "claimTier",
		header: "Claim",
		sortable: true,
		width: "w-[10%]",
		cell: (row) =>
			row.claimTier ? (
				<Badge variant="outline">{row.claimTier}</Badge>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "evidence",
		header: "Evidence",
		sortable: true,
		align: "right",
		width: "w-[10%]",
		cell: (row) => (
			<span className="tabular-nums text-muted-foreground">
				{row.evidenceItems} · {row.evidenceStrength ?? "unknown"}
			</span>
		),
	},
	{
		id: "eligibility",
		header: "Use",
		width: "w-[10%]",
		cell: (row) => (
			<Badge variant={row.salesEligible ? "secondary" : "outline"}>
				{row.salesEligible ? "Sales-ready" : "Review"}
			</Badge>
		),
	},
	{
		id: "verified",
		header: "Verified",
		sortable: true,
		align: "right",
		width: "w-[12%]",
		defaultHidden: true,
		cell: (row) =>
			row.lastVerifiedAt ? (
				<LocalRelativeTime date={row.lastVerifiedAt} />
			) : (
				<EmptyCellValue />
			),
	},
];

function options(counts: Record<string, number> | undefined) {
	return Object.keys(counts ?? {})
		.sort()
		.map((value) => ({ value, label: value }));
}

export function ProjectExperienceTable() {
	const trpc = useTRPC();
	const table = useTableQuery(projectExperienceSearchParams);
	const projects = useQuery({
		...trpc.projectExperience.list.queryOptions(table.input),
		placeholderData: (previous) => previous,
	});
	const summary = useQuery(trpc.projectExperience.summary.queryOptions());
	const counts = projects.data?.facetCounts;
	const facets: DataTableFacet[] = [
		{ id: "sector", label: "Sector", options: options(counts?.sector) },
		{
			id: "projectType",
			label: "Project type",
			options: options(counts?.projectType),
		},
		{
			id: "claimTier",
			label: "Claim tier",
			options: options(counts?.claimTier),
		},
		{
			id: "eligibility",
			label: "Use",
			options: [
				{ value: "sales-ready", label: "Sales-ready" },
				{ value: "review", label: "Needs review" },
			].filter((option) => (counts?.eligibility?.[option.value] ?? 0) > 0),
		},
	];

	return (
		<DataTable
			query={table.query}
			search={
				<ListSearch placeholder="Search projects, clients, systems, or scope…" />
			}
			columns={COLUMNS}
			rows={projects.data?.rows ?? []}
			total={projects.data?.total ?? 0}
			facetCounts={counts}
			facets={facets}
			getRowId={(row) => row.sourceRecordId}
			loading={projects.isFetching}
			empty="No project experience matches this view."
			meta={
				summary.data ? (
					<span className="text-muted-foreground">
						{summary.data.total} projects · {summary.data.salesReady}{" "}
						sales-ready · {summary.data.headline} headline ·{" "}
						{summary.data.evidenceItems} evidence items
					</span>
				) : null
			}
		/>
	);
}
