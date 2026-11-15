import { vendorBySlug } from "@crm/mcp-integrations/catalog";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { McpConnectionPanel } from "./mcp-connection-panel";

type ConnectionParams = Promise<{ slug: string; platformSlug: string }>;

export async function generateMetadata({
	params,
}: {
	params: ConnectionParams;
}): Promise<Metadata> {
	const { platformSlug } = await params;
	const vendor = vendorBySlug(platformSlug);
	return { title: vendor ? `${vendor.name} connection` : "Connection" };
}

export default async function McpConnectionPage({
	params,
}: {
	params: ConnectionParams;
}) {
	await requireSession();
	const { slug, platformSlug } = await params;
	const vendor = vendorBySlug(platformSlug);
	if (!vendor) notFound();

	const queryClient = getServerQueryClient();
	const trpc = getServerTrpc();
	const [mcp, tools] = await Promise.all([
		queryClient.fetchQuery(trpc.mcp.list.queryOptions()),
		queryClient.fetchQuery(trpc.mcp.tools.queryOptions({ platformSlug })),
	]);
	const entry = mcp.entries.find((item) => item.slug === vendor.slug);
	if (!entry) notFound();

	return (
		<McpConnectionPanel
			slug={slug}
			platformSlug={vendor.slug}
			name={vendor.name}
			description={vendor.presentation.description}
			bringsIn={vendor.presentation.bringsIn}
			sendsReadOnly={vendor.presentation.sendsReadOnly}
			sendsReadWrite={vendor.presentation.sendsReadWrite}
			configured={mcp.configured}
			canManage={mcp.canManage}
			connection={entry.connection}
			readOnlyScopes={entry.readOnlyScopes}
			readWriteScopes={entry.readWriteScopes}
			tools={tools.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				fingerprint: tool.fingerprint,
				callKind: tool.callKind,
				reviewState: tool.reviewState,
				lastSeenAt: new Date(tool.lastSeenAt).toISOString(),
			}))}
		/>
	);
}
