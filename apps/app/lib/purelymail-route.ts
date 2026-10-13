import { PURELYMAIL_OWNER_USER_ID } from "@crm/db/purelymail";

export function isPurelymailOwner(session: { user: { id: string } }): boolean {
	return session.user.id === PURELYMAIL_OWNER_USER_ID;
}
