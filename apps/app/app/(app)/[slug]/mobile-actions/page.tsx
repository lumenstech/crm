import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { MobileCrmActions } from "./mobile-crm-actions";

export const metadata: Metadata = {
	title: "Mobile CRM Actions",
};

export default async function MobileActionsPage() {
	await requireSession();

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Mobile CRM Actions</PageShellTitle>
					<PageShellDescription>
						Run the approved COMP CRM search, reuse, ingest and opportunity
						actions from a phone without exposing database credentials.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
					<MobileCrmActions />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}
