const SECOND_MS = 1_000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

export const SITE_OPS = {
	observation: {
		historyLimit: 50,
		historyMaxLimit: 200,
		maxValueAbs: 1e9,
	},
	monitoring: {
		defaultExpectedIntervalSeconds: 5 * MINUTE_S,
		defaultStaleAfterSeconds: 15 * MINUTE_S,
		minIntervalSeconds: 30,
		maxIntervalSeconds: 30 * 24 * HOUR_S,
	},
	sourceHealth: {
		degradedAfterMissedIntervals: 2,
		failedAfterMissedIntervals: 4,
	},
	alert: {
		recentTaskLimit: 10,
		maxTitleLength: 200,
		maxDescriptionLength: 2000,
	},
	time: {
		secondMs: SECOND_MS,
	},
} as const;
