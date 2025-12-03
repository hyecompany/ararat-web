'use client';
import { useState } from 'react';
import InstanceTextConsole from 'ararat-ui-web/components/instance/textConsole';
import InstanceExec from 'ararat-ui-web/components/instance/exec';
import { Button } from 'ui-web/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'ui-web/components/dialog';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import { TerminalIcon } from 'lucide-react';

export default function ConsolePage() {
  const [showExecDialog, setShowExecDialog] = useState(false);
  const [showExecTerminal, setShowExecTerminal] = useState(false);
  const [command, setCommand] = useState('');
  const [execCommand, setExecCommand] = useState<string[]>([]);

  const handleExecuteCommand = () => {
    if (!command.trim()) return;
    
    // Parse command into array (simple split by spaces for now)
    const cmdArray = command.trim().split(/\s+/);
    setExecCommand(cmdArray);
    setShowExecDialog(false);
    setShowExecTerminal(true);
  };

  const handleCloseExecTerminal = () => {
    setShowExecTerminal(false);
    setCommand('');
    setExecCommand([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Console</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowExecDialog(true)}
        >
          <TerminalIcon className="mr-2 h-4 w-4" />
          Execute Command
        </Button>
      </div>

      <InstanceTextConsole />

      {/* Command Input Dialog */}
      <Dialog open={showExecDialog} onOpenChange={setShowExecDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Execute Command</DialogTitle>
            <DialogDescription>
              Enter a command to execute on this instance. The command will run
              in an interactive terminal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="command">Command</Label>
              <Input
                id="command"
                placeholder="e.g., bash"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleExecuteCommand();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExecDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleExecuteCommand}
              disabled={!command.trim()}
            >
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Command Execution Terminal Dialog */}
      <Dialog open={showExecTerminal} onOpenChange={setShowExecTerminal}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              Executing: {execCommand.join(' ')}
            </DialogTitle>
            <DialogDescription>
              Interactive terminal session
            </DialogDescription>
          </DialogHeader>
          {showExecTerminal && (
            <InstanceExec
              command={execCommand}
              onClose={handleCloseExecTerminal}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseExecTerminal}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
