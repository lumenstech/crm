import type { z } from "zod";
import type {
	executorAcceptInput,
	executorCheckpointInput,
	executorFailureInput,
	executorResultEmailInput,
	executorResultInput,
} from "./executor.contracts";

export type ExecutorAcceptInput = z.infer<typeof executorAcceptInput>;
export type ExecutorCheckpointInput = z.infer<typeof executorCheckpointInput>;
export type ExecutorFailureInput = z.infer<typeof executorFailureInput>;
export type ExecutorResultEmailInput = z.infer<typeof executorResultEmailInput>;
export type ExecutorResultInput = z.infer<typeof executorResultInput>;
