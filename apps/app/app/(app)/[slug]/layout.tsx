import { WorkspaceAppShell } from "@/components/workspace-app-shell";

export default function AppLayout({
	children,
	params,
}: LayoutProps<"/[slug]">) {
	return (
		<WorkspaceAppShell mailboxRequired params={params}>
			{children}
		</WorkspaceAppShell>
	);
}
