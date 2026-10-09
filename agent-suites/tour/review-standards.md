# Task-list review standards

A task with no completion timestamp is open. A task with a completion timestamp is done.
The sample source returns the two states the wrong way around.
An explanation identifies the cause only when it says that the completed branch and the
incomplete branch are swapped (or equivalent), and ties that to `completedAt`.
Mentioning `completedAt` without explaining the swap does not identify the cause.
