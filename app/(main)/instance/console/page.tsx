'use client';
import InstanceTextConsole from './textConsole';
import InstanceExec from './instanceExec';

export default function ConsolePage() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium">Console</h2>
        <InstanceExec />
      </div>
      <InstanceTextConsole />
    </div>
  );
}
