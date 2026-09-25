export const BUSINESS_UNIT_KEYS = [
	"516labs",
	"partwall",
	"lumens-technology",
	"energybms",
	"data-gear",
	"trustaccept",
] as const;

export type BusinessUnitKey = (typeof BUSINESS_UNIT_KEYS)[number];
