// Layout
export const LEFT_PANE_RATIO = 0.32;
export const LEFT_PANE_MIN = 20;
export const FRAME_BORDER_X = 2;
export const FRAME_BORDER_Y = 2;
export const FRAME_HEADER_ROWS = 1;

// Grid
export const MAX_COL_WIDTH = 32;
export const MIN_COL_WIDTH = 3;
export const COL_SEP = ' │ ';
export const COL_SEP_NARROW = ' ';

// Table view paging
export const PAGE_SIZE_PADDING = 5; // pageSize = max(5, maxRows - this)
export const PAGE_SIZE_MIN = 5;

// Implicit limits
export const IMPLICIT_AD_HOC_LIMIT = 10_000;

// OSC 52 clipboard
export const OSC52_MAX_PAYLOAD = 100_000; // base64 chars

// Search debounce
export const SEARCH_DEBOUNCE_MS = 120;

// Estimated count threshold — below this, run an exact count too.
export const COUNT_ESTIMATE_EXACT_BELOW = 50_000;
