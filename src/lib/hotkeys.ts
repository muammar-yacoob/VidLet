/**
 * Hotkey Presets - Defines keyboard shortcuts for different video editor styles
 * Each preset maps action names to key combinations
 */

/** Minimal keyboard event interface for hotkey matching */
interface MinimalKeyboardEvent {
	code: string;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
}

export type HotkeyPreset = 'premiere' | 'resolve' | 'capcut' | 'shotcut' | 'descript' | 'camtasia';

export interface HotkeyBinding {
	key: string;           // Key code (e.g., 'KeyK', 'Delete')
	ctrl?: boolean;        // Requires Ctrl/Cmd
	shift?: boolean;       // Requires Shift
	alt?: boolean;         // Requires Alt
}

export interface HotkeyMap {
	// Playback
	playPause: HotkeyBinding;
	frameBack: HotkeyBinding;
	frameForward: HotkeyBinding;
	seekBack: HotkeyBinding;
	seekForward: HotkeyBinding;
	speedDown: HotkeyBinding;
	speedReset: HotkeyBinding;
	speedUp: HotkeyBinding;
	mute: HotkeyBinding;
	// Editing
	split: HotkeyBinding;
	delete: HotkeyBinding;
	rippleDelete: HotkeyBinding;
	selectPrev: HotkeyBinding;
	selectNext: HotkeyBinding;
}

export interface PresetInfo {
	name: string;
	description: string;
	map: HotkeyMap;
}

// Default binding (used as base)
const baseMap: HotkeyMap = {
	playPause: { key: 'Space' },
	frameBack: { key: 'ArrowLeft', alt: true },
	frameForward: { key: 'ArrowRight', alt: true },
	seekBack: { key: 'ArrowLeft' },
	seekForward: { key: 'ArrowRight' },
	speedDown: { key: 'KeyJ' },
	speedReset: { key: 'KeyK' },
	speedUp: { key: 'KeyL' },
	mute: { key: 'KeyM' },
	split: { key: 'KeyK', ctrl: true },
	delete: { key: 'Delete' },
	rippleDelete: { key: 'Delete', shift: true },
	selectPrev: { key: 'BracketLeft' },
	selectNext: { key: 'BracketRight' },
};

/**
 * Hotkey presets for different video editors
 */
export const HOTKEY_PRESETS: Record<HotkeyPreset, PresetInfo> = {
	premiere: {
		name: 'Adobe Premiere',
		description: 'Industry standard NLE shortcuts',
		map: {
			...baseMap,
			// Premiere uses Ctrl+K for razor, Q for ripple trim left
			split: { key: 'KeyK', ctrl: true },
			delete: { key: 'Delete' },
			rippleDelete: { key: 'Delete', shift: true },
		},
	},
	resolve: {
		name: 'DaVinci Resolve',
		description: 'Professional color & edit suite',
		map: {
			...baseMap,
			// Resolve uses Ctrl+B for blade, Backspace for delete
			split: { key: 'KeyB', ctrl: true },
			delete: { key: 'Backspace' },
			rippleDelete: { key: 'Backspace', shift: true },
			// Resolve uses Up/Down for clip selection
			selectPrev: { key: 'ArrowUp' },
			selectNext: { key: 'ArrowDown' },
		},
	},
	capcut: {
		name: 'CapCut',
		description: 'Mobile-first editor shortcuts',
		map: {
			...baseMap,
			// CapCut uses Ctrl+B for split, Delete for delete
			split: { key: 'KeyB', ctrl: true },
			delete: { key: 'Delete' },
			rippleDelete: { key: 'Delete' },
			// Simple arrow navigation
			selectPrev: { key: 'ArrowUp' },
			selectNext: { key: 'ArrowDown' },
		},
	},
	shotcut: {
		name: 'Shotcut',
		description: 'Free open-source editor',
		map: {
			...baseMap,
			// Shotcut uses S for split, X/Z for delete
			split: { key: 'KeyS' },
			delete: { key: 'KeyX' },
			rippleDelete: { key: 'KeyZ' },
			selectPrev: { key: 'BracketLeft' },
			selectNext: { key: 'BracketRight' },
		},
	},
	descript: {
		name: 'Descript',
		description: 'Text-based editing shortcuts',
		map: {
			...baseMap,
			// Descript uses Cmd+K for split (like text editors)
			split: { key: 'KeyK', ctrl: true },
			delete: { key: 'Backspace' },
			rippleDelete: { key: 'Backspace' },
			// Tab-style navigation
			selectPrev: { key: 'BracketLeft', ctrl: true },
			selectNext: { key: 'BracketRight', ctrl: true },
		},
	},
	camtasia: {
		name: 'Camtasia',
		description: 'Screen recording & tutorials',
		map: {
			...baseMap,
			// Camtasia uses S for split
			split: { key: 'KeyS', ctrl: true },
			delete: { key: 'Delete' },
			rippleDelete: { key: 'Delete', ctrl: true },
			selectPrev: { key: 'PageUp' },
			selectNext: { key: 'PageDown' },
		},
	},
};

/**
 * Get hotkey map for a preset
 */
export function getHotkeyMap(preset: HotkeyPreset): HotkeyMap {
	return HOTKEY_PRESETS[preset]?.map ?? HOTKEY_PRESETS.premiere.map;
}

/**
 * Get preset info
 */
export function getPresetInfo(preset: HotkeyPreset): PresetInfo {
	return HOTKEY_PRESETS[preset] ?? HOTKEY_PRESETS.premiere;
}

/**
 * Format a hotkey binding for display
 */
export function formatBinding(binding: HotkeyBinding): string {
	const parts: string[] = [];
	if (binding.ctrl) parts.push('Ctrl');
	if (binding.shift) parts.push('Shift');
	if (binding.alt) parts.push('Alt');

	// Convert key code to readable name
	let keyName = binding.key
		.replace('Key', '')
		.replace('Arrow', '')
		.replace('Bracket', '')
		.replace('Left', '[')
		.replace('Right', ']');

	if (keyName === 'Space') keyName = 'Space';
	else if (keyName === 'Delete') keyName = 'Del';
	else if (keyName === 'Backspace') keyName = 'Bksp';
	else if (keyName === 'PageUp') keyName = 'PgUp';
	else if (keyName === 'PageDown') keyName = 'PgDn';

	parts.push(keyName);
	return parts.join('+');
}

/**
 * Check if a keyboard event matches a binding
 */
export function matchesBinding(event: MinimalKeyboardEvent, binding: HotkeyBinding): boolean {
	const ctrlMatch = binding.ctrl ? (event.ctrlKey || event.metaKey) : !(event.ctrlKey || event.metaKey);
	const shiftMatch = binding.shift ? event.shiftKey : !event.shiftKey;
	const altMatch = binding.alt ? event.altKey : !event.altKey;

	return event.code === binding.key && ctrlMatch && shiftMatch && altMatch;
}

/**
 * Get all preset names for UI
 */
export function getPresetList(): Array<{ id: HotkeyPreset; name: string }> {
	return Object.entries(HOTKEY_PRESETS).map(([id, info]) => ({
		id: id as HotkeyPreset,
		name: info.name,
	}));
}
