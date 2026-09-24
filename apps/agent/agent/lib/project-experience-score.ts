import {
	PROJECT_EXPERIENCE_MATCH,
	PROJECT_EXPERIENCE_STOP_WORDS,
} from "./project-experience-config";

export type ProjectExperienceCandidate = {
	projectName: string;
	clientLabel: string;
	sector: string | null;
	projectType: string | null;
	scopeSummary: string | null;
	systems: string | null;
	portfolioLanguage: string | null;
	evidenceStrength: string | null;
	salesEligible: boolean;
	tags: string[];
};

export type ProjectMatchScore = {
	score: number;
	matchedSignals: string[];
	rationale: string;
};

function tokens(value: string): Set<string> {
	return new Set(
		value
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.split(" ")
			.filter(
				(token) =>
					token.length >= 3 && !PROJECT_EXPERIENCE_STOP_WORDS.has(token),
			),
	);
}

function intersection(left: Set<string>, right: Set<string>): string[] {
	return [...left].filter((token) => right.has(token)).sort();
}

export function scoreProjectExperience(
	dealText: string,
	project: ProjectExperienceCandidate,
): ProjectMatchScore | null {
	const dealTokens = tokens(dealText);
	const signals = [
		...project.tags,
		project.sector,
		project.projectType,
		project.systems,
	].filter((value): value is string => Boolean(value?.trim()));
	const projectText = [
		project.projectName,
		project.clientLabel,
		project.scopeSummary,
		project.portfolioLanguage,
		...signals,
	]
		.filter(Boolean)
		.join(" ");
	const sharedTokens = intersection(dealTokens, tokens(projectText));
	if (sharedTokens.length === 0) return null;

	const matchedSignals = signals
		.filter((signal) => intersection(dealTokens, tokens(signal)).length > 0)
		.filter((signal, index, all) => all.indexOf(signal) === index)
		.slice(0, 12);
	const weights = PROJECT_EXPERIENCE_MATCH.weights;
	const score = Math.min(
		100,
		sharedTokens.length * weights.token +
			matchedSignals.length * weights.signal +
			(project.salesEligible ? weights.salesReady : 0) +
			(project.evidenceStrength === "high" ? weights.strongEvidence : 0),
	);
	if (score < PROJECT_EXPERIENCE_MATCH.minimumScore) return null;

	const evidence = project.salesEligible
		? "This project is sales-ready."
		: "This project needs evidence review.";
	return {
		score,
		matchedSignals,
		rationale: `Shared terms: ${sharedTokens.join(", ")}. ${evidence}`,
	};
}
