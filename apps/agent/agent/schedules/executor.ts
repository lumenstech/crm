import { defineSchedule } from "eve/schedules";
import { runDurableJobs } from "../lib/resend-executor";

export default defineSchedule({
	cron: "* * * * *",
	async run({ waitUntil }) {
		waitUntil(runDurableJobs());
	},
});
