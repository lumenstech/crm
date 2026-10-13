import { PURELYMAIL_OWNER_USER_ID } from "@crm/db/purelymail";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { ConnectionPage } from "../connection-page";
import { PurelymailConnection } from "../purelymail-connection";

export const metadata: Metadata = { title: "Purelymail" };

export default async function PurelymailConnectionPage() {
	const session = await requireSession();
	if (session.user.id !== PURELYMAIL_OWNER_USER_ID) notFound();

	return (
		<ConnectionPage>
			<PurelymailConnection />
		</ConnectionPage>
	);
}
