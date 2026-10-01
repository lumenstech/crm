"use client";

import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function OAuthConsent({
	clientId,
	scope,
	redirectHost,
}: {
	clientId: string;
	scope: string;
	redirectHost: string;
}) {
	const [clientName, setClientName] = useState("Claude");
	const [pending, setPending] = useState(false);

	useEffect(() => {
		if (!clientId) return;
		authClient.oauth2
			.publicClient({ query: { client_id: clientId } })
			.then(({ data }) => {
				if (data?.client_name) setClientName(data.client_name);
			})
			.catch(() => undefined);
	}, [clientId]);

	async function submit(accept: boolean) {
		setPending(true);
		try {
			const result = await authClient.oauth2.consent({
				accept,
				...(scope ? { scope } : {}),
			});
			if (result.error) {
				toast.error(
					result.error.message || "Could not complete authorization.",
				);
				return;
			}
			if (result.data?.url) {
				window.location.assign(result.data.url);
			}
		} catch {
			toast.error("Could not complete authorization.");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="space-y-4 text-sm">
			<div className="space-y-2 rounded-lg border p-4">
				<p>
					<strong>{clientName}</strong> is requesting access to COMP CRM.
				</p>
				<p className="text-muted-foreground">
					Access returns to <strong>{redirectHost}</strong>.
				</p>
				{scope ? (
					<p className="break-words text-muted-foreground">Scopes: {scope}</p>
				) : null}
			</div>
			<div className="flex gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={() => void submit(false)}
				>
					Deny
				</Button>
				<Button
					type="button"
					disabled={pending}
					onClick={() => void submit(true)}
				>
					{pending ? "Please wait…" : "Authorize Claude"}
				</Button>
			</div>
		</div>
	);
}
