import { defineSchedule } from "eve/schedules";
import { pollAndRun } from "../lib/resend-executor";

export default defineSchedule({
	cron: "* * * * *",
	async run({ waitUntil }) {
		waitUntil(pollAndRun());
	},
});
