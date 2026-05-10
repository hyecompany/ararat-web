'use client';

import * as React from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import {
  cn,
  dashboardMonacoOptions,
  dashboardMonacoTheme,
  defineDashboardMonacoThemes,
} from 'ui-web/lib/utils';

interface SettingsYamlEditorProps {
  value: string;
  error: string | null;
  onChange: (value: string | undefined) => void;
  description?: string;
  className?: string;
}

export function SettingsYamlEditor({
  value,
  error,
  onChange,
  description,
  className,
}: SettingsYamlEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <div className={cn('flex min-h-[22rem] flex-col overflow-hidden', className)}>
      {description || error ? (
        <div className="border-b px-6 py-4">
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
          {error ? (
            <p className="text-destructive mt-2 text-sm">{error}</p>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          language="yaml"
          value={value}
          onChange={onChange}
          beforeMount={defineDashboardMonacoThemes}
          theme={dashboardMonacoTheme(resolvedTheme)}
          options={{
            ...dashboardMonacoOptions,
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
