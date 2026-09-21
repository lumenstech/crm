"use client";

import { Badge } from "@crm/ui/components/badge";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import {
	ALERT_SEVERITY,
	ALERT_STATE,
	formatAge,
	formatReading,
	type Presentation,
	SIGNAL_STATE,
	SITE_STATUS,
	SOURCE_STATUS,
} from "@/lib/site-ops/presentation";

export type MetricStateView = {
	metric: string;
	state: keyof typeof SIGNAL_STATE;
	reason: string;
	value: number | null;
	unit: string | null;
	ageSeconds: number | null;
	provider: string | null;
};

function Indicator({ presentation }: { presentation: Presentation }) {
	return (
		<StatusIndicator tone={presentation.tone} label={presentation.label} />
	);
}

export function SignalStateBadge({
	state,
}: {
	state: keyof typeof SIGNAL_STATE;
}) {
	return <Indicator presentation={SIGNAL_STATE[state]} />;
}

export function SiteStatusBadge({
	status,
}: {
	status: keyof typeof SITE_STATUS;
}) {
	return <Indicator presentation={SITE_STATUS[status]} />;
}

export function SourceStatusBadge({
	status,
}: {
	status: keyof typeof SOURCE_STATUS;
}) {
	return <Indicator presentation={SOURCE_STATUS[status]} />;
}

export function AlertSeverityBadge({
	severity,
}: {
	severity: keyof typeof ALERT_SEVERITY;
}) {
	return <Indicator presentation={ALERT_SEVERITY[severity]} />;
}

export function AlertStateBadge({
	state,
}: {
	state: keyof typeof ALERT_STATE;
}) {
	return <Indicator presentation={ALERT_STATE[state]} />;
}

/**
 * A reading is three facts, always together: the value, its age, and the state of
 * the signal it came from. Showing the number alone is how a four-day-old voltage
 * passes for a current one.
 */
export function Reading({ metric }: { metric: MetricStateView }) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline gap-2">
				<span className="font-medium text-sm tabular-nums">
					{formatReading(metric.value, metric.unit)}
				</span>
				<span className="text-muted-foreground text-xs">
					{formatAge(metric.ageSeconds)}
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<SignalStateBadge state={metric.state} />
				{metric.provider ? (
					<Badge variant="mono">{metric.provider}</Badge>
				) : null}
			</div>
		</div>
	);
}

export function MetricLabel({ metric }: { metric: string }) {
	return <Badge variant="token">{metric.replaceAll("_", " ")}</Badge>;
}
