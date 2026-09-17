const IDENTIFIER = /[\w$]/;
const WHITESPACE = /\s/;
const REGULAR_EXPRESSION_FLAG = /[a-z]/i;

/** Returns direct expect(...) assertions in declaration order for viewer discovery. */
export function derivedExpectCriteria(source: string): string[] {
	const criteria: string[] = [];
	for (let index = 0; index < source.length; index++) {
		const ignoredEnd = ignoredTokenEnd(source, index);
		if (ignoredEnd > index) {
			index = ignoredEnd - 1;
			continue;
		}
		if (!isExpectCall(source, index)) continue;
		const end = assertionEnd(source, index);
		const assertion = source.slice(index, end);
		criteria.push(expectDescription(assertion) ?? normalizeAssertion(assertion));
		index = end - 1;
	}
	return criteria;
}

function expectDescription(assertion: string): string | undefined {
	const open = assertion.indexOf("(", "expect".length);
	if (open < 0) return undefined;
	const description = secondExpectArgument(assertion, open + 1);
	return description === undefined ? undefined : staticString(description);
}

function secondExpectArgument(source: string, start: number): string | undefined {
	const depths: Depths = { parentheses: 0, brackets: 0, braces: 0 };
	let descriptionStart: number | undefined;
	for (let index = start; index < source.length; index++) {
		const ignoredEnd = ignoredTokenEnd(source, index);
		if (ignoredEnd > index) {
			index = ignoredEnd - 1;
			continue;
		}
		const character = source[index];
		if (isTopLevelCharacter(character, ",", depths)) descriptionStart = index + 1;
		if (isTopLevelCharacter(character, ")", depths))
			return descriptionAtCallEnd(source, descriptionStart, index);
		updateDepths(depths, character);
	}
	return undefined;
}

function isTopLevelCharacter(character: string | undefined, expected: string, depths: Depths) {
	return character === expected && isTopLevel(depths);
}

function descriptionAtCallEnd(
	source: string,
	start: number | undefined,
	end: number,
): string | undefined {
	return start === undefined ? undefined : source.slice(start, end).trim();
}

function staticString(source: string): string | undefined {
	const quote = source[0];
	if (!(quote === '"' || quote === "'" || quote === "`")) return undefined;
	if (source.at(-1) !== quote || (quote === "`" && source.includes("${"))) return undefined;
	return decodeStringBody(source.slice(1, -1), quote);
}

function decodeStringBody(body: string, quote: string): string | undefined {
	let decoded = "";
	for (let index = 0; index < body.length; index++) {
		const character = body[index];
		if (character !== "\\") {
			decoded += character;
			continue;
		}
		const escapedCharacter = body[++index];
		if (escapedCharacter === undefined) return undefined;
		decoded += decodedEscape(escapedCharacter, quote);
	}
	return decoded;
}

function decodedEscape(escapedCharacter: string, quote: string): string {
	const escapes: Record<string, string> = {
		b: "\b",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "\t",
		v: "\v",
		"\\": "\\",
	};
	if (escapedCharacter === quote) return quote;
	return escapes[escapedCharacter] ?? escapedCharacter;
}

function isExpectCall(source: string, index: number): boolean {
	if (!source.startsWith("expect", index)) return false;
	const previous = source[index - 1];
	if (previous && (IDENTIFIER.test(previous) || previous === ".")) return false;
	const next = source[index + "expect".length];
	if (next && IDENTIFIER.test(next)) return false;
	return source
		.slice(index + "expect".length)
		.trimStart()
		.startsWith("(");
}

type Depths = { parentheses: number; brackets: number; braces: number };
function assertionEnd(source: string, start: number): number {
	const depths: Depths = { parentheses: 0, brackets: 0, braces: 0 };
	for (let index = start; index < source.length; index++) {
		const ignoredEnd = ignoredTokenEnd(source, index);
		if (ignoredEnd > index) {
			index = ignoredEnd - 1;
			continue;
		}
		const character = source[index];
		if ((character === ";" || character === "}") && isTopLevel(depths)) return index;
		updateDepths(depths, character);
	}
	return source.length;
}
function isTopLevel(depths: Depths): boolean {
	return depths.parentheses === 0 && depths.brackets === 0 && depths.braces === 0;
}
function updateDepths(depths: Depths, character: string | undefined): void {
	if (character === "(") depths.parentheses++;
	if (character === ")") depths.parentheses--;
	if (character === "[") depths.brackets++;
	if (character === "]") depths.brackets--;
	if (character === "{") depths.braces++;
	if (character === "}") depths.braces--;
}

function ignoredTokenEnd(source: string, index: number): number {
	const character = source[index];
	if (character === '"' || character === "'" || character === "`")
		return quotedTokenEnd(source, index, character);
	if (source.startsWith("//", index)) return lineCommentEnd(source, index);
	if (source.startsWith("/*", index)) return blockCommentEnd(source, index);
	if (character === "/" && startsRegularExpression(source, index))
		return regularExpressionEnd(source, index);
	return index;
}
function quotedTokenEnd(source: string, start: number, quote: string): number {
	for (let index = start + 1; index < source.length; index++) {
		if (source[index] === "\\") index++;
		else if (source[index] === quote) return index + 1;
	}
	return source.length;
}
function lineCommentEnd(source: string, start: number): number {
	const end = source.indexOf("\n", start + 2);
	return end < 0 ? source.length : end;
}
function blockCommentEnd(source: string, start: number): number {
	const end = source.indexOf("*/", start + 2);
	return end < 0 ? source.length : end + 2;
}
function startsRegularExpression(source: string, index: number): boolean {
	let previous = index - 1;
	while (previous >= 0 && WHITESPACE.test(source[previous] ?? "")) previous--;
	return previous < 0 || "([{:;,=!?&|".includes(source[previous] ?? "");
}
function regularExpressionEnd(source: string, start: number): number {
	let inCharacterClass = false;
	for (let index = start + 1; index < source.length; index++) {
		const character = source[index];
		if (character === "\\") {
			index++;
			continue;
		}
		inCharacterClass = nextCharacterClassState(inCharacterClass, character);
		if (!closesRegularExpression(character, inCharacterClass)) continue;
		while (REGULAR_EXPRESSION_FLAG.test(source[index + 1] ?? "")) index++;
		return index + 1;
	}
	return source.length;
}
function nextCharacterClassState(current: boolean, character: string | undefined): boolean {
	if (character === "[") return true;
	if (character === "]") return false;
	return current;
}
function closesRegularExpression(
	character: string | undefined,
	inCharacterClass: boolean,
): boolean {
	return character === "/" && !inCharacterClass;
}

function normalizeAssertion(source: string): string {
	let normalized = "";
	let pendingSpace = false;
	for (let index = 0; index < source.length; index++) {
		const ignoredEnd = ignoredTokenEnd(source, index);
		if (ignoredEnd > index)
			({ normalized, pendingSpace, index } = appendIgnoredToken({
				source,
				index,
				end: ignoredEnd,
				normalized,
				pendingSpace,
			}));
		else if (WHITESPACE.test(source[index] ?? "")) pendingSpace = true;
		else ({ normalized, pendingSpace } = appendText(normalized, source[index] ?? "", pendingSpace));
	}
	return normalized.trim();
}

function appendIgnoredToken(input: {
	source: string;
	index: number;
	end: number;
	normalized: string;
	pendingSpace: boolean;
}) {
	const { source, index, end, normalized, pendingSpace } = input;
	if (source.startsWith("//", index) || source.startsWith("/*", index))
		return { normalized, pendingSpace: true, index: end - 1 };
	const appended = appendText(normalized, source.slice(index, end), pendingSpace);
	return { ...appended, index: end - 1 };
}
function appendText(normalized: string, text: string, pendingSpace: boolean) {
	return {
		normalized: `${normalized}${pendingSpace && normalized ? " " : ""}${text}`,
		pendingSpace: false,
	};
}
