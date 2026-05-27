export interface ConsoleCommandContext {
  log(line: string): void;
  error(line: string): void;
}

export type ConsoleHandler = (args: string[], ctx: ConsoleCommandContext) => string | void | Promise<string | void>;

export interface ConsoleCommand {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  handler: ConsoleHandler;
}

const MAX_HISTORY = 64;
const MAX_OUTPUT_LINES = 400;
const TOGGLE_CODES = new Set(['Backquote', 'IntlBackslash']);

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && i + 1 < line.length) {
        current += line[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

interface ConsoleWatcher {
  id: number;
  command: string;
  intervalMs: number;
  timer: number;
}

export class EngineConsole {
  private commands = new Map<string, ConsoleCommand>();
  private aliases = new Map<string, string>();
  private watchers = new Map<number, ConsoleWatcher>();
  private nextWatcherId = 1;
  private root: HTMLDivElement;
  private outputEl: HTMLDivElement;
  private inputEl: HTMLInputElement;
  private history: string[] = [];
  private historyIndex = -1;
  private isOpen = false;
  private lines: string[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'engine-console';
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      top: '0',
      maxHeight: '50%',
      background: 'rgba(8, 12, 17, 0.92)',
      color: '#cfe7ff',
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: '13px',
      lineHeight: '1.4',
      padding: '8px 12px',
      borderBottom: '1px solid rgba(120, 180, 240, 0.35)',
      zIndex: '99999',
      display: 'none',
      flexDirection: 'column',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
    });
    this.outputEl = document.createElement('div');
    Object.assign(this.outputEl.style, {
      flex: '1 1 auto',
      overflowY: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      paddingBottom: '6px',
    });
    const inputRow = document.createElement('div');
    Object.assign(inputRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      paddingTop: '4px',
      borderTop: '1px solid rgba(120, 180, 240, 0.18)',
    });
    const prompt = document.createElement('span');
    prompt.textContent = '>';
    Object.assign(prompt.style, { color: '#7cd1ff', flex: '0 0 auto' });
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.autocomplete = 'off';
    this.inputEl.spellcheck = false;
    Object.assign(this.inputEl.style, {
      flex: '1 1 auto',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: '#ffffff',
      font: 'inherit',
    });
    inputRow.appendChild(prompt);
    inputRow.appendChild(this.inputEl);
    this.root.appendChild(this.outputEl);
    this.root.appendChild(inputRow);
    parent.appendChild(this.root);

    this.inputEl.addEventListener('keydown', (event) => this.onInputKey(event));
    window.addEventListener('keydown', (event) => this.onWindowKey(event), { capture: true });

    this.log('Engine console ready. Type "help" for a list of commands. Toggle with `.');
  }

  register(command: ConsoleCommand): void {
    const names = [command.name, ...(command.aliases ?? [])];
    for (const name of names) this.commands.set(name.toLowerCase(), command);
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.style.display = 'flex';
    this.inputEl.focus();
    this.scrollToBottom();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.style.display = 'none';
    this.inputEl.blur();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  get opened(): boolean {
    return this.isOpen;
  }

  log(line: string): void {
    this.append(line, '#cfe7ff');
  }

  error(line: string): void {
    this.append(line, '#ff9b9b');
  }

  echo(line: string): void {
    this.append(line, '#9ad3ff');
  }

  private append(text: string, color: string): void {
    for (const raw of text.split('\n')) {
      const entry = document.createElement('div');
      entry.textContent = raw;
      entry.style.color = color;
      this.outputEl.appendChild(entry);
      this.lines.push(raw);
    }
    while (this.outputEl.childElementCount > MAX_OUTPUT_LINES) {
      this.outputEl.removeChild(this.outputEl.firstChild as Node);
    }
    while (this.lines.length > MAX_OUTPUT_LINES) this.lines.shift();
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private onWindowKey(event: KeyboardEvent): void {
    if (TOGGLE_CODES.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.shiftKey && this.isOpen && event.target === this.inputEl) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
      return;
    }
    if (this.isOpen && event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (this.isOpen && event.target === this.inputEl) {
      event.stopPropagation();
    }
  }

  private onInputKey(event: KeyboardEvent): void {
    if (event.code === 'Enter') {
      event.preventDefault();
      const line = this.inputEl.value.trim();
      this.inputEl.value = '';
      if (line.length === 0) return;
      this.echo(`> ${line}`);
      this.recordHistory(line);
      void this.execute(line);
      return;
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      this.recallHistory(-1);
      return;
    }
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      this.recallHistory(1);
      return;
    }
    if (event.code === 'Tab') {
      event.preventDefault();
      this.completeCommand();
      return;
    }
  }

  private recordHistory(line: string): void {
    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      while (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.historyIndex = this.history.length;
  }

  private recallHistory(delta: number): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + delta));
    this.inputEl.value = this.historyIndex >= this.history.length ? '' : this.history[this.historyIndex];
    const len = this.inputEl.value.length;
    this.inputEl.setSelectionRange(len, len);
  }

  private completeCommand(): void {
    const value = this.inputEl.value;
    const firstSpace = value.indexOf(' ');
    if (firstSpace !== -1) return;
    const prefix = value.toLowerCase();
    const matches: string[] = [];
    const seen = new Set<string>();
    const consider = (name: string): void => {
      if (!name.startsWith(prefix) || seen.has(name)) return;
      seen.add(name);
      matches.push(name);
    };
    consider('help');
    consider('clear');
    for (const name of this.aliases.keys()) consider(name);
    for (const name of this.commands.keys()) consider(name);
    if (matches.length === 1) {
      this.inputEl.value = `${matches[0]} `;
    } else if (matches.length > 1) {
      this.log(matches.sort().join('  '));
      const common = commonPrefix(matches);
      if (common.length > value.length) this.inputEl.value = common;
    }
  }

  async execute(line: string, depth = 0): Promise<void> {
    if (depth > 16) {
      this.error('Console: alias/command expansion exceeded depth 16 (likely cycle).');
      return;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    if (trimmed.includes(';')) {
      for (const segment of trimmed.split(';')) {
        const sub = segment.trim();
        if (sub.length > 0) await this.execute(sub, depth + 1);
      }
      return;
    }
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return;
    const name = (tokens[0] ?? '').toLowerCase();
    if (name === 'help') {
      this.printHelp(tokens[1]);
      return;
    }
    if (name === 'clear') {
      this.outputEl.replaceChildren();
      this.lines = [];
      return;
    }
    const aliasBody = this.aliases.get(name);
    if (aliasBody) {
      const remainder = tokens.slice(1).join(' ');
      const expanded = remainder.length > 0 ? `${aliasBody} ${remainder}` : aliasBody;
      await this.execute(expanded, depth + 1);
      return;
    }
    const cmd = this.commands.get(name);
    if (!cmd) {
      this.error(`Unknown command: ${name}. Type "help" for a list.`);
      return;
    }
    try {
      const result = cmd.handler(tokens.slice(1), {
        log: (msg) => this.log(msg),
        error: (msg) => this.error(msg),
      });
      const awaited = result instanceof Promise ? await result : result;
      if (typeof awaited === 'string' && awaited.length > 0) this.log(awaited);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }

  setAlias(name: string, body: string): void {
    const key = name.toLowerCase();
    if (body.length === 0) this.aliases.delete(key);
    else this.aliases.set(key, body);
  }

  removeAlias(name: string): boolean {
    return this.aliases.delete(name.toLowerCase());
  }

  listAliases(): Array<{ name: string; body: string }> {
    return Array.from(this.aliases.entries(), ([name, body]) => ({ name, body }));
  }

  getHistory(limit?: number): string[] {
    if (limit === undefined) return [...this.history];
    return this.history.slice(-limit);
  }

  startWatcher(command: string, intervalMs: number): number {
    const id = this.nextWatcherId++;
    const safeInterval = Math.max(200, Math.round(intervalMs));
    const timer = window.setInterval(() => {
      void this.execute(command);
    }, safeInterval);
    this.watchers.set(id, { id, command, intervalMs: safeInterval, timer });
    return id;
  }

  stopWatcher(id: number): boolean {
    const watcher = this.watchers.get(id);
    if (!watcher) return false;
    window.clearInterval(watcher.timer);
    this.watchers.delete(id);
    return true;
  }

  stopAllWatchers(): number {
    const count = this.watchers.size;
    for (const watcher of this.watchers.values()) window.clearInterval(watcher.timer);
    this.watchers.clear();
    return count;
  }

  listWatchers(): Array<{ id: number; command: string; intervalMs: number }> {
    return Array.from(this.watchers.values()).map(({ id, command, intervalMs }) => ({ id, command, intervalMs }));
  }

  private printHelp(filter?: string): void {
    const all = Array.from(new Set(this.commands.values()));
    all.sort((a, b) => a.name.localeCompare(b.name));
    if (filter) {
      const lower = filter.toLowerCase();
      if (lower === 'help') {
        this.log('help [name]');
        this.log('  List commands, or show usage for a specific command.');
        return;
      }
      if (lower === 'clear') {
        this.log('clear');
        this.log('  Clear console output.');
        return;
      }
      const aliasBody = this.aliases.get(lower);
      if (aliasBody) {
        this.log(`${filter} (alias)`);
        this.log(`  expands to: ${aliasBody}`);
        return;
      }
      const cmd = this.commands.get(lower);
      if (!cmd) {
        this.error(`No such command: ${filter}`);
        return;
      }
      this.log(`${cmd.name}${cmd.usage ? ' ' + cmd.usage : ''}`);
      this.log(`  ${cmd.description}`);
      if (cmd.aliases?.length) this.log(`  aliases: ${cmd.aliases.join(', ')}`);
      return;
    }
    this.log('Commands:');
    this.log('  help          List commands. "help <name>" shows usage.');
    this.log('  clear         Clear console output.');
    for (const cmd of all) {
      this.log(`  ${cmd.name.padEnd(13)} ${cmd.description}`);
    }
  }
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0];
  for (let i = 1; i < values.length; i++) {
    while (!values[i].startsWith(prefix) && prefix.length > 0) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
