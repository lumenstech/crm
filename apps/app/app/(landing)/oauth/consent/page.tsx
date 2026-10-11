import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { verifiedOAuthConsentQuery } from "@/lib/oauth-consent";
import { OAuthConsent } from "./oauth-consent";

export const metadata: Metadata = {
	title: "Authorize COMP CRM",
};

export const instant = false;

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

	const clientId = verified.params.get("client_id") ?? "";
	const scope = verified.params.get("scope") ?? "";
	const redirectUri = verified.params.get("redirect_uri") ?? "";
	let redirectHost = "the requesting application";
	try {
		redirectHost = new URL(redirectUri).hostname;
	} catch {}

	return (
		<AuthShell>
			<AuthHeading
				title="Authorize COMP CRM"
				description="Review the access this application is requesting before continuing."
			/>
			<OAuthConsent
				clientId={clientId}
				oauthQuery={verified.oauthQuery}
				scope={scope}
				redirectHost={redirectHost}
			/>
		</AuthShell>
	);
}
