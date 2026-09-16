import { useCallback } from "react";

export interface TabItem {
	id: string;
	label: string;
}

interface TabButtonProps {
	className: string;
	item: TabItem;
	onSelect: (id: string) => void;
	selected: boolean;
}

function TabButton({ className, item, onSelect, selected }: TabButtonProps) {
	const select = useCallback(() => onSelect(item.id), [item.id, onSelect]);

	return (
		<button
			type="button"
			className={className}
			role="tab"
			aria-selected={selected}
			onClick={select}
		>
			{item.label}
		</button>
	);
}

export function TabList({
	ariaLabel,
	className,
	items,
	onSelect,
	selectedId,
	tabClassName,
}: {
	ariaLabel?: string;
	className: string;
	items: TabItem[];
	onSelect: (id: string) => void;
	selectedId?: string;
	tabClassName: string;
}) {
	return (
		<div className={className} role="tablist" aria-label={ariaLabel}>
			{items.map((item) => (
				<TabButton
					className={tabClassName}
					item={item}
					onSelect={onSelect}
					selected={item.id === selectedId}
					key={item.id}
				/>
			))}
		</div>
	);
}
