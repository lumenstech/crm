import { Suspense } from "react";
import {
	SettingsSidebar,
	SettingsSidebarFallback,
} from "@/app/(app)/[slug]/settings/settings-sidebar";

export default function PurelymailSettingsLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
			<Suspense fallback={<SettingsSidebarFallback />}>
				<SettingsSidebar />
			</Suspense>
			{children}
		</div>
	);
}
