export interface McpEvent {
	id: string;
	type: string;
	timestamp: string;
	tool?: string;
	category?: string;
	input?: unknown;
	output?: unknown;
	duration?: number;
	error?: string;
	sessionId?: string;
	clientName?: string;
}

export function createEventSource(onEvent: (event: McpEvent) => void): EventSource {
	const es = new EventSource('/api/events');

	es.onmessage = (e) => {
		try {
			const event: McpEvent = JSON.parse(e.data);
			onEvent(event);
		} catch {
			// skip unparseable events
		}
	};

	return es;
}
