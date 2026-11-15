"use client";

import { Button } from "@crm/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type AccessMode = "read_only" | "read_write";

type Connection = {
	status: "connecting" | "connected" | "error" | "disconnected";
	accessMode: AccessMode;
	grantedScopes: string[];
	connectedAt: Date | string | null;
	lastSuccessfulCallAt: Date | string | null;
	lastErrorCode: string | null;
} | null;

type ToolRow = {
	name: string;
	description: string | null;
	fingerprint: string;
	callKind: "read" | "change" | "risky";
	reviewState: "pending" | "reviewed" | "changed" | "removed";
	lastSeenAt: string;
};

export function McpConnectionPanel({
	slug,
	platformSlug,
	name,
	description,
	bringsIn,
	sendsReadOnly,
	sendsReadWrite,
	configured,
	canManage,
	connection,
	readOnlyScopes,
	readWriteScopes,
	tools,
}: {
	slug: string;
	platformSlug: string;
	name: string;
	description: string;
	bringsIn: string;
	sendsReadOnly: string;
	sendsReadWrite: string;
	configured: boolean;
	canManage: boolean;
	connection: Connection;
	readOnlyScopes: string[];
	readWriteScopes: string[];
	tools: ToolRow[];
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [accessMode, setAccessMode] = useState<AccessMode>(
		connection?.accessMode ?? "read_only",
	);
	const [selected, setSelected] = useState<string[]>(() =>
		tools
			.filter((tool) => tool.reviewState === "reviewed")
			.map((tool) => tool.fingerprint),
	);
	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.mcp.list.pathKey() });
		await queryClient.invalidateQueries({
			queryKey: trpc.mcp.tools.queryKey({ platformSlug }),
		});
	};
	const start = useMutation(
		trpc.mcp.start.mutationOptions({
			onSuccess: (result) => {
				window.location.assign(result.authorizationUrl);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const disconnect = useMutation(
		trpc.mcp.disconnect.mutationOptions({
			onSuccess: async () => {
				toast.success(`${name} is disconnected.`);
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const review = useMutation(
		trpc.mcp.reviewTools.mutationOptions({
			onSuccess: async () => {
				toast.success("Reviewed tools are saved.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const sends = accessMode === "read_only" ? sendsReadOnly : sendsReadWrite;
	const scopes = accessMode === "read_only" ? readOnlyScopes : readWriteScopes;
	const reviewable = tools.filter((tool) => tool.reviewState !== "removed");
	const pendingSelection = reviewable.filter(
		(tool) =>
			tool.reviewState === "pending" && selected.includes(tool.fingerprint),
	);

	return (
		<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-(--spacing-page-inline) pt-(--spacing-page-top) pb-(--spacing-page-bottom)">
			<div className="mx-auto flex w-full max-w-(--container-page) flex-col gap-6">
				<header className="flex flex-col gap-2 px-(--spacing-block-inline)">
					<Link
						href={`/${slug}/settings/connections`}
						className="text-muted-foreground text-sm"
					>
						Connections
					</Link>
					<h1 className="font-medium text-2xl tracking-tight">{name}</h1>
					<p className="max-w-2xl text-muted-foreground text-sm">
						{description}
					</p>
				</header>
				{configured ? null : (
					<p className="px-(--spacing-block-inline) text-sm">
						MCP connections stay off until MCP_ENCRYPTION_KEY is set.
					</p>
				)}
				<section className="flex flex-col gap-4 rounded-lg border bg-card px-(--spacing-block-inline) py-4">
					<div className="flex flex-col gap-2 text-sm">
						<p>
							<span className="text-muted-foreground">Brings in </span>
							{bringsIn}
						</p>
						<p>
							<span className="text-muted-foreground">Sends </span>
							{sends}
						</p>
						<p>
							<span className="text-muted-foreground">Status </span>
							{connection ? connection.status : "Not connected"}
						</p>
						{connection?.lastErrorCode ? (
							<p>
								<span className="text-muted-foreground">Last error </span>
								{connection.lastErrorCode}
							</p>
						) : null}
					</div>
					<fieldset
						className="flex flex-col gap-2 text-sm"
						disabled={!canManage}
					>
						<legend className="font-medium">Access</legend>
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="access"
								checked={accessMode === "read_only"}
								onChange={() => setAccessMode("read_only")}
							/>
							Read only
						</label>
						<label className="flex items-center gap-2">
							<input
								type="radio"
								name="access"
								checked={accessMode === "read_write"}
								onChange={() => setAccessMode("read_write")}
							/>
							Read and write
						</label>
						<p className="text-muted-foreground text-xs">
							Scopes: {scopes.join(", ")}
						</p>
					</fieldset>
					<div className="flex gap-2">
						<Button
							type="button"
							disabled={!configured || !canManage || start.isPending}
							onClick={() =>
								start.mutate({
									platformSlug,
									accessMode,
									returnPath: `/${slug}/settings/connections/${platformSlug}`,
								})
							}
						>
							{connection ? "Reconnect" : "Connect"}
						</Button>
						{connection ? (
							<Button
								type="button"
								variant="outline"
								disabled={!canManage || disconnect.isPending}
								onClick={() => disconnect.mutate({ platformSlug })}
							>
								Disconnect
							</Button>
						) : null}
					</div>
				</section>
				<section className="flex flex-col gap-3 px-(--spacing-block-inline)">
					<h2 className="font-medium text-sm">Tools</h2>
					<p className="text-muted-foreground text-sm">
						Agents can use a tool only after it is reviewed.
					</p>
					{reviewable.length === 0 ? (
						<p className="text-sm">No tools are cached yet.</p>
					) : (
						<ul className="flex flex-col gap-2">
							{reviewable.map((tool) => (
								<li
									key={tool.fingerprint}
									className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
								>
									<input
										type="checkbox"
										className="mt-1"
										checked={selected.includes(tool.fingerprint)}
										disabled={!canManage || tool.reviewState === "changed"}
										onChange={(event) => {
											setSelected((current) =>
												event.target.checked
													? [...current, tool.fingerprint]
													: current.filter(
															(fingerprint) => fingerprint !== tool.fingerprint,
														),
											);
										}}
									/>
									<div className="min-w-0">
										<p className="font-medium">{tool.name}</p>
										<p className="text-muted-foreground text-xs">
											{tool.callKind} · {tool.reviewState}
										</p>
										{tool.description ? (
											<p className="text-muted-foreground">
												{tool.description}
											</p>
										) : null}
									</div>
								</li>
							))}
						</ul>
					)}
					<Button
						type="button"
						variant="outline"
						disabled={
							!canManage || pendingSelection.length === 0 || review.isPending
						}
						onClick={() =>
							review.mutate({
								platformSlug,
								tools: pendingSelection.map((tool) => ({
									name: tool.name,
									fingerprint: tool.fingerprint,
								})),
							})
						}
					>
						Save review
					</Button>
				</section>
			</div>
		</main>
	);
}
