export const BUSINESS_UNIT_KEYS = [
	"516labs",
	"partwall",
	"lumens-technology",
	"data-gear",
] as const;

export type BusinessUnitKey = (typeof BUSINESS_UNIT_KEYS)[number];
