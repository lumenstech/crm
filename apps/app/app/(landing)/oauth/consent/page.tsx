import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { OAuthConsent } from "./oauth-consent";

export const metadata: Metadata = {
	title: "Authorize COMP CRM",
};

export default function OAuthConsentPage() {
	return (
		<AuthShell>
			<AuthHeading
				title="Authorize COMP CRM"
				description="Review the access Claude is requesting before continuing."
			/>
			<OAuthConsent />
		</AuthShell>
	);
}
