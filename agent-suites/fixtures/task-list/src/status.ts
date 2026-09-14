export interface Task {
	id: string;
	completedAt?: string;
}

export function taskStatus(task: Task): "open" | "done" {
	return task.completedAt ? "open" : "done";
}
