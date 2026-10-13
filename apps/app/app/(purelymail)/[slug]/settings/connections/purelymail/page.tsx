import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectionPage } from "@/app/(app)/[slug]/settings/connections/connection-page";
import { PurelymailConnection } from "@/app/(app)/[slug]/settings/connections/purelymail-connection";
import { isPurelymailOwner } from "@/lib/purelymail-route";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Purelymail" };

export const instant = false;

export default async function PurelymailConnectionPage() {
	const session = await requireSession();
	if (!isPurelymailOwner(session)) notFound();

	return (
		<ConnectionPage>
			<PurelymailConnection />
		</ConnectionPage>
	);
}
