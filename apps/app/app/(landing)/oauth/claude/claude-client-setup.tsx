"use client";

import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

type Credentials = {
	clientId: string;
	clientSecret: string;
};

export function ClaudeClientSetup() {
	const [pending, setPending] = useState(false);
	const [credentials, setCredentials] = useState<Credentials | null>(null);

	async function createClient() {
		setPending(true);
		try {
			const result = await authClient.oauth2.createClient({
				client_name: "Claude COMP CRM",
				redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
				token_endpoint_auth_method: "client_secret_basic",
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				type: "web",
				scope: "crm:read crm:write offline_access",
			});
			if (result.error) {
				toast.error(result.error.message || "Could not create the Claude client.");
				return;
			}
			const clientId = result.data?.client_id;
			const clientSecret = result.data?.client_secret;
			if (!clientId || !clientSecret) {
				toast.error("The OAuth client was created without usable credentials.");
				return;
			}
			setCredentials({ clientId, clientSecret });
		} catch {
			toast.error("Could not create the Claude client.");
		} finally {
			setPending(false);
		}
	}

	if (!credentials) {
		return (
			<div className="space-y-4 text-sm">
				<p className="text-muted-foreground">
					This creates one confidential OAuth client for Claude with PKCE and refresh-token support.
				</p>
				<Button type="button" disabled={pending} onClick={() => void createClient()}>
					{pending ? "Creating…" : "Create Claude OAuth client"}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4 text-sm">
			<p className="text-muted-foreground">
				Copy these values into Claude now. The client secret is only shown here.
			</p>
			<label className="block space-y-1">
				<span>Client ID</span>
				<Input readOnly value={credentials.clientId} />
			</label>
			<label className="block space-y-1">
				<span>Client secret</span>
				<Input readOnly value={credentials.clientSecret} />
			</label>
			<label className="block space-y-1">
				<span>MCP URL</span>
				<Input readOnly value="https://comp-crm-mcp.516labs.com/mcp" />
			</label>
		</div>
	);
}
