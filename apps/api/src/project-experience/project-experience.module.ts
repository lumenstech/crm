import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ProjectExperienceRouter } from "./project-experience.router";
import { ProjectExperienceService } from "./project-experience.service";

@Module({
	imports: [AgentModule],
	providers: [ProjectExperienceService, ProjectExperienceRouter],
})
export class ProjectExperienceModule {}
