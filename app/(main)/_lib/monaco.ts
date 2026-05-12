import type { BeforeMount, Theme } from '@monaco-editor/react';

export const DASHBOARD_MONACO_DARK_THEME = 'ararat-dashboard-dark';
export const DASHBOARD_MONACO_LIGHT_THEME = 'ararat-dashboard-light';

export function dashboardMonacoTheme(
  resolvedTheme: string | undefined,
): Theme | string {
  return resolvedTheme === 'light'
    ? DASHBOARD_MONACO_LIGHT_THEME
    : DASHBOARD_MONACO_DARK_THEME;
}

// Monaco token rules only accept plain hex values. Surface/chrome colors that
// should track the app theme are handled in globals.css with the real CSS vars.
export const defineDashboardMonacoThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(DASHBOARD_MONACO_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a3a3a3', fontStyle: 'italic' },
      { token: 'keyword', foreground: '93c5fd' },
      { token: 'operator', foreground: 'e5e5e5' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fde68a' },
      { token: 'regexp', foreground: 'fca5a5' },
      { token: 'type', foreground: 'd8b4fe' },
      { token: 'class', foreground: 'f5f5f5' },
      { token: 'function', foreground: 'f5f5f5' },
      { token: 'variable', foreground: 'e5e5e5' },
      { token: 'constant', foreground: 'fcd34d' },
      { token: 'delimiter', foreground: 'a3a3a3' },
      { token: 'tag', foreground: '93c5fd' },
      { token: 'attribute.name', foreground: 'fcd34d' },
      { token: 'attribute.value', foreground: '86efac' },
    ],
    colors: {
      'editor.background': '#171717',
      'editor.foreground': '#f5f5f5',
      'editorGutter.background': '#171717',
      'editorLineNumber.foreground': '#a3a3a3',
      'editorLineNumber.activeForeground': '#f5f5f5',
      'editorCursor.foreground': '#f5f5f5',
      'editor.selectionBackground': '#52525266',
      'editor.inactiveSelectionBackground': '#40404066',
      'editor.lineHighlightBackground': '#26262680',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#737373',
      'editorWhitespace.foreground': '#404040',
      'editorWidget.background': '#171717',
      'editorWidget.foreground': '#f5f5f5',
      'editorWidget.border': '#404040',
      'editorSuggestWidget.background': '#171717',
      'editorSuggestWidget.border': '#404040',
      'editorSuggestWidget.foreground': '#f5f5f5',
      'editorSuggestWidget.selectedBackground': '#262626',
      'editorHoverWidget.background': '#171717',
      'editorHoverWidget.border': '#404040',
      'input.background': '#171717',
      'input.border': '#404040',
      focusBorder: '#737373',
      'scrollbarSlider.background': '#73737355',
      'scrollbarSlider.hoverBackground': '#a3a3a366',
      'scrollbarSlider.activeBackground': '#d4d4d477',
    },
  });

  monaco.editor.defineTheme(DASHBOARD_MONACO_LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '737373', fontStyle: 'italic' },
      { token: 'keyword', foreground: '2563eb' },
      { token: 'operator', foreground: '404040' },
      { token: 'string', foreground: '15803d' },
      { token: 'number', foreground: 'b45309' },
      { token: 'regexp', foreground: 'dc2626' },
      { token: 'type', foreground: '7c3aed' },
      { token: 'class', foreground: '171717' },
      { token: 'function', foreground: '171717' },
      { token: 'variable', foreground: '404040' },
      { token: 'constant', foreground: '92400e' },
      { token: 'delimiter', foreground: '525252' },
      { token: 'tag', foreground: '2563eb' },
      { token: 'attribute.name', foreground: '92400e' },
      { token: 'attribute.value', foreground: '15803d' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#171717',
      'editorGutter.background': '#ffffff',
      'editorLineNumber.foreground': '#737373',
      'editorLineNumber.activeForeground': '#171717',
      'editorCursor.foreground': '#171717',
      'editor.selectionBackground': '#d4d4d8',
      'editor.inactiveSelectionBackground': '#e5e5e5',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#e5e5e5',
      'editorIndentGuide.activeBackground1': '#a3a3a3',
      'editorWhitespace.foreground': '#d4d4d4',
      'editorWidget.background': '#ffffff',
      'editorWidget.foreground': '#171717',
      'editorWidget.border': '#e5e5e5',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e5e5e5',
      'editorSuggestWidget.foreground': '#171717',
      'editorSuggestWidget.selectedBackground': '#f5f5f5',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e5e5e5',
      'input.background': '#ffffff',
      'input.border': '#e5e5e5',
      focusBorder: '#737373',
      'scrollbarSlider.background': '#a3a3a355',
      'scrollbarSlider.hoverBackground': '#73737366',
      'scrollbarSlider.activeBackground': '#52525277',
    },
  });
};

export const dashboardMonacoOptions = {
  fontFamily:
    'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  renderLineHighlight: 'all',
  overviewRulerBorder: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
} as const;
