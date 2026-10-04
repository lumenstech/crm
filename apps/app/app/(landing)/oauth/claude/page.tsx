import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { ClaudeClientSetup } from "./claude-client-setup";

export const metadata: Metadata = {
	title: "Claude Connector",
};

export default function ClaudeConnectorPage() {
	return (
		<AuthShell>
			<AuthHeading
				title="Claude Connector"
				description="Create the confidential OAuth client used by Claude to connect to COMP CRM."
			/>
			<ClaudeClientSetup />
		</AuthShell>
	);
}
