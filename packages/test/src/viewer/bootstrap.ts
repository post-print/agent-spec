export interface ViewerBootstrap {
	capabilities: {
		socket: { path: string; token: string; protocol: number };
	};
}
