import { useEffect, useState } from "react";
import { formatElapsed } from "./presentation.js";

/** Elapsed time since `since` that ticks once a second while it is on screen. */
export function ElapsedTime({ since }: { since: string }) {
	const started = Date.parse(since);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	if (Number.isNaN(started)) return null;
	return <time dateTime={since}>{formatElapsed(now - started)}</time>;
}
