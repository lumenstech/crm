import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { verifiedOAuthConsentQuery } from "@/lib/oauth-consent";
import { OAuthConsent } from "./oauth-consent";

export const metadata: Metadata = {
	title: "Authorize COMP CRM",
};

export default async function OAuthConsentPage({
	searchParams,
}: PageProps<"/oauth/consent">) {
	const verified = await verifiedOAuthConsentQuery(await searchParams);

	if (!verified) {
		return (
			<AuthShell>
				<AuthHeading
					title="Authorization request rejected"
					description="The OAuth authorization request is missing, expired, or invalid."
				/>
			</AuthShell>
		);
	}

	const clientId = verified.get("client_id") ?? "";
	const scope = verified.get("scope") ?? "";
	const redirectUri = verified.get("redirect_uri") ?? "";
	let redirectHost = "claude.ai";
	try {
		redirectHost = new URL(redirectUri).hostname;
	} catch {}

	return (
		<AuthShell>
			<AuthHeading
				title="Authorize COMP CRM"
				description="Review the access Claude is requesting before continuing."
			/>
			<OAuthConsent
				clientId={clientId}
				scope={scope}
				redirectHost={redirectHost}
			/>
		</AuthShell>
	);
}
