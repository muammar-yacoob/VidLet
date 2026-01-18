import prompts from 'prompts';

/**
 * Prompt for text input with optional default
 */
export async function text(
	message: string,
	defaultValue?: string,
): Promise<string> {
	const response = await prompts({
		type: 'text',
		name: 'value',
		message,
		initial: defaultValue,
	});
	return response.value ?? defaultValue ?? '';
}

/**
 * Prompt for number input with optional default
 */
export async function number(
	message: string,
	defaultValue?: number,
	min?: number,
	max?: number,
): Promise<number> {
	const response = await prompts({
		type: 'number',
		name: 'value',
		message,
		initial: defaultValue,
		min,
		max,
	});
	return response.value ?? defaultValue ?? 0;
}

/**
 * Prompt for yes/no confirmation
 */
export async function confirm(
	message: string,
	defaultValue = true,
): Promise<boolean> {
	const response = await prompts({
		type: 'confirm',
		name: 'value',
		message,
		initial: defaultValue,
	});
	return response.value ?? defaultValue;
}

/**
 * Single-select from options
 */
export interface SelectOption {
	title: string;
	value: string | number;
	description?: string;
}

export async function select<T extends string | number>(
	message: string,
	options: SelectOption[],
): Promise<T | null> {
	const response = await prompts({
		type: 'select',
		name: 'value',
		message,
		choices: options.map((opt) => ({
			title: opt.title,
			value: opt.value,
			description: opt.description,
		})),
	});
	return (response.value as T) ?? null;
}

/**
 * Multi-select from options
 */
export async function multiSelect<T extends string | number>(
	message: string,
	options: SelectOption[],
): Promise<T[]> {
	const response = await prompts({
		type: 'multiselect',
		name: 'value',
		message,
		choices: options.map((opt) => ({
			title: opt.title,
			value: opt.value,
			description: opt.description,
		})),
		instructions: false,
		hint: '- Space to select, Enter to confirm',
	});
	return (response.value as T[]) ?? [];
}

/**
 * Handle Ctrl+C gracefully
 */
export function onCancel(): void {
	prompts.override({ value: undefined });
}

// Set up cancel handler
prompts.override({});
