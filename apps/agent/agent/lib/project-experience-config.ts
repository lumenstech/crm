export const PROJECT_EXPERIENCE_MATCH = {
	limit: 12,
	minimumScore: 15,
	weights: {
		token: 15,
		signal: 5,
		salesReady: 5,
		strongEvidence: 5,
	},
} as const;

export const PROJECT_EXPERIENCE_STOP_WORDS = new Set([
	"and",
	"are",
	"for",
	"from",
	"into",
	"our",
	"the",
	"their",
	"this",
	"that",
	"with",
	"work",
	"project",
	"service",
	"services",
	"system",
	"systems",
]);
