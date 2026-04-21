'use client';

import * as React from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';

interface SettingsYamlEditorProps {
  value: string;
  error: string | null;
  onChange: (value: string | undefined) => void;
  description?: string;
}

export function SettingsYamlEditor({
  value,
  error,
  onChange,
  description,
}: SettingsYamlEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <div className="flex h-full min-h-0 flex-col">
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
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          options={{
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
