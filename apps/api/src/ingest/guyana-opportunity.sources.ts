export const guyanaOpportunitySources = {
	"government-eprocure": {
		name: "Guyana Government eProcure",
		url: "https://eprocure.gov.gy/",
		trust: "official-government",
	},
	npta: {
		name: "National Procurement and Tender Administration",
		url: "https://npta.gov.gy/",
		trust: "official-government",
	},
	"local-content-register": {
		name: "Guyana Local Content Register",
		url: "https://lcregister.petroleum.gov.gy/",
		trust: "official-government",
	},
	idb: {
		name: "Inter-American Development Bank",
		url: "https://www.iadb.org/en/how-we-can-work-together/procurement",
		trust: "multilateral-development-bank",
	},
	cdb: {
		name: "Caribbean Development Bank",
		url: "https://www.caribank.org/work-with-us/procurement",
		trust: "multilateral-development-bank",
	},
	ungm: {
		name: "United Nations Global Marketplace",
		url: "https://www.ungm.org/Public/Notice",
		trust: "multilateral",
	},
} as const;

export type GuyanaOpportunitySourceKey = keyof typeof guyanaOpportunitySources;
