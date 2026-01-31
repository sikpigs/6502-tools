import * as cp from 'child_process';
import * as jsonc from 'jsonc-parser';
import * as vscode from 'vscode';

type TaskLabelSetting =|'6502-tools.buildTaskLabel'|'6502-tools.flashTaskLabel'|
    '6502-tools.buildFlashTaskLabel';

function GetSetting<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration().get<T>(key, defaultValue);
}

async function FindTaskByLabel(Label: string): Promise<vscode.Task|undefined> {
  const Tasks = await vscode.tasks.fetchTasks();

  return Tasks.find(
      t => t.name === Label || t.detail === Label ||
          (typeof (t as any).label === 'string' && (t as any).label === Label));
}

async function RunTaskBySetting(settingKey: TaskLabelSetting): Promise<void> {
  const Label = GetSetting<string>(settingKey, '');
  if (!Label) {
    vscode.window.showErrorMessage(
        `6502 Tools: Setting ${settingKey} is empty.`);
    return;
  }

  const Task = await FindTaskByLabel(Label);
  if (!Task) {
    vscode.window.showErrorMessage(`6502 Tools: Task not found: "${
        Label}". Check .vscode/tasks.json and 6502 Tools settings.`);
    return;
  }

  await vscode.tasks.executeTask(Task);
}

function MakeButton(
    context: vscode.ExtensionContext, text: string, tooltip: string,
    command: string, priority: number): vscode.StatusBarItem {
  const Item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, priority);
  Item.text = text;
  Item.tooltip = tooltip;
  Item.command = command;
  Item.show();
  context.subscriptions.push(Item);
  return Item;
}

export function activate(context: vscode.ExtensionContext) {
  const Show = GetSetting<boolean>('6502-tools.showButtons', true);
  if (Show) {
    MakeButton(
        context, '$(tools) Build', '6502 Tools: Build', '6502-tools.build',
        101);
    MakeButton(
        context, '$(zap) Flash', '6502 Tools: Flash', '6502-tools.flash', 100);
    MakeButton(
        context, '$(rocket) B+F', '6502 Tools: Build + Flash',
        '6502-tools.buildFlash', 99);
  }

  context.subscriptions.push(
      vscode.commands.registerCommand('6502-tools.build', async () => {
        await RunTaskBySetting('6502-tools.buildTaskLabel');
      }));

  context.subscriptions.push(
      vscode.commands.registerCommand('6502-tools.flash', async () => {
        await RunTaskBySetting('6502-tools.flashTaskLabel');
      }));

  context.subscriptions.push(
      vscode.commands.registerCommand('6502-tools.buildFlash', async () => {
        await RunTaskBySetting('6502-tools.buildFlashTaskLabel');
      }));

  context.subscriptions.push(
      vscode.commands.registerCommand('6502-tools.installTasks', async () => {
        await InstallOrUpdateTasksPreservingComments();
      }));
}

export function deactivate() {}

function DesiredTasks(): any[] {
  return [
    {
      label: 'Build (CMake)',
      type: 'shell',
      command: 'cmake',
      args: ['--build', '${workspaceFolder}/build'],
      problemMatcher: ['$ca65', '$ld65'],
      group: {kind: 'build', isDefault: true}
    },
    {
      label: 'Flash EEPROM (minipro)',
      type: 'shell',
      options: {cwd: '${workspaceFolder}/build'},
      command: 'minipro',
      args: ['-p', 'AT28C256', '-uP', '-w', './rom.bin'],
      problemMatcher: []
    },
    {
      label: 'Build + Flash',
      dependsOrder: 'sequence',
      dependsOn: ['Build (CMake)', 'Flash EEPROM (minipro)'],
      problemMatcher: []
    }
  ];
}

async function EnsureVscodeDir(folder: vscode.WorkspaceFolder):
    Promise<vscode.Uri> {
  const vscodeDir = vscode.Uri.joinPath(folder.uri, '.vscode');
  try {
    await vscode.workspace.fs.stat(vscodeDir);
  } catch {
    await vscode.workspace.fs.createDirectory(vscodeDir);
  }
  return vscodeDir;
}

async function ReadTextOrEmpty(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function ParseJsoncOrThrow(text: string): any {
  if (!text.trim()) {
    return {};
  }
  const errors: jsonc.ParseError[] = [];
  const obj = jsonc.parse(text, errors, {allowTrailingComma: true});
  if (errors.length) {
    const msg = errors
                    .map(
                        e => `${jsonc.printParseErrorCode(e.error)} at offset ${
                            e.offset}`)
                    .join(', ');
    throw new Error(`tasks.json parse error(s): ${msg}`);
  }
  return obj ?? {};
}

function ApplyJsoncEdits(text: string, edits: jsonc.Edit[]): string {
  return jsonc.applyEdits(text, edits);
}

async function PatchTasksJsonPreserveComments(tasksUri: vscode.Uri):
    Promise<void> {
  let text = await ReadTextOrEmpty(tasksUri);

  // If file doesn't exist, create a minimal JSONC skeleton.
  if (!text.trim()) {
    text = `{
  // 6502 Tools tasks live here
  "version": "2.0.0",
  "tasks": []
}
`;
    await vscode.workspace.fs.writeFile(
        tasksUri, new TextEncoder().encode(text));
  }

  // Parse (to inspect existing tasks array and find labels)
  const root = ParseJsoncOrThrow(text);
  const existingTasks: any[] = Array.isArray(root.tasks) ? root.tasks : [];

  // We'll build a list of JSONC edits and then apply them.
  const edits: jsonc.Edit[] = [];

  // Ensure version exists
  if (typeof root.version !== 'string') {
    edits.push(...jsonc.modify(
        text, ['version'], '2.0.0',
        {formattingOptions: {insertSpaces: true, tabSize: 2}}));
    text = ApplyJsoncEdits(text, edits.splice(0, edits.length));
  }

  // Ensure tasks is an array
  if (!Array.isArray(ParseJsoncOrThrow(text).tasks)) {
    edits.push(...jsonc.modify(
        text, ['tasks'], [],
        {formattingOptions: {insertSpaces: true, tabSize: 2}}));
    text = ApplyJsoncEdits(text, edits.splice(0, edits.length));
  }

  // Re-parse after ensuring structure
  const root2 = ParseJsoncOrThrow(text);
  const tasks2: any[] = Array.isArray(root2.tasks) ? root2.tasks : [];

  const desired = DesiredTasks();

  // Upsert tasks by label
  for (const t of desired) {
    const idx = tasks2.findIndex(x => x?.label === t.label);
    const path = ['tasks', idx >= 0 ? idx : tasks2.length];

    edits.push(...jsonc.modify(
        text, path, t, {formattingOptions: {insertSpaces: true, tabSize: 2}}));

    // Apply incrementally so subsequent indices stay correct
    text = ApplyJsoncEdits(text, edits.splice(0, edits.length));

    // Refresh tasks array snapshot for next loop
    const refreshed = ParseJsoncOrThrow(text);
    (tasks2 as any).length = 0;
    if (Array.isArray(refreshed.tasks)) {
      for (const item of refreshed.tasks) {
        tasks2.push(item);
      }
    }
  }

  // Write back only if changed
  const original = await ReadTextOrEmpty(tasksUri);
  if (text !== original) {
    // Use WorkspaceEdit so it behaves like an editor change (undo-friendly if
    // file is open).
    const we = new vscode.WorkspaceEdit();
    // Replace full document text, but we preserved comments/formatting as much
    // as possible by editing JSONC. VS Code doesn't support partial-file FS
    // patch, so we set the whole file contents.
    we.replace(
        tasksUri,
        new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(Number.MAX_SAFE_INTEGER, 0)),
        text);
    await vscode.workspace.applyEdit(we);
    await vscode.workspace.fs.writeFile(
        tasksUri, new TextEncoder().encode(text));
  }
}

async function InstallOrUpdateTasksPreservingComments(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage(
        '6502 Tools: Open a folder/workspace first.');
    return;
  }

  const vscodeDir = await EnsureVscodeDir(folder);
  const tasksUri = vscode.Uri.joinPath(vscodeDir, 'tasks.json');

  try {
    await PatchTasksJsonPreserveComments(tasksUri);
    vscode.window.showInformationMessage(
        '6502 Tools: tasks.json updated (comments preserved).');
  } catch (e: any) {
    vscode.window.showErrorMessage(
        `6502 Tools: Could not update tasks.json: ${e?.message ?? String(e)}`);
  }
}

async function ExecAsync(cmd: string, args: string[], cwd?: string):
    Promise<{stdout: string; stderr: string; code: number}> {
  return new Promise((resolve, reject) => {
    const Child = cp.spawn(cmd, args, {cwd, shell: false});
    let Stdout = '';
    let Stderr = '';

    Child.stdout.on('data', d => Stdout += d.toString('utf-8'));
    Child.stderr.on('data', d => Stderr += d.toString('utf-8'));
    Child.on('error', err => reject(err));
    Child.on(
        'close',
        code => resolve({stdout: Stdout, stderr: Stderr, code: code ?? -1}));
  });
}

function ParseDeviceList(text: string): string[] {
  // minipro -l output varies a bit by build; safest is "split lines, trim, drop
  // empties"
  return text.split(/\r?\n/g)
      .map(l => l.trim())
      .filter(l => l.length > 0)
      // Some builds print headings; drop obvious non-device lines:
      .filter(l => !/^minipro\b/i.test(l))
      .filter(l => !/^usage:/i.test(l))
      .filter(l => !/^list/i.test(l));
}

async function GetMiniproDeviceList(context: vscode.ExtensionContext):
    Promise<string[]> {
  const CacheKey = 'tools6502.MiniproDeviceList';
  const Cached = context.workspaceState.get<string[]>(CacheKey);
  if (Cached && Cached.length) {
    return Cached;
  }

  const Result = await ExecAsync('minipro', ['-l']);
  if (Result.code !== 0) {
    throw new Error(
        `minipro -l failed (exit ${Result.code}). ${Result.stderr}`.trim());
  }

  const Devices = ParseDeviceList(Result.stdout);
  if (!Devices.length) {
    throw new Error('minipro returned an empty device list.');
  }

  await context.workspaceState.update(CacheKey, Devices);
  return Devices;
}

async function PromptChipTypeFromMinipro(context: vscode.ExtensionContext):
    Promise<string|undefined> {
  const Devices = await GetMiniproDeviceList(context);

  // Start with a reasonable EEPROM-focused subset, but allow picking "All"
  const Eepromish = Devices.filter(
      d => /^AT28/i.test(d) || /^28C/i.test(d) || /^27C/i.test(d) ||
          /EEPROM/i.test(d));

  const Mode = await vscode.window.showQuickPick(
      [
        {
          label: 'EEPROM/EPROM shortlist',
          description: `~${Eepromish.length} devices`
        },
        {
          label: 'All supported devices',
          description: `${Devices.length} devices`
        }
      ],
      {title: '6502 Tools: Choose device list scope', ignoreFocusOut: true});
  if (!Mode) {
    return undefined;
  }

  const List = (Mode.label.startsWith('EEPROM')) ? Eepromish : Devices;

  // QuickPick can handle thousands, but UX is better with filtering.
  const Pick = await vscode.window.showQuickPick(List.map(d => ({label: d})), {
    title: '6502 Tools: Select EEPROM/EPROM chip type',
    placeHolder: 'Type to filter (e.g., AT28C256, 27C256...)',
    matchOnDescription: true,
    ignoreFocusOut: true
  });

  return Pick?.label;
}
