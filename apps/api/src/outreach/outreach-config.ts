export const DATAGEAR_OUTBOUND_V1 = "DATAGEAR_OUTBOUND_V1" as const;

export const DATAGEAR_SENDER = "Danny Ramroop <sales@data-gear.com>" as const;

export const DATAGEAR_SIGNATURE = [
	"Danny Ramroop",
	"VP of Data Center Solutions Engineering",
	"Data-Gear",
	"516-400-6149",
	"sales@data-gear.com",
	"data-gear.com",
].join("\n");

export function dataGearOutboundBody(body: string): string {
	return `${body.trim()}\n\n${DATAGEAR_SIGNATURE}`;
}
