"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

export function PurelymailConnection() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const status = useQuery(trpc.purelymail.status.queryOptions());
	const [password, setPassword] = useState("");
	const [folder, setFolder] = useState("Sent");
	useEffect(() => {
		if (status.data?.folder) setFolder(status.data.folder);
	}, [status.data?.folder]);

	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: trpc.purelymail.status.pathKey(),
		});
	};
	const save = useMutation(
		trpc.purelymail.save.mutationOptions({
			onSuccess: async () => {
				setPassword("");
				await refresh();
				toast.success("Purelymail password saved. Sync is still paused.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const enable = useMutation(
		trpc.purelymail.enable.mutationOptions({
			onSuccess: refresh,
			onError: (error) => toast.error(error.message),
		}),
	);
	const pause = useMutation(
		trpc.purelymail.pause.mutationOptions({
			onSuccess: async () => {
				await refresh();
				toast.success("Purelymail sync paused.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.purelymail.remove.mutationOptions({
			onSuccess: async () => {
				await refresh();
				toast.success(
					"Purelymail credential removed. Imported history remains.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return <Spinner size="lg" />;

	const busy =
		status.isFetching ||
		save.isPending ||
		enable.isPending ||
		pause.isPending ||
		remove.isPending;
	const configured = status.data.configured;
	const enabled = status.data.enabled;

	return (
		<Card className="rounded-lg border bg-card px-(--spacing-block-inline) py-4">
			<CardHeader className="px-0">
				<CardTitle>
					<div className="flex flex-wrap items-center gap-2">
						Purelymail
						<StatusIndicator
							size="sm"
							tone={enabled ? "success" : "neutral"}
							label={
								enabled ? "Enabled" : configured ? "Paused" : "Not configured"
							}
						/>
					</div>
				</CardTitle>
				<CardDescription className="block">
					Read-only Sent history for {status.data.mailbox}. This page never
					needs a Google or Microsoft mailbox grant.
				</CardDescription>
			</CardHeader>

			<CardContent className="px-0">
				<Field>
					<FieldLabel htmlFor="purelymail-password">
						{configured ? "Replace password" : "Password"}
					</FieldLabel>
					<Input
						id="purelymail-password"
						autoComplete="new-password"
						disabled={busy || !status.data.serverKeyConfigured}
						placeholder="Enter it on this device"
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
					<FieldDescription>
						Stored encrypted on the server. Saving or replacing it keeps sync
						paused and does not connect to IMAP.
					</FieldDescription>
				</Field>
				<Field>
					<FieldLabel htmlFor="purelymail-folder">
						Sent folder (read only)
					</FieldLabel>
					<Input
						id="purelymail-folder"
						disabled={busy || !status.data.serverKeyConfigured}
						value={folder || status.data.folder || "Sent"}
						onChange={(event) => setFolder(event.target.value)}
					/>
					<FieldDescription>
						Use the exact IMAP folder path. The importer selects this folder and
						only searches and fetches messages; it never changes mailbox
						contents.
					</FieldDescription>
				</Field>
				{!status.data.serverKeyConfigured ? (
					<p className="text-amber-700 text-xs dark:text-amber-300">
						The server key is not provisioned yet. An administrator must
						configure it before this page can save a credential.
					</p>
				) : null}
				{status.data.sync.lastError ? (
					<p className="text-destructive text-xs">
						{status.data.sync.lastError}
					</p>
				) : null}
			</CardContent>

			<CardFooter className="flex-wrap px-0">
				<Button
					disabled={
						busy || !password.trim() || !status.data.serverKeyConfigured
					}
					onClick={() =>
						save.mutate({
							password,
							folder: folder || status.data.folder || "Sent",
						})
					}
					type="button"
				>
					{save.isPending ? <Spinner data-icon="inline-start" /> : null}
					{configured ? "Replace password" : "Save password"}
				</Button>

				{configured && !enabled ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={busy} type="button" variant="outline">
								Enable sync
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Enable Purelymail sync?</AlertDialogTitle>
								<AlertDialogDescription>
									This starts the initial Sent history import, then polls every
									60 seconds in batches of 50 messages. Imported history is
									deduplicated and remains if you pause or remove the
									credential.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction onClick={() => enable.mutate()}>
									Enable read-only sync
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}

				{enabled ? (
					<Button
						disabled={busy}
						onClick={() => pause.mutate()}
						type="button"
						variant="outline"
					>
						Pause sync
					</Button>
				) : null}

				{configured ? (
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button disabled={busy} type="button" variant="ghost">
								Remove credential
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									Remove Purelymail credential?
								</AlertDialogTitle>
								<AlertDialogDescription>
									This pauses sync and removes the encrypted credential.
									Imported email history is not deleted.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction onClick={() => remove.mutate()}>
									Remove credential
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
			</CardFooter>
		</Card>
	);
}
