import { WorkspaceAppShell } from "@/components/workspace-app-shell";

export default function PurelymailLayout({
	children,
	params,
}: LayoutProps<"/[slug]">) {
	return (
		<WorkspaceAppShell params={params} mailboxRequired={false}>
			{children}
		</WorkspaceAppShell>
	);
}
